/*
 *  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"ragflow/internal/dao"
	"ragflow/internal/entity"
)

// canvasDatasetKeys 是画布 DSL 里存放知识库绑定的字段名。
//
// 检索类组件把这些 id 存在多处：节点的 form.dataset_ids、组件的
// obj.params.dataset_ids，以及嵌在 tools[].params 里的检索工具（智能体把检索
// 挂成工具时就是这种形状）。老数据用 kb_ids，新数据用 dataset_ids，两种都认。
var canvasDatasetKeys = map[string]struct{}{
	"dataset_ids": {},
	"kb_ids":      {},
}

// canvasDatasetIDs 从一份画布 DSL 中收集全部知识库 id，按出现顺序去重。
//
// DSL 的结构会随画布类型（agent / chatflow / dataflow）和版本漂移，所以这里
// 按"递归找已知字段名"取值，而不是写死某一条路径——写死路径的下一步就是
// 换个画布类型后列表又变回「未关联」。
func canvasDatasetIDs(dsl entity.JSONMap) []string {
	if len(dsl) == 0 {
		return nil
	}

	ids := make([]string, 0, 4)
	seen := make(map[string]struct{}, 4)

	var walk func(node interface{})
	walk = func(node interface{}) {
		switch value := node.(type) {
		case map[string]interface{}:
			for key, child := range value {
				if _, ok := canvasDatasetKeys[key]; ok {
					for _, id := range stringItems(child) {
						if _, duplicated := seen[id]; duplicated {
							continue
						}
						seen[id] = struct{}{}
						ids = append(ids, id)
					}
				}
				walk(child)
			}
		case []interface{}:
			for _, child := range value {
				walk(child)
			}
		case string:
			// 历史 DSL 里 components / params 有时是"JSON 字符串"而不是对象，
			// 不解析就会漏掉这些画布的绑定。
			trimmed := strings.TrimSpace(value)
			if len(trimmed) < 2 || (trimmed[0] != '{' && trimmed[0] != '[') {
				return
			}
			var parsed interface{}
			if json.Unmarshal([]byte(trimmed), &parsed) == nil {
				walk(parsed)
			}
		}
	}
	walk(map[string]interface{}(dsl))

	// DSL 是 map，遍历顺序不固定；按 id 排序让同一份画布每次都得到同样的顺序。
	sort.Strings(ids)

	return ids
}

// stringItems keeps the string members of a JSON array, dropping empties.
func stringItems(value interface{}) []string {
	switch items := value.(type) {
	case []interface{}:
		out := make([]string, 0, len(items))
		for _, item := range items {
			id, ok := item.(string)
			if !ok || id == "" {
				continue
			}
			out = append(out, id)
		}
		return out
	case []string:
		out := make([]string, 0, len(items))
		for _, id := range items {
			if id != "" {
				out = append(out, id)
			}
		}
		return out
	default:
		return nil
	}
}

// attachCanvasDatasets fills DatasetIDs / KBNames on agent list items.
//
// 口径与 /chats、/search 的「知识库」列一致：dataset_ids 与 kb_names 在同一个
// 循环里 append，下标一一对应，前端用 utils/kb-labels.ts 统一格式化。查不到
// 名称的 id（知识库已删除）保留位置并留空名，由前端渲染成 "-"：整列变成
// 「未关联」会让「绑定还在、库没了」这种状态看起来像从没关联过。
func (s *AgentService) attachCanvasDatasets(ctx context.Context, items []*AgentItem) error {
	if len(items) == 0 {
		return nil
	}

	canvasIDs := make([]string, 0, len(items))
	for _, item := range items {
		canvasIDs = append(canvasIDs, item.ID)
	}

	dsls, err := s.canvasDAO.ListDSLByIDs(ctx, dao.DB, canvasIDs)
	if err != nil {
		return fmt.Errorf("load canvas dsl: %w", err)
	}

	bound := make(map[string][]string, len(items))
	allIDs := make([]string, 0, len(items))
	for _, item := range items {
		kbIDs := canvasDatasetIDs(dsls[item.ID])
		if len(kbIDs) == 0 {
			continue
		}
		bound[item.ID] = kbIDs
		allIDs = append(allIDs, kbIDs...)
	}
	if len(allIDs) == 0 {
		return nil
	}

	kbs, err := s.kbDAO.GetByIDs(ctx, dao.DB, allIDs)
	if err != nil {
		return fmt.Errorf("load knowledge base names: %w", err)
	}
	names := make(map[string]string, len(kbs))
	for _, kb := range kbs {
		if kb == nil {
			continue
		}
		names[kb.ID] = kb.Name
	}

	for _, item := range items {
		kbIDs := bound[item.ID]
		if len(kbIDs) == 0 {
			continue
		}

		type binding struct{ id, name string }
		bindings := make([]binding, 0, len(kbIDs))
		for _, id := range kbIDs {
			bindings = append(bindings, binding{id: id, name: names[id]})
		}
		// 列里展示的是名称，按名称排序；名称缺失的（库已删除）保持 id 顺序排在前。
		sort.SliceStable(bindings, func(i, j int) bool {
			return bindings[i].name < bindings[j].name
		})

		item.DatasetIDs = make([]string, 0, len(bindings))
		item.KBNames = make([]string, 0, len(bindings))
		for _, b := range bindings {
			item.DatasetIDs = append(item.DatasetIDs, b.id)
			item.KBNames = append(item.KBNames, b.name)
		}
	}

	return nil
}
