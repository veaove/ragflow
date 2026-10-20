//
//  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
//
//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.
//

package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"go.uber.org/zap"

	"ragflow/internal/common"
	"ragflow/internal/dao"
	"ragflow/internal/entity"
)

// QC system-setting keys stored in the system_settings table.
const (
	qcSettingEnabled   = "qc.enabled"
	qcSettingMaxRules  = "qc.max_rules_per_tenant"
	qcSettingRetention = "qc.retention_days"
)

// QcConfig is the tenant-global QC switch and limits.
type QcConfig struct {
	Enabled           bool
	MaxRulesPerTenant int
	RetentionDays     int
}

func defaultQcConfig() QcConfig {
	return QcConfig{Enabled: true, MaxRulesPerTenant: 200, RetentionDays: 180}
}

var (
	qcConfigMu     sync.RWMutex
	qcConfigLoaded bool
	qcConfig       QcConfig
)

// GetQcConfig returns the cached QC config, loading it on first use.
func GetQcConfig() QcConfig {
	qcConfigMu.RLock()
	if qcConfigLoaded {
		c := qcConfig
		qcConfigMu.RUnlock()
		return c
	}
	qcConfigMu.RUnlock()
	return ReloadQcConfig()
}

// ReloadQcConfig re-reads the QC config from system_settings and refreshes the
// cache. Called on config change so the next session picks up the new values.
func ReloadQcConfig() QcConfig {
	cfg := defaultQcConfig()
	if dao.DB != nil {
		if rows, err := dao.NewSystemSettingsDAO().GetByNamePrefix(context.Background(), dao.DB, "qc."); err == nil {
			for _, row := range rows {
				switch row.Name {
				case qcSettingEnabled:
					cfg.Enabled = strings.ToLower(strings.TrimSpace(row.Value)) != "false"
				case qcSettingMaxRules:
					if n, e := strconv.Atoi(strings.TrimSpace(row.Value)); e == nil && n > 0 {
						cfg.MaxRulesPerTenant = n
					}
				case qcSettingRetention:
					if n, e := strconv.Atoi(strings.TrimSpace(row.Value)); e == nil && n > 0 {
						cfg.RetentionDays = n
					}
				}
			}
		}
	}
	qcConfigMu.Lock()
	qcConfig = cfg
	qcConfigLoaded = true
	qcConfigMu.Unlock()
	return cfg
}

// QcSession is the per-conversation QC context. It loads the app's enabled
// rules once, compiles them, and inspects AI answers / user input on demand.
// It is single-goroutine (owned by one conversation) and must not be shared.
type QcSession struct {
	tenantID  string
	appType   string
	appID     string
	sessionID string
	chatID    string

	compiled      *CompiledRules
	answerMatcher *StreamMatcher
	userFired     map[string]bool
	// noBlock disables interception (workflow outputs and debug runs): block
	// hits are still recorded and alerted, but the stream is not replaced.
	noBlock bool
	// noAlert downgrades every action to record-only (debug runs).
	noAlert bool
	enabled bool
}

// NewQcSession loads and compiles the enabled rules for an app. It never fails:
// any error simply disables QC for this session (the chat must not be affected
// by QC problems).
func NewQcSession(ctx context.Context, tenantID, appType, appID, sessionID, chatID string, noBlock, noAlert bool) *QcSession {
	s := &QcSession{
		tenantID:  tenantID,
		appType:   appType,
		appID:     appID,
		sessionID: sessionID,
		chatID:    chatID,
		noBlock:   noBlock,
		noAlert:   noAlert,
		userFired: make(map[string]bool),
	}
	defer func() {
		if r := recover(); r != nil {
			common.Warn("qc session init panic", zap.Any("panic", r))
			s.enabled = false
		}
	}()

	if !GetQcConfig().Enabled || dao.DB == nil {
		return s
	}
	rules, err := dao.NewQcRuleDAO().ListEnabledByApp(ctx, dao.DB, appType, appID)
	if err != nil {
		common.Warn("qc session init failed to load rules", zap.Error(err))
		return s
	}
	if len(rules) == 0 {
		return s
	}
	compiled, err := CompileRules(rules)
	if err != nil {
		common.Warn("qc session init failed to compile rules", zap.Error(err))
		return s
	}
	s.compiled = compiled
	s.answerMatcher = NewStreamMatcher(compiled)
	s.answerMatcher.NoBlock = noBlock
	s.enabled = true
	return s
}

// Enabled reports whether QC is active for this session.
func (s *QcSession) Enabled() bool {
	return s != nil && s.enabled
}

// InspectAnswer inspects an AI-answer delta and returns the newly produced hits.
func (s *QcSession) InspectAnswer(delta string) []QcHitResult {
	if s == nil || !s.enabled || s.answerMatcher == nil {
		return nil
	}
	hits := s.answerMatcher.Inspect(delta, entity.QcScopeAIAnswer)
	full := s.answerMatcher.FullText()
	for _, h := range hits {
		s.record(h, full)
	}
	return hits
}

// InspectUserInput inspects a user message once. User input is only recorded
// and alerted, never blocked (intercepting the user's own words is out of
// scope and harms the experience).
func (s *QcSession) InspectUserInput(input string) {
	if s == nil || !s.enabled || s.compiled == nil || input == "" {
		return
	}
	matches := s.compiled.Match(input, entity.QcScopeUserInput)
	for _, m := range matches {
		if s.userFired[m.Rule.ID] {
			continue
		}
		s.userFired[m.Rule.ID] = true
		s.record(QcHitResult{
			Rule:        m.Rule,
			MatchedText: m.MatchedText,
			Scope:       entity.QcScopeUserInput,
		}, input)
	}
}

// InspectWorkflowOutput inspects a workflow End node's "node_finished" payload.
// Workflow runs never block (noBlock is set on the session), so this only
// records and alerts. Non-End node payloads are ignored.
func (s *QcSession) InspectWorkflowOutput(data string) {
	if s == nil || !s.enabled || s.compiled == nil || data == "" {
		return
	}
	text := extractWorkflowAnswerText(data)
	if text == "" {
		return
	}
	matches := s.compiled.Match(text, entity.QcScopeAIAnswer)
	for _, m := range matches {
		s.record(QcHitResult{
			Rule:        m.Rule,
			MatchedText: m.MatchedText,
			Scope:       entity.QcScopeAIAnswer,
		}, text)
	}
}

// extractWorkflowAnswerText extracts the inspectable text from a workflow
// node_finished payload. Only the terminal End node is inspected; its string
// outputs are flattened into a single text for matching.
func extractWorkflowAnswerText(data string) string {
	if data == "" {
		return ""
	}
	var payload struct {
		Outputs       any    `json:"outputs"`
		ComponentName string `json:"component_name"`
		ComponentType string `json:"component_type"`
	}
	if err := json.Unmarshal([]byte(data), &payload); err != nil {
		return ""
	}
	if !strings.EqualFold(payload.ComponentName, "End") && !strings.EqualFold(payload.ComponentType, "End") {
		return ""
	}
	return flattenWorkflowOutputs(payload.Outputs)
}

// flattenWorkflowOutputs turns a workflow End output (map / string / slice /
// scalar) into a single inspectable string.
func flattenWorkflowOutputs(outputs any) string {
	switch v := outputs.(type) {
	case nil:
		return ""
	case string:
		return v
	case map[string]any:
		var sb strings.Builder
		for _, val := range v {
			if s := flattenWorkflowOutputs(val); s != "" {
				if sb.Len() > 0 {
					sb.WriteByte(' ')
				}
				sb.WriteString(s)
			}
		}
		return sb.String()
	case []any:
		var sb strings.Builder
		for _, val := range v {
			if s := flattenWorkflowOutputs(val); s != "" {
				if sb.Len() > 0 {
					sb.WriteByte(' ')
				}
				sb.WriteString(s)
			}
		}
		return sb.String()
	default:
		return fmt.Sprintf("%v", v)
	}
}

// Blocked reports whether the session has been switched to the replacement
// message by a block-level hit.
func (s *QcSession) Blocked() bool {
	return s != nil && s.answerMatcher != nil && s.answerMatcher.Blocked
}

// Replacement returns the block replacement message.
func (s *QcSession) Replacement() string {
	if s == nil || s.answerMatcher == nil {
		return ""
	}
	return s.answerMatcher.Replacement
}

// BlockedRule returns the rule that triggered the block, if any.
func (s *QcSession) BlockedRule() *entity.QcRule {
	if s == nil || s.answerMatcher == nil {
		return nil
	}
	return s.answerMatcher.BlockedRule
}

// record sanitizes and enqueues a hit for asynchronous persistence + push.
func (s *QcSession) record(h QcHitResult, fullText string) {
	if s == nil || h.Rule == nil {
		return
	}
	matched := SanitizeSensitive(TruncateRunes(h.MatchedText, 200))
	before, after := buildContext(fullText, h.MatchedText, 50, 50)
	before = SanitizeSensitive(TruncateRunes(before, 100))
	after = SanitizeSensitive(TruncateRunes(after, 100))

	action := h.Rule.Action
	if s.noAlert {
		// Debug runs record but never alert or block.
		action = entity.QcActionLog
	} else if h.Blocked {
		if s.noBlock {
			// Workflow: block rule hit but the stream is not replaced — record
			// and alert only.
			action = entity.QcActionLogAndAlert
		} else {
			action = entity.QcActionBlockAndAlert
		}
	}

	hit := &entity.QcHit{
		ID:            common.GenerateToken(),
		TenantID:      s.tenantID,
		RuleID:        h.Rule.ID,
		RuleName:      h.Rule.Name,
		SessionID:     s.sessionID,
		ChatID:        s.chatID,
		AppType:       s.appType,
		AppID:         s.appID,
		Scope:         h.Scope,
		Severity:      h.Rule.Severity,
		MatchedText:   matched,
		ContextBefore: before,
		ContextAfter:  after,
		ActionTaken:   action,
		CreateTime:    time.Now().UnixMilli(),
	}
	qcHitWriter.enqueue(hit)
}

// buildContext extracts up to beforeRunes / afterRunes around the first
// occurrence of matchedText in fullText.
func buildContext(fullText, matchedText string, beforeRunes, afterRunes int) (string, string) {
	if matchedText == "" {
		return "", ""
	}
	idx := strings.Index(fullText, matchedText)
	if idx < 0 {
		return "", ""
	}
	runes := []rune(fullText)
	matchStart := utf8.RuneCountInString(fullText[:idx])
	matchLen := utf8.RuneCountInString(matchedText)

	beforeStart := matchStart - beforeRunes
	if beforeStart < 0 {
		beforeStart = 0
	}
	afterEnd := matchStart + matchLen + afterRunes
	if afterEnd > len(runes) {
		afterEnd = len(runes)
	}
	return string(runes[beforeStart:matchStart]), string(runes[matchStart+matchLen : afterEnd])
}

// qcHitWriter is the single background writer that persists hits and pushes
// realtime events. The chat goroutine only does a non-blocking enqueue, so QC
// persistence never blocks the conversation.
type qcHitWriterT struct {
	ch   chan *entity.QcHit
	once sync.Once
}

var qcHitWriter = &qcHitWriterT{ch: make(chan *entity.QcHit, 2048)}

func (w *qcHitWriterT) start() {
	w.once.Do(func() {
		go func() {
			for hit := range w.ch {
				w.write(hit)
			}
		}()
	})
}

func (w *qcHitWriterT) enqueue(hit *entity.QcHit) {
	w.start()
	select {
	case w.ch <- hit:
	default:
		// Queue full: degrade to a synchronous write so compliance evidence is
		// never silently dropped.
		w.write(hit)
	}
}

func (w *qcHitWriterT) write(hit *entity.QcHit) {
	defer func() {
		if r := recover(); r != nil {
			common.Warn("qc hit write panic", zap.Any("panic", r))
		}
	}()
	if dao.DB != nil {
		if err := dao.NewQcHitDAO().Create(context.Background(), dao.DB, hit); err != nil {
			common.Warn("qc hit write failed", zap.Error(err))
			return
		}
	}
	// Only warn / block hits are pushed to the realtime panel (info is noise).
	if hit.ActionTaken == entity.QcActionLogAndAlert || hit.ActionTaken == entity.QcActionBlockAndAlert {
		GetQcHub().Broadcast(hit.TenantID, QcPushEvent{Type: "qc_hit", Data: hit})
	}
}
