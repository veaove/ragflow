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

package entity

import (
	"database/sql/driver"
	"encoding/json"
)

// Quality-inspection (QC) app form factors. A rule is bound to one app
// (app_type + app_id) and only affects that app's sessions.
const (
	QcAppTypeChat   = "chat"   // chat application (dialog)
	QcAppTypeCanvas = "canvas" // chatflow / workflow canvas
)

// QC match modes.
const (
	QcMatchContains  = "contains"   // substring match (default)
	QcMatchWholeWord = "whole_word" // word-boundary match
	QcMatchRegex     = "regex"      // user-supplied regex
)

// QC scopes.
const (
	QcScopeAIAnswer  = "ai_answer"  // inspect model output only
	QcScopeUserInput = "user_input" // inspect user input only
	QcScopeBoth      = "both"       // inspect both
)

// QC severity levels.
const (
	QcSeverityInfo  = "info"  // record only
	QcSeverityWarn  = "warn"  // record + alert
	QcSeverityBlock = "block" // block + alert
)

// QC actions.
const (
	QcActionLog           = "log"             // record only
	QcActionLogAndAlert   = "log_and_alert"   // record + alert
	QcActionBlockAndAlert = "block_and_alert" // block + alert
)

// QcKeywords is a JSON-encoded string list (rule trigger keywords).
type QcKeywords []string

// Value implements driver.Valuer.
func (k QcKeywords) Value() (driver.Value, error) {
	if k == nil {
		return nil, nil
	}
	return json.Marshal(k)
}

// Scan implements sql.Scanner.
func (k *QcKeywords) Scan(value interface{}) error {
	if value == nil {
		*k = nil
		return nil
	}
	b, ok := value.([]byte)
	if !ok {
		return json.Unmarshal([]byte(value.(string)), k)
	}
	return json.Unmarshal(b, k)
}

// QcRule is a quality-inspection rule. Its (AppType, AppID) is the rule's HOME
// app — where it was created in the QC menu, used for ownership checks and for
// filtering that menu. Being the home app does NOT apply the rule: a rule runs
// for an app only while a QcRuleBinding row exists, which is what the "选用规则"
// checkbox list in the chat / agent settings writes (one row per ticked rule,
// home rules included).
type QcRule struct {
	ID            string     `gorm:"column:id;primaryKey;size:32" json:"id"`
	TenantID      string     `gorm:"column:tenant_id;size:64;not null;index" json:"tenant_id"`
	AppType       string     `gorm:"column:app_type;size:16;not null;index" json:"app_type"`
	AppID         string     `gorm:"column:app_id;size:64;not null;index" json:"app_id"`
	Name          string     `gorm:"column:name;size:50;not null" json:"name"`
	Keywords      QcKeywords `gorm:"column:keywords;type:longtext;not null" json:"keywords"`
	MatchMode     string     `gorm:"column:match_mode;size:16;not null;default:contains" json:"match_mode"`
	Scope         string     `gorm:"column:scope;size:16;not null;default:ai_answer" json:"scope"`
	Severity      string     `gorm:"column:severity;size:16;not null;default:warn" json:"severity"`
	Action        string     `gorm:"column:action;size:24;not null;default:log_and_alert" json:"action"`
	PromptMessage string     `gorm:"column:prompt_message;size:500;not null" json:"prompt_message"`
	Enabled       bool       `gorm:"column:enabled;not null;default:1" json:"enabled"`
	CreatedBy     string     `gorm:"column:created_by;size:64" json:"created_by,omitempty"`
	BaseModel
}

// TableName specify table name.
func (QcRule) TableName() string {
	return "qc_rule"
}

// QcRuleBinding makes a rule apply to one app. It is the single source of
// truth for "which rules run here": a rule applies to an app if and only if a
// row exists for (rule, app), regardless of which app created it. One rule can
// therefore serve many apps without being duplicated.
type QcRuleBinding struct {
	ID         string `gorm:"column:id;primaryKey;size:32" json:"id"`
	TenantID   string `gorm:"column:tenant_id;size:64;not null;index" json:"tenant_id"`
	RuleID     string `gorm:"column:rule_id;size:32;not null;uniqueIndex:uk_qc_binding,priority:1" json:"rule_id"`
	AppType    string `gorm:"column:app_type;size:16;not null;uniqueIndex:uk_qc_binding,priority:2" json:"app_type"`
	AppID      string `gorm:"column:app_id;size:64;not null;index;uniqueIndex:uk_qc_binding,priority:3" json:"app_id"`
	CreateTime int64  `gorm:"column:create_time;not null" json:"create_time"`
}

// TableName specify table name.
func (QcRuleBinding) TableName() string {
	return "qc_rule_binding"
}

// QcHit is a single quality-inspection match record (compliance evidence).
type QcHit struct {
	ID            string `gorm:"column:id;primaryKey;size:32" json:"id"`
	TenantID      string `gorm:"column:tenant_id;size:64;not null;index" json:"tenant_id"`
	RuleID        string `gorm:"column:rule_id;size:32;not null;index" json:"rule_id"`
	RuleName      string `gorm:"column:rule_name;size:50;not null" json:"rule_name"`
	SessionID     string `gorm:"column:session_id;size:64;not null;index" json:"session_id"`
	ChatID        string `gorm:"column:chat_id;size:32;not null" json:"chat_id"`
	AppType       string `gorm:"column:app_type;size:16;not null;index" json:"app_type"`
	AppID         string `gorm:"column:app_id;size:64;not null;index" json:"app_id"`
	Scope         string `gorm:"column:scope;size:16;not null" json:"scope"`
	Severity      string `gorm:"column:severity;size:16;not null" json:"severity"`
	MatchedText   string `gorm:"column:matched_text;size:200;not null" json:"matched_text"`
	ContextBefore string `gorm:"column:context_before;size:100" json:"context_before,omitempty"`
	ContextAfter  string `gorm:"column:context_after;size:100" json:"context_after,omitempty"`
	ActionTaken   string `gorm:"column:action_taken;size:24;not null" json:"action_taken"`
	CreateTime    int64  `gorm:"column:create_time;not null;index" json:"create_time"`
}

// TableName specify table name.
func (QcHit) TableName() string {
	return "qc_hit"
}
