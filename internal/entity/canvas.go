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

import "time"

// Canvas category values — the single source of truth for app form factor
// (D1 in the technical design). The legacy agent form factor is preserved;
// chatflow / workflow are the two new first-class form factors, and
// dataflow_canvas is the ingestion pipeline (out of scope here).
const (
	CanvasCategoryAgent     = "agent_canvas"
	CanvasCategoryChatflow  = "chatflow_canvas"
	CanvasCategoryWorkflow  = "workflow_canvas"
	CanvasCategoryDataflow  = "dataflow_canvas"
)

// DSL schema version for forward/backward migration (FR-06-08 / VER-08).
const (
	DSLSchemaVersionLegacy = 0 // pre-versioning DSLs
	DSLSchemaVersionV1     = 1 // first versioned schema (with End/Answer)
)

// UserCanvas user canvas model
type UserCanvas struct {
	ID             string  `gorm:"column:id;primaryKey;size:32" json:"id"`
	Avatar         *string `gorm:"column:avatar;type:longtext" json:"avatar,omitempty"`
	UserID         string  `gorm:"column:user_id;size:255;not null;index" json:"user_id"`
	Tags           string  `gorm:"column:tags;size:512;not null;default:'';index" json:"tags"`
	Title          *string `gorm:"column:title;size:255" json:"title,omitempty"`
	Permission     string  `gorm:"column:permission;size:16;not null;default:me;index" json:"permission"`
	Release        bool    `gorm:"column:release;not null;default:false;index" json:"release"`
	Description    *string `gorm:"column:description;type:longtext" json:"description,omitempty"`
	CanvasType     *string `gorm:"column:canvas_type;size:32;index" json:"canvas_type,omitempty"`
	CanvasCategory string  `gorm:"column:canvas_category;size:32;not null;default:agent_canvas;index" json:"canvas_category"`
	DSL            JSONMap `gorm:"column:dsl;type:longtext" json:"dsl,omitempty"`
	// ArchivedAt marks a soft-archived app: non-nil means archived, and the
	// derived status is archived (FR-01-05). Release + ArchivedAt together
	// derive draft/published/archived without a redundant status column.
	ArchivedAt *time.Time `gorm:"column:archived_at" json:"archived_at,omitempty"`
	// DSLSchemaVersion records the DSL schema revision so old DSLs can be
	// migrated on load (FR-06-08).
	DSLSchemaVersion int `gorm:"column:dsl_schema_version;not null;default:1" json:"dsl_schema_version"`
	BaseModel
}

// TableName specify table name
func (UserCanvas) TableName() string {
	return "user_canvas"
}

// CanvasTemplate canvas template model
type CanvasTemplate struct {
	ID             string    `gorm:"column:id;primaryKey;size:32" json:"id"`
	Avatar         *string   `gorm:"column:avatar;type:longtext" json:"avatar,omitempty"`
	Title          JSONMap   `gorm:"column:title;type:longtext" json:"title"`
	Description    JSONMap   `gorm:"column:description;type:longtext" json:"description"`
	CanvasType     *string   `gorm:"column:canvas_type;size:32;index" json:"canvas_type,omitempty"`
	CanvasTypes    JSONSlice `gorm:"column:canvas_types;type:longtext" json:"canvas_types,omitempty"`
	CanvasCategory string    `gorm:"column:canvas_category;size:32;not null;default:agent_canvas;index" json:"canvas_category"`
	DSL            JSONMap   `gorm:"column:dsl;type:longtext" json:"dsl,omitempty"`
	BaseModel
}

// TableName specify table name
func (CanvasTemplate) TableName() string {
	return "canvas_template"
}

// UserCanvasVersion user canvas version model
type UserCanvasVersion struct {
	ID           string  `gorm:"column:id;primaryKey;size:32" json:"id"`
	UserCanvasID string  `gorm:"column:user_canvas_id;size:255;not null;index" json:"user_canvas_id"`
	Title        *string `gorm:"column:title;size:255" json:"title,omitempty"`
	Description  *string `gorm:"column:description;type:longtext" json:"description,omitempty"`
	Release      bool    `gorm:"column:release;not null;default:false;index" json:"release"`
	DSL          JSONMap `gorm:"column:dsl;type:longtext" json:"dsl,omitempty"`
	// VersionSeq is the monotonic version number shown as v{seq}. Together with
	// the unique key (user_canvas_id, version_seq) it makes concurrent publish
	// fail loudly instead of silently overwriting (VER-05 / 10.2).
	VersionSeq int `gorm:"column:version_seq;not null;default:0" json:"version_seq"`
	// Remark is an optional human label/note for this version.
	Remark *string `gorm:"column:remark;size:255" json:"remark,omitempty"`
	// BaseVersionID is the publish baseline used for conflict detection.
	BaseVersionID *string `gorm:"column:base_version_id;size:32" json:"base_version_id,omitempty"`
	// EnvSnapshot is the immutable environment-variable snapshot (secret values
	// encrypted) taken at publish time, restored together with the DSL.
	EnvSnapshot JSONMap `gorm:"column:env_snapshot;type:longtext" json:"env_snapshot,omitempty"`
	BaseModel
}

// TableName specify table name
func (UserCanvasVersion) TableName() string {
	return "user_canvas_version"
}
