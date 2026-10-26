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

package router

import (
	"github.com/gin-gonic/gin"

	"ragflow/internal/handler"
)

// registerQcRoutes registers the quality-inspection routes under /api/v1/qc.
// Static routes (/rules/test, /hits/export) are declared before their
// parameterised siblings so they always win.
func (r *Router) registerQcRoutes(v1 *gin.RouterGroup) {
	qc := v1.Group("/qc")
	// 三块内容属于不同的权限模块，各自挂中间件：
	//   质检规则 / 命中记录 / 质检系统配置。
	// 实时质检走 WebSocket，在 router.go 的 noAuth 组注册，这里不涉及。
	rules := qc.Group("/rules", handler.ModulePermission("qc_rule"))
	hits := qc.Group("/hits", handler.ModulePermission("qc_hit"))
	qcConfig := qc.Group("/config", handler.ModulePermission("qc_config"))
	{
		rules.GET("", r.getQcHandler().ListRules)
		rules.POST("", r.getQcHandler().CreateRule)
		rules.POST("/test", r.getQcHandler().TestRule)
		// App-level rule selection (the 「选用规则」 block in app settings).
		// Must precede /rules/:id so "selection" is never read as an id.
		rules.GET("/selection", r.getQcHandler().GetRuleSelection)
		rules.PUT("/selection", r.getQcHandler().UpdateRuleSelection)
		// 引用关系：必须在 /rules/:id 之前注册，避免 "references" 被当成 id。
		rules.GET("/:id/references", r.getQcHandler().GetRuleReferences)
		rules.GET("/:id", r.getQcHandler().GetRule)
		rules.PUT("/:id", r.getQcHandler().UpdateRule)
		rules.DELETE("/:id", r.getQcHandler().DeleteRule)
		rules.POST("/:id/toggle", r.getQcHandler().ToggleRule)

		hits.GET("", r.getQcHandler().ListHits)
		hits.GET("/export", r.getQcHandler().ExportHits)
		hits.GET("/:id", r.getQcHandler().GetHit)

		// The realtime WebSocket is registered outside the auth group (see
		// router.go), because a browser WS handshake cannot carry the
		// Authorization header.
		qcConfig.GET("", r.getQcHandler().GetConfig)
		qcConfig.PUT("", r.getQcHandler().UpdateConfig)
	}
}
