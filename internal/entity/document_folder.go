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

// DocumentFolder is one directory node inside a knowledge base.
//
// 文件夹是真目录：一个文档只属于一个文件夹（document.folder_id），
// 因此嵌套、按整个子树批量解析、移动防环这些能力才成立。
//
// ParentID 用空串而不是 NULL 表示根目录：MySQL 的唯一索引把多个 NULL
// 视为互不相同，根目录下的同名文件夹就拦不住，只能靠应用层查重补；
// 空串让唯一索引在同一层目录上真正生效。
type DocumentFolder struct {
	ID        string `gorm:"column:id;primaryKey;size:32" json:"id"`
	DatasetID string `gorm:"column:dataset_id;size:256;not null;uniqueIndex:uni_document_folder_sibling,priority:1" json:"dataset_id"`
	ParentID  string `gorm:"column:parent_id;size:32;not null;default:'';uniqueIndex:uni_document_folder_sibling,priority:2" json:"parent_id"`
	Name      string `gorm:"column:name;size:255;not null;uniqueIndex:uni_document_folder_sibling,priority:3" json:"name"`
	CreatedBy string `gorm:"column:created_by;size:32;not null;index" json:"created_by"`
	BaseModel
}

// TableName specifies the table name.
func (DocumentFolder) TableName() string {
	return "document_folder"
}
