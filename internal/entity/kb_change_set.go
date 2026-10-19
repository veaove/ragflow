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

// KbChangeSet lifecycle status.
const (
	ChangeSetStatusOpen      = "open"
	ChangeSetStatusTested    = "tested"
	ChangeSetStatusPublished = "published"
	ChangeSetStatusDiscarded = "discarded"
)

// KbChangeSet is one edit session on a knowledge base: a batch of pending
// vocabulary / similar-question changes staged together, tested as a unit and
// published atomically. Every pending synonym group, synonym word and chunk
// question links back to the change set that staged it via change_set_id.
type KbChangeSet struct {
	ID        string `gorm:"column:id;primaryKey;size:32" json:"id"`
	KbID      string `gorm:"column:kb_id;size:32;not null;index" json:"kb_id"`
	TenantID  string `gorm:"column:tenant_id;size:32;not null;index" json:"tenant_id"`
	CreatedBy string `gorm:"column:created_by;size:32;not null;index" json:"created_by"`
	Status    string `gorm:"column:status;size:16;not null;default:open;index" json:"status"`
	BaseModel `json:"-"`
}

// TableName specify table name
func (KbChangeSet) TableName() string {
	return "kb_change_set"
}

// KbTestRecord stores one test-comparison run against a change set: the queries,
// retrieval parameters, and the two result sets (live vs pending) plus the
// derived diff summary. It backs the "已测试" marker in the change center.
type KbTestRecord struct {
	ID          string  `gorm:"column:id;primaryKey;size:32" json:"id"`
	ChangeSetID string  `gorm:"column:change_set_id;size:32;not null;index" json:"change_set_id"`
	KbID        string  `gorm:"column:kb_id;size:32;not null;index" json:"kb_id"`
	Queries     JSONMap `gorm:"column:queries;type:longtext" json:"queries"`
	Params      JSONMap `gorm:"column:params;type:longtext" json:"params"`
	Result      JSONMap `gorm:"column:result;type:longtext" json:"result"`
	CreatedBy   string  `gorm:"column:created_by;size:32;not null;index" json:"created_by"`
	BaseModel   `json:"-"`
}

// TableName specify table name
func (KbTestRecord) TableName() string {
	return "kb_test_record"
}
