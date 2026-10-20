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

package handler

import (
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"gorm.io/gorm"

	"ragflow/internal/common"
	"ragflow/internal/dao"
	"ragflow/internal/entity"
	"ragflow/internal/service"
)

// QC system-setting keys (mirror of service package constants, kept local to
// avoid exporting them just for the handler).
const (
	qcSettingEnabled   = "qc.enabled"
	qcSettingMaxRules  = "qc.max_rules_per_tenant"
	qcSettingRetention = "qc.retention_days"
)

// QcHandler serves quality-inspection rule CRUD, hit queries/export, rule test,
// system config and the realtime stream.
type QcHandler struct{}

// NewQcHandler creates the QC handler.
func NewQcHandler() *QcHandler {
	return &QcHandler{}
}

// qcRuleBody is the create/update request payload for a QC rule.
type qcRuleBody struct {
	AppType       string   `json:"app_type"`
	AppID         string   `json:"app_id"`
	Name          string   `json:"name"`
	Keywords      []string `json:"keywords"`
	MatchMode     string   `json:"match_mode"`
	Scope         string   `json:"scope"`
	Severity      string   `json:"severity"`
	Action        string   `json:"action"`
	PromptMessage string   `json:"prompt_message"`
	Enabled       *bool    `json:"enabled"`
}

var errQcAppNotFound = errors.New("app not found")

// resolveAppOwner loads the app (chat or canvas) and returns its owner user id
// (which is also the tenant id in RAGFlow).
func resolveAppOwner(c *gin.Context, appType, appID string) (string, error) {
	if dao.DB == nil {
		return "", errors.New("database not ready")
	}
	switch appType {
	case entity.QcAppTypeChat:
		chat, err := dao.NewChatDAO().GetByID(c.Request.Context(), dao.DB, appID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return "", errQcAppNotFound
			}
			return "", err
		}
		return chat.TenantID, nil
	case entity.QcAppTypeCanvas:
		canvas, err := dao.NewUserCanvasDAO().GetByID(c.Request.Context(), dao.DB, appID)
		if err != nil {
			if errors.Is(err, dao.ErrUserCanvasNotFound) {
				return "", errQcAppNotFound
			}
			return "", err
		}
		return canvas.UserID, nil
	default:
		return "", errors.New("invalid app_type")
	}
}

// validateQcRule validates the rule payload and normalizes defaults.
func validateQcRule(body *qcRuleBody) error {
	if body.AppType != entity.QcAppTypeChat && body.AppType != entity.QcAppTypeCanvas {
		return errors.New("invalid app_type")
	}
	if body.AppID == "" {
		return errors.New("app_id is required")
	}
	body.Name = strings.TrimSpace(body.Name)
	if body.Name == "" {
		return errors.New("name is required")
	}
	if len([]rune(body.Name)) > 50 {
		return errors.New("name must be at most 50 characters")
	}
	if len(body.Keywords) == 0 {
		return errors.New("at least one keyword is required")
	}
	// Deduplicate and drop empty keywords.
	seen := make(map[string]bool)
	keywords := make([]string, 0, len(body.Keywords))
	for _, kw := range body.Keywords {
		kw = strings.TrimSpace(kw)
		if kw == "" || seen[kw] {
			continue
		}
		seen[kw] = true
		keywords = append(keywords, kw)
	}
	if len(keywords) == 0 {
		return errors.New("at least one keyword is required")
	}
	if len(keywords) > 50 {
		return errors.New("at most 50 keywords per rule")
	}
	body.Keywords = keywords

	switch body.MatchMode {
	case "":
		body.MatchMode = entity.QcMatchContains
	case entity.QcMatchContains, entity.QcMatchWholeWord, entity.QcMatchRegex:
	default:
		return errors.New("invalid match_mode")
	}
	if body.MatchMode == entity.QcMatchRegex {
		for _, kw := range body.Keywords {
			if _, err := regexp.Compile(kw); err != nil {
				return fmt.Errorf("invalid regex %q: %w", kw, err)
			}
		}
	}

	switch body.Scope {
	case "":
		body.Scope = entity.QcScopeAIAnswer
	case entity.QcScopeAIAnswer, entity.QcScopeUserInput, entity.QcScopeBoth:
	default:
		return errors.New("invalid scope")
	}

	switch body.Severity {
	case "":
		body.Severity = entity.QcSeverityWarn
	case entity.QcSeverityInfo, entity.QcSeverityWarn, entity.QcSeverityBlock:
	default:
		return errors.New("invalid severity")
	}

	switch body.Action {
	case "":
		body.Action = entity.QcActionLogAndAlert
	case entity.QcActionLog, entity.QcActionLogAndAlert, entity.QcActionBlockAndAlert:
	default:
		return errors.New("invalid action")
	}

	// severity / action consistency.
	if body.Severity == entity.QcSeverityBlock && body.Action != entity.QcActionBlockAndAlert {
		return errors.New("block severity requires block_and_alert action")
	}
	if body.Severity != entity.QcSeverityBlock && body.Action == entity.QcActionBlockAndAlert {
		return errors.New("block_and_alert action requires block severity")
	}

	body.PromptMessage = strings.TrimSpace(body.PromptMessage)
	if body.PromptMessage == "" {
		return errors.New("prompt_message is required")
	}
	if len([]rune(body.PromptMessage)) > 500 {
		return errors.New("prompt_message must be at most 500 characters")
	}
	return nil
}

// ListRules handles GET /qc/rules?app_type=&app_id=&...
func (h *QcHandler) ListRules(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	appType := c.Query("app_type")
	appID := c.Query("app_id")
	if appType == "" || appID == "" {
		common.ErrorWithCode(c, common.CodeArgumentError, "app_type and app_id are required")
		return
	}
	owner, err := resolveAppOwner(c, appType, appID)
	if err != nil {
		if errors.Is(err, errQcAppNotFound) {
			common.ErrorWithCode(c, common.CodeNotFound, "app not found")
			return
		}
		common.ErrorWithCode(c, common.CodeServerError, err.Error())
		return
	}
	if owner != user.ID {
		common.ErrorWithCode(c, common.CodeForbidden, "no permission to manage this app's QC rules")
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = 20
	}

	var enabled *bool
	if v := c.Query("enabled"); v != "" {
		b := strings.EqualFold(v, "true") || v == "1"
		enabled = &b
	}
	filter := dao.QcRuleListFilter{
		AppType:  appType,
		AppID:    appID,
		Keyword:  c.Query("keyword"),
		Scope:    c.Query("scope"),
		Severity: c.Query("severity"),
		Enabled:  enabled,
	}
	rules, total, err := dao.NewQcRuleDAO().List(c.Request.Context(), dao.DB, filter, (page-1)*size, size)
	if err != nil {
		common.ErrorWithCode(c, common.CodeServerError, err.Error())
		return
	}
	common.SuccessWithDataAndTotal(c, rules, total, "success")
}

// CreateRule handles POST /qc/rules.
func (h *QcHandler) CreateRule(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	var body qcRuleBody
	if err := c.ShouldBindJSON(&body); err != nil {
		common.ErrorWithCode(c, common.CodeArgumentError, "invalid request body")
		return
	}
	if err := validateQcRule(&body); err != nil {
		common.ErrorWithCode(c, common.CodeArgumentError, err.Error())
		return
	}
	owner, err := resolveAppOwner(c, body.AppType, body.AppID)
	if err != nil {
		if errors.Is(err, errQcAppNotFound) {
			common.ErrorWithCode(c, common.CodeNotFound, "app not found")
			return
		}
		common.ErrorWithCode(c, common.CodeServerError, err.Error())
		return
	}
	if owner != user.ID {
		common.ErrorWithCode(c, common.CodeForbidden, "no permission to manage this app's QC rules")
		return
	}

	// Rule-count cap.
	cfg := service.GetQcConfig()
	count, err := dao.NewQcRuleDAO().CountByTenant(c.Request.Context(), dao.DB, owner)
	if err != nil {
		common.ErrorWithCode(c, common.CodeServerError, err.Error())
		return
	}
	if int(count) >= cfg.MaxRulesPerTenant {
		common.ErrorWithCode(c, common.CodeDataError, fmt.Sprintf("rule limit reached (%d)", cfg.MaxRulesPerTenant))
		return
	}
	exists, err := dao.NewQcRuleDAO().ExistsNameInApp(c.Request.Context(), dao.DB, body.AppType, body.AppID, body.Name, "")
	if err != nil {
		common.ErrorWithCode(c, common.CodeServerError, err.Error())
		return
	}
	if exists {
		common.ErrorWithCode(c, common.CodeDataError, "rule name already exists in this app")
		return
	}

	enabled := true
	if body.Enabled != nil {
		enabled = *body.Enabled
	}
	rule := &entity.QcRule{
		ID:            common.GenerateToken(),
		TenantID:      owner,
		AppType:       body.AppType,
		AppID:         body.AppID,
		Name:          body.Name,
		Keywords:      entity.QcKeywords(body.Keywords),
		MatchMode:     body.MatchMode,
		Scope:         body.Scope,
		Severity:      body.Severity,
		Action:        body.Action,
		PromptMessage: body.PromptMessage,
		Enabled:       enabled,
		CreatedBy:     user.ID,
	}
	if err := dao.NewQcRuleDAO().Create(c.Request.Context(), dao.DB, rule); err != nil {
		common.ErrorWithCode(c, common.CodeServerError, err.Error())
		return
	}
	service.ReloadQcConfig()
	common.SuccessWithData(c, rule, "success")
}

// GetRule handles GET /qc/rules/:id.
func (h *QcHandler) GetRule(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	rule, err := dao.NewQcRuleDAO().GetByID(c.Request.Context(), dao.DB, c.Param("id"))
	if err != nil {
		common.ErrorWithCode(c, common.CodeNotFound, "rule not found")
		return
	}
	if rule.TenantID != user.ID {
		common.ErrorWithCode(c, common.CodeNotFound, "rule not found")
		return
	}
	common.SuccessWithData(c, rule, "success")
}

// UpdateRule handles PUT /qc/rules/:id.
func (h *QcHandler) UpdateRule(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	rule, err := dao.NewQcRuleDAO().GetByID(c.Request.Context(), dao.DB, c.Param("id"))
	if err != nil {
		common.ErrorWithCode(c, common.CodeNotFound, "rule not found")
		return
	}
	if rule.TenantID != user.ID {
		common.ErrorWithCode(c, common.CodeNotFound, "rule not found")
		return
	}
	var body qcRuleBody
	if err := c.ShouldBindJSON(&body); err != nil {
		common.ErrorWithCode(c, common.CodeArgumentError, "invalid request body")
		return
	}
	// app binding is immutable; the body only carries editable fields.
	body.AppType = rule.AppType
	body.AppID = rule.AppID
	if err := validateQcRule(&body); err != nil {
		common.ErrorWithCode(c, common.CodeArgumentError, err.Error())
		return
	}
	exists, err := dao.NewQcRuleDAO().ExistsNameInApp(c.Request.Context(), dao.DB, rule.AppType, rule.AppID, body.Name, rule.ID)
	if err != nil {
		common.ErrorWithCode(c, common.CodeServerError, err.Error())
		return
	}
	if exists {
		common.ErrorWithCode(c, common.CodeDataError, "rule name already exists in this app")
		return
	}

	updates := map[string]interface{}{
		"name":           body.Name,
		"keywords":       entity.QcKeywords(body.Keywords),
		"match_mode":     body.MatchMode,
		"scope":          body.Scope,
		"severity":       body.Severity,
		"action":         body.Action,
		"prompt_message": body.PromptMessage,
	}
	if body.Enabled != nil {
		updates["enabled"] = *body.Enabled
	}
	if err := dao.NewQcRuleDAO().UpdateByID(c.Request.Context(), dao.DB, rule.ID, updates); err != nil {
		common.ErrorWithCode(c, common.CodeServerError, err.Error())
		return
	}
	service.ReloadQcConfig()
	updated, _ := dao.NewQcRuleDAO().GetByID(c.Request.Context(), dao.DB, rule.ID)
	common.SuccessWithData(c, updated, "success")
}

// DeleteRule handles DELETE /qc/rules/:id.
func (h *QcHandler) DeleteRule(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	rule, err := dao.NewQcRuleDAO().GetByID(c.Request.Context(), dao.DB, c.Param("id"))
	if err != nil {
		common.ErrorWithCode(c, common.CodeNotFound, "rule not found")
		return
	}
	if rule.TenantID != user.ID {
		common.ErrorWithCode(c, common.CodeNotFound, "rule not found")
		return
	}
	if err := dao.NewQcRuleDAO().DeleteByID(c.Request.Context(), dao.DB, rule.ID); err != nil {
		common.ErrorWithCode(c, common.CodeServerError, err.Error())
		return
	}
	common.SuccessWithData(c, nil, "success")
}

// ToggleRule handles POST /qc/rules/:id/toggle.
func (h *QcHandler) ToggleRule(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	rule, err := dao.NewQcRuleDAO().GetByID(c.Request.Context(), dao.DB, c.Param("id"))
	if err != nil {
		common.ErrorWithCode(c, common.CodeNotFound, "rule not found")
		return
	}
	if rule.TenantID != user.ID {
		common.ErrorWithCode(c, common.CodeNotFound, "rule not found")
		return
	}
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		common.ErrorWithCode(c, common.CodeArgumentError, "invalid request body")
		return
	}
	if err := dao.NewQcRuleDAO().UpdateByID(c.Request.Context(), dao.DB, rule.ID, map[string]interface{}{"enabled": body.Enabled}); err != nil {
		common.ErrorWithCode(c, common.CodeServerError, err.Error())
		return
	}
	common.SuccessWithData(c, nil, "success")
}

// TestRule handles POST /qc/rules/test (no persistence).
func (h *QcHandler) TestRule(c *gin.Context) {
	_, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	var body struct {
		Keywords  []string `json:"keywords"`
		MatchMode string   `json:"match_mode"`
		Text      string   `json:"text"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		common.ErrorWithCode(c, common.CodeArgumentError, "invalid request body")
		return
	}
	if body.MatchMode == "" {
		body.MatchMode = entity.QcMatchContains
	}
	result, err := service.QcTestMatch(body.Keywords, body.MatchMode, body.Text)
	if err != nil {
		common.ErrorWithCode(c, common.CodeArgumentError, err.Error())
		return
	}
	common.SuccessWithData(c, result, "success")
}

// ListHits handles GET /qc/hits.
func (h *QcHandler) ListHits(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	filter := qcHitFilterFromQuery(c)
	filter.TenantID = user.ID

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = 20
	}
	hits, total, err := dao.NewQcHitDAO().List(c.Request.Context(), dao.DB, filter, (page-1)*size, size)
	if err != nil {
		common.ErrorWithCode(c, common.CodeServerError, err.Error())
		return
	}
	common.SuccessWithDataAndTotal(c, hits, total, "success")
}

// GetHit handles GET /qc/hits/:id.
func (h *QcHandler) GetHit(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	hit, err := dao.NewQcHitDAO().GetByID(c.Request.Context(), dao.DB, c.Param("id"))
	if err != nil {
		common.ErrorWithCode(c, common.CodeNotFound, "hit not found")
		return
	}
	if hit.TenantID != user.ID {
		common.ErrorWithCode(c, common.CodeNotFound, "hit not found")
		return
	}
	common.SuccessWithData(c, hit, "success")
}

// ExportHits handles GET /qc/hits/export (CSV).
func (h *QcHandler) ExportHits(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	filter := qcHitFilterFromQuery(c)
	filter.TenantID = user.ID
	hits, err := dao.NewQcHitDAO().ListAll(c.Request.Context(), dao.DB, filter)
	if err != nil {
		common.ErrorWithCode(c, common.CodeServerError, err.Error())
		return
	}

	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", `attachment; filename="qc_hits.csv"`)
	// UTF-8 BOM so Excel opens Chinese correctly.
	c.Writer.Write([]byte{0xEF, 0xBB, 0xBF})
	w := csv.NewWriter(c.Writer)
	_ = w.Write([]string{"time", "session_id", "chat_id", "rule_id", "rule_name", "matched_text", "scope", "severity", "action_taken", "context_before", "context_after"})
	for _, hit := range hits {
		_ = w.Write([]string{
			time.UnixMilli(hit.CreateTime).Local().Format("2006-01-02 15:04:05"),
			hit.SessionID,
			hit.ChatID,
			hit.RuleID,
			hit.RuleName,
			hit.MatchedText,
			hit.Scope,
			hit.Severity,
			hit.ActionTaken,
			hit.ContextBefore,
			hit.ContextAfter,
		})
	}
	w.Flush()
}

func qcHitFilterFromQuery(c *gin.Context) dao.QcHitListFilter {
	var from, to int64
	if v := c.Query("from"); v != "" {
		from, _ = strconv.ParseInt(v, 10, 64)
	}
	if v := c.Query("to"); v != "" {
		to, _ = strconv.ParseInt(v, 10, 64)
	}
	return dao.QcHitListFilter{
		From:      from,
		To:        to,
		RuleID:    c.Query("rule_id"),
		Scope:     c.Query("scope"),
		Severity:  c.Query("severity"),
		SessionID: c.Query("session_id"),
		AppType:   c.Query("app_type"),
		AppID:     c.Query("app_id"),
	}
}

// GetConfig handles GET /qc/config.
func (h *QcHandler) GetConfig(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	if !isTenantOwner(c.Request.Context(), user.ID) {
		common.ErrorWithCode(c, common.CodeForbidden, "no permission")
		return
	}
	cfg := service.GetQcConfig()
	common.SuccessWithData(c, gin.H{
		"enabled":              cfg.Enabled,
		"max_rules_per_tenant": cfg.MaxRulesPerTenant,
		"retention_days":       cfg.RetentionDays,
	}, "success")
}

// UpdateConfig handles PUT /qc/config.
func (h *QcHandler) UpdateConfig(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	if !isTenantOwner(c.Request.Context(), user.ID) {
		common.ErrorWithCode(c, common.CodeForbidden, "no permission")
		return
	}
	var body struct {
		Enabled           *bool `json:"enabled"`
		MaxRulesPerTenant *int  `json:"max_rules_per_tenant"`
		RetentionDays     *int  `json:"retention_days"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		common.ErrorWithCode(c, common.CodeArgumentError, "invalid request body")
		return
	}
	settingsDAO := dao.NewSystemSettingsDAO()
	if body.Enabled != nil {
		if err := settingsDAO.SaveOrCreate(c.Request.Context(), dao.DB, qcSettingEnabled, strconv.FormatBool(*body.Enabled), "qc", "bool"); err != nil {
			common.ErrorWithCode(c, common.CodeServerError, err.Error())
			return
		}
	}
	if body.MaxRulesPerTenant != nil {
		if err := settingsDAO.SaveOrCreate(c.Request.Context(), dao.DB, qcSettingMaxRules, strconv.Itoa(*body.MaxRulesPerTenant), "qc", "int"); err != nil {
			common.ErrorWithCode(c, common.CodeServerError, err.Error())
			return
		}
	}
	if body.RetentionDays != nil {
		if err := settingsDAO.SaveOrCreate(c.Request.Context(), dao.DB, qcSettingRetention, strconv.Itoa(*body.RetentionDays), "qc", "int"); err != nil {
			common.ErrorWithCode(c, common.CodeServerError, err.Error())
			return
		}
	}
	service.ReloadQcConfig()
	common.SuccessWithData(c, nil, "success")
}

// isTenantOwner reports whether userID owns a tenant (i.e. is a tenant admin),
// used to gate the system-config endpoints.
func isTenantOwner(ctx context.Context, userID string) bool {
	if userID == "" || dao.DB == nil {
		return false
	}
	rows, err := dao.NewUserTenantDAO().GetByUserIDAndRole(ctx, dao.DB, userID, "owner")
	if err != nil {
		return false
	}
	return len(rows) > 0
}

var qcWebsocketUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// Stream handles WS /qc/stream — realtime hit push for the current tenant.
// It is registered outside the AuthMiddleware group because a browser
// WebSocket cannot attach the Authorization header to the upgrade request;
// the token is therefore accepted via the `token` query parameter (or the
// header when a non-browser client connects).
func (h *QcHandler) Stream(c *gin.Context) {
	user, code, _ := GetUser(c)
	if code != common.CodeSuccess {
		token := c.Query("token")
		if token == "" {
			token = c.GetHeader("Authorization")
		}
		if token != "" {
			if u, uc, err := service.NewUserService().GetUserByToken(c.Request.Context(), token); err == nil && uc == common.CodeSuccess {
				c.Set("user", u)
				user = u
			}
		}
	}
	if user == nil {
		common.ErrorWithCode(c, common.CodeUnauthorized, "User not found")
		return
	}

	conn, err := qcWebsocketUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	ch, cancel := service.GetQcHub().Subscribe(user.ID)
	defer cancel()

	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()

	for {
		select {
		case <-done:
			return
		case ev, ok := <-ch:
			if !ok {
				return
			}
			if err := conn.WriteJSON(ev); err != nil {
				return
			}
		}
	}
}
