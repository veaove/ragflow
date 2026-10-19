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

// ConversationVariable is a Chatflow conversation-scoped variable, persisted
// per conversation and read back across turns (FR-04-03). It is deliberately
// NOT stored in the conversation DSL so version snapshots stay clean.
type ConversationVariable struct {
	ID             string `gorm:"column:id;primaryKey;size:32" json:"id"`
	ConversationID string `gorm:"column:conversation_id;size:32;not null" json:"conversation_id"`
	CanvasID       string `gorm:"column:canvas_id;size:32;not null" json:"canvas_id"`
	Name           string `gorm:"column:name;size:128;not null" json:"name"`
	Value          string `gorm:"column:value;type:longtext" json:"value"`
	ValueType      string `gorm:"column:value_type;size:32;not null;default:string" json:"value_type"`
	UpdateTime     int64  `gorm:"column:update_time;not null" json:"update_time"`
}

// TableName specify table name
func (ConversationVariable) TableName() string {
	return "conversation_variable"
}

// EnvironmentVariable is an app-level read-only variable. secret values are
// stored encrypted; the unique key (canvas_id, name, version_seq) lets each
// published version snapshot keep its own copy (version_seq=0 is the draft).
type EnvironmentVariable struct {
	ID         string `gorm:"column:id;primaryKey;size:32" json:"id"`
	CanvasID   string `gorm:"column:canvas_id;size:32;not null" json:"canvas_id"`
	Name       string `gorm:"column:name;size:128;not null" json:"name"`
	Value      string `gorm:"column:value;type:text;not null" json:"value"`
	ValueType  string `gorm:"column:value_type;size:16;not null;default:text" json:"value_type"`
	VersionSeq int    `gorm:"column:version_seq;not null;default:0" json:"version_seq"`
	CreateTime int64  `gorm:"column:create_time;not null" json:"create_time"`
	UpdateTime int64  `gorm:"column:update_time;not null" json:"update_time"`
}

// TableName specify table name
func (EnvironmentVariable) TableName() string {
	return "environment_variable"
}

// AppAPIKey is a per-app credential for the public Workflow/Chatflow APIs.
// Only the hash is stored; the plaintext is shown once at creation.
type AppAPIKey struct {
	ID               string `gorm:"column:id;primaryKey;size:32" json:"id"`
	CanvasID         string `gorm:"column:canvas_id;size:32;not null" json:"canvas_id"`
	OwnerUserID      string `gorm:"column:owner_user_id;size:64;not null" json:"owner_user_id"`
	KeyPrefix        string `gorm:"column:key_prefix;size:16;not null" json:"key_prefix"`
	KeyHash          string `gorm:"column:key_hash;size:128;not null" json:"key_hash"`
	Status           string `gorm:"column:status;size:16;not null;default:active" json:"status"`
	RPMLimit         int    `gorm:"column:rpm_limit;not null;default:60" json:"rpm_limit"`
	ConcurrencyLimit int    `gorm:"column:concurrency_limit;not null;default:5" json:"concurrency_limit"`
	BurstLimit       int    `gorm:"column:burst_limit;not null;default:10" json:"burst_limit"`
	LastUsedAt       *int64 `gorm:"column:last_used_at" json:"last_used_at,omitempty"`
	CreatedBy        string `gorm:"column:created_by;size:64" json:"created_by,omitempty"`
	CreateTime       int64  `gorm:"column:create_time;not null" json:"create_time"`
}

// TableName specify table name
func (AppAPIKey) TableName() string {
	return "app_api_key"
}

// AuditLog is an independent, ≥180-day audit trail for high-risk mutations. It
// is deliberately separate from run records so its retention never follows the
// 90-day run-record purge.
type AuditLog struct {
	ID         string `gorm:"column:id;primaryKey;size:32" json:"id"`
	TenantID   string `gorm:"column:tenant_id;size:64;not null" json:"tenant_id"`
	CanvasID   string `gorm:"column:canvas_id;size:32;not null" json:"canvas_id"`
	Action     string `gorm:"column:action;size:32;not null" json:"action"`
	ObjectType string `gorm:"column:object_type;size:32;not null" json:"object_type"`
	ObjectID   string `gorm:"column:object_id;size:32" json:"object_id,omitempty"`
	Before     JSONMap `gorm:"column:before;type:longtext" json:"before,omitempty"`
	After      JSONMap `gorm:"column:after;type:longtext" json:"after,omitempty"`
	Operator   string `gorm:"column:operator;size:64;not null" json:"operator"`
	CreateTime int64  `gorm:"column:create_time;not null" json:"create_time"`
}

// TableName specify table name
func (AuditLog) TableName() string {
	return "audit_log"
}
