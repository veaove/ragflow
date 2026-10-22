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

package dao

import (
	"context"
	"ragflow/internal/entity"
	"strings"

	"gorm.io/gorm"
)

// CanvasTemplateDAO data-access object for the canvas_template table.
type CanvasTemplateDAO struct{}

// NewCanvasTemplateDAO creates a CanvasTemplate DAO.
func NewCanvasTemplateDAO() *CanvasTemplateDAO {
	return &CanvasTemplateDAO{}
}

// GetAll returns every row in canvas_template ordered by create_time desc, so
// templates appear newest first in the UI. Mirrors the Python
// CanvasTemplateService.get_all() behaviour.
func (dao *CanvasTemplateDAO) GetAll(ctx context.Context, db *gorm.DB, lang string) ([]*entity.CanvasTemplate, error) {
	var templates []*entity.CanvasTemplate
	if err := db.WithContext(ctx).Order("create_time desc").Find(&templates).Error; err != nil {
		return nil, err
	}

	lang = strings.ToLower(strings.TrimSpace(lang))
	if lang == "" {
		lang = "en"
	}

	// English callers only ever get originals: a translated row is the same
	// template, not an extra one, so showing both would duplicate the list.
	if lang == "en" {
		out := make([]*entity.CanvasTemplate, 0, len(templates))
		for _, t := range templates {
			if t.Lang == "" || t.Lang == "en" {
				out = append(out, t)
			}
		}
		return out, nil
	}

	// Group by base_id and pick one row per template: the requested language
	// if it exists, otherwise English. This is what lets translations ship
	// incrementally — untranslated templates still appear in their English
	// form instead of vanishing from the list.
	picked := make(map[string]*entity.CanvasTemplate, len(templates))
	order := make([]string, 0, len(templates))
	for _, t := range templates {
		base := t.BaseID
		if base == "" {
			base = t.ID
		}
		cur, seen := picked[base]
		if !seen {
			order = append(order, base)
			picked[base] = t
			continue
		}
		curLang := cur.Lang
		if curLang == "" {
			curLang = "en"
		}
		switch {
		case curLang == lang:
			// Already the best match; keep it.
		case t.Lang == lang:
			picked[base] = t
		case curLang != "en" && t.Lang == "en":
			picked[base] = t
		}
	}

	out := make([]*entity.CanvasTemplate, 0, len(order))
	for _, base := range order {
		if picked[base] != nil {
			out = append(out, picked[base])
		}
	}
	return out, nil
}
