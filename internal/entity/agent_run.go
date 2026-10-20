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

// Agent run status values.
const (
	RunStatusQueued    = "queued"
	RunStatusRunning   = "running"
	RunStatusSucceeded = "succeeded"
	RunStatusFailed    = "failed"
	RunStatusStopped   = "stopped"
	RunStatusPartial   = "partial"
)

// Agent node execution status values.
const (
	NodeStatusWaiting  = "waiting"
	NodeStatusRunning  = "running"
	NodeStatusSucceeded = "succeeded"
	NodeStatusFailed   = "failed"
	NodeStatusSkipped  = "skipped"
	NodeStatusRetrying = "retrying"
)

// Agent run trigger types.
const (
	RunTriggerDebug   = "debug"
	RunTriggerAPI     = "api"
	RunTriggerWebapp  = "webapp"
	RunTriggerEmbed   = "embed"
	RunTriggerWebhook = "webhook"
)

// AgentRun is one workflow/chatflow execution instance (PRD workflow_run).
// It is the durable home of run_id, status, usage, idempotency and budget
// metadata, decoupled from the conversational message table.
type AgentRun struct {
	ID              string `gorm:"column:id;primaryKey;size:32" json:"id"`
	CanvasID        string `gorm:"column:canvas_id;size:32;not null" json:"canvas_id"`
	TenantID        string `gorm:"column:tenant_id;size:64;not null" json:"tenant_id"`
	VersionSeq      int    `gorm:"column:version_seq;not null;default:0" json:"version_seq"`
	TriggerType     string `gorm:"column:trigger_type;size:16;not null" json:"trigger_type"`
	Status          string `gorm:"column:status;size:16;not null" json:"status"`
	Inputs          JSONMap `gorm:"column:inputs;type:longtext" json:"inputs,omitempty"`
	Outputs         JSONMap `gorm:"column:outputs;type:longtext" json:"outputs,omitempty"`
	ErrorCode       string `gorm:"column:error_code;size:64" json:"error_code,omitempty"`
	ErrorMessage    string `gorm:"column:error_message;type:text" json:"error_message,omitempty"`
	DurationMS      int    `gorm:"column:duration_ms;not null;default:0" json:"duration_ms"`
	MaxDurationMS   int    `gorm:"column:max_duration_ms;not null;default:300000" json:"max_duration_ms"`
	PromptTokens    int    `gorm:"column:prompt_tokens;not null;default:0" json:"prompt_tokens"`
	CompletionTokens int   `gorm:"column:completion_tokens;not null;default:0" json:"completion_tokens"`
	ConversationID  string `gorm:"column:conversation_id;size:32" json:"conversation_id,omitempty"`
	// IdempotencyKey is NULL when the caller did not supply one. NULL (not
	// "") matters: the unique key is (canvas_id, idempotency_key) and both
	// MySQL and SQLite treat NULLs as distinct, so ordinary runs (no
	// idempotency key) never collide with each other. An empty string
	// would make the second run of a canvas violate the constraint and lose
	// its run record.
	IdempotencyKey  *string `gorm:"column:idempotency_key;size:128" json:"idempotency_key,omitempty"`
	APIKeyID        string `gorm:"column:api_key_id;size:32" json:"api_key_id,omitempty"`
	CreatedBy       string `gorm:"column:created_by;size:64" json:"created_by,omitempty"`
	CreateTime      int64  `gorm:"column:create_time;not null" json:"create_time"`
	UpdateTime      int64  `gorm:"column:update_time;not null" json:"update_time"`
}

// TableName specify table name
func (AgentRun) TableName() string {
	return "agent_run"
}

// AgentNodeExecution is one node's inputs/process/outputs/error within a run
// (PRD workflow_node_execution). Persisted so debugging survives page refresh.
type AgentNodeExecution struct {
	ID          string `gorm:"column:id;primaryKey;size:32" json:"id"`
	RunID       string `gorm:"column:run_id;size:32;not null" json:"run_id"`
	CanvasID    string `gorm:"column:canvas_id;size:32;not null" json:"canvas_id"`
	NodeID      string `gorm:"column:node_id;size:64;not null" json:"node_id"`
	NodeType    string `gorm:"column:node_type;size:64;not null" json:"node_type"`
	Status      string `gorm:"column:status;size:16;not null" json:"status"`
	Inputs      JSONMap `gorm:"column:inputs;type:longtext" json:"inputs,omitempty"`
	Process     JSONMap `gorm:"column:process;type:longtext" json:"process,omitempty"`
	Outputs     JSONMap `gorm:"column:outputs;type:longtext" json:"outputs,omitempty"`
	ErrorCode   string `gorm:"column:error_code;size:64" json:"error_code,omitempty"`
	ErrorMessage string `gorm:"column:error_message;type:text" json:"error_message,omitempty"`
	DurationMS  int    `gorm:"column:duration_ms;not null;default:0" json:"duration_ms"`
	RetryCount  int    `gorm:"column:retry_count;not null;default:0" json:"retry_count"`
	CreateTime  int64  `gorm:"column:create_time;not null" json:"create_time"`
}

// TableName specify table name
func (AgentNodeExecution) TableName() string {
	return "agent_node_execution"
}
