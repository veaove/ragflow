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
	// WordCount is a read-only projection joined from synonym_word; it is not a
	// stored column.
	WordCount int            `gorm:"-" json:"word_count"`
	Words     []SynonymWord  `gorm:"-" json:"words,omitempty"`
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
	BaseModel `json:"-"`
}

// TableName specify table name
func (SynonymWord) TableName() string {
	return "synonym_word"
}