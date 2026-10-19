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

// SynonymDomainFund marks a synonym group as shared fund-domain vocabulary.
const SynonymDomainFund = "fund"

// SynonymDomainHx marks a synonym group as tenant-specific vocabulary, such as
// a fund house's own product names, abbreviations and aliases.
const SynonymDomainHx = "hx"

// Synonym scope values. A group is either scoped to a single knowledge base or
// shared tenant-wide; a knowledge-base-level group takes precedence over a
// tenant-wide one when both define the same word.
const (
	SynonymScopeKB     = "kb"
	SynonymScopeTenant = "tenant"
)

// Synonym group types distinguish semantic expansion (synonym) from entity
// normalization (proper-noun alias).
const (
	SynonymGroupTypeSynonym = "synonym"
	SynonymGroupTypeProper  = "proper"
)

// Synonym lifecycle status. live = in effect; pending = staged, not yet live;
// disabled = soft-deleted / inactive.
const (
	SynonymStatusLive     = "live"
	SynonymStatusPending  = "pending"
	SynonymStatusDisabled = "disabled"
)

// SynonymGroup is one vocabulary alias set, scoped to a tenant and a knowledge
// base. Every word in the group expands to every other word in that group, so a
// group models one concept ("华夏上证50ETF" == "50ETF" == "上证50").
type SynonymGroup struct {
	ID       string `gorm:"column:id;primaryKey;size:32" json:"id"`
	TenantID string `gorm:"column:tenant_id;size:32;not null;index" json:"tenant_id"`
	// DatasetID binds the group to one knowledge base so a tenant can keep
	// per-product vocabularies apart.
	DatasetID string `gorm:"column:dataset_id;size:32;not null;index" json:"dataset_id"`
	Name      string `gorm:"column:name;size:128;not null" json:"name"`
	Domain    string `gorm:"column:domain;size:32;not null;index" json:"domain"`
	Remark    string `gorm:"column:remark;size:512" json:"remark"`
	// Scope is the effect range: kb or tenant. Defaults to kb for legacy rows.
	Scope string `gorm:"column:scope;size:16;not null;default:kb;index" json:"scope"`
	// GroupType is synonym (semantic expansion) or proper (entity alias).
	GroupType string `gorm:"column:group_type;size:16;not null;default:synonym;index" json:"group_type"`
	// Status is the lifecycle state: live / pending / disabled. Defaults to live
	// for legacy rows that are already in effect.
	Status string `gorm:"column:status;size:16;not null;default:live;index" json:"status"`
	// ChangeSetID links a pending group to the change set that staged it.
	ChangeSetID string `gorm:"column:change_set_id;size:64;index" json:"change_set_id,omitempty"`
	// WordCount is a read-only projection joined from synonym_word; it is not a
	// stored column.
	WordCount int `gorm:"-" json:"word_count"`
	// Words holds the group's entries as pointers so that both DAO reads and
	// buildSynonymWordEntities can assign directly without a per-element
	// dereference loop. JSON output is identical to a value slice.
	Words     []*SynonymWord `gorm:"-" json:"words,omitempty"`
	BaseModel `json:"-"`
}

// TableName specify table name
func (SynonymGroup) TableName() string {
	return "synonym_group"
}

// SynonymWord is one entry inside a synonym group. IsPrimary marks the
// canonical surface form of the concept; the remaining words are its aliases.
type SynonymWord struct {
	ID        string `gorm:"column:id;primaryKey;size:32" json:"id"`
	GroupID   string `gorm:"column:group_id;size:32;not null;index" json:"group_id"`
	Word      string `gorm:"column:word;size:128;not null" json:"word"`
	IsPrimary bool   `gorm:"column:is_primary;default:0" json:"is_primary"`
	// Status mirrors the group lifecycle at the word level: live / pending /
	// disabled. Defaults to live for legacy rows.
	Status string `gorm:"column:status;size:16;not null;default:live;index" json:"status"`
	// Weight is reserved for future per-word ranking; this phase treats all
	// words in a group equally (1.0).
	Weight    float64 `gorm:"column:weight;type:decimal(4,2);not null;default:1.00" json:"weight"`
	BaseModel `json:"-"`
}

// TableName specify table name
func (SynonymWord) TableName() string {
	return "synonym_word"
}
