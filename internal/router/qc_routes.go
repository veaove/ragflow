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
)

// registerQcRoutes registers the quality-inspection routes under /api/v1/qc.
// Static routes (/rules/test, /hits/export) are declared before their
// parameterised siblings so they always win.
func (r *Router) registerQcRoutes(v1 *gin.RouterGroup) {
	qc := v1.Group("/qc")
	{
		qc.GET("/rules", r.getQcHandler().ListRules)
		qc.POST("/rules", r.getQcHandler().CreateRule)
		qc.POST("/rules/test", r.getQcHandler().TestRule)
		qc.GET("/rules/:id", r.getQcHandler().GetRule)
		qc.PUT("/rules/:id", r.getQcHandler().UpdateRule)
		qc.DELETE("/rules/:id", r.getQcHandler().DeleteRule)
		qc.POST("/rules/:id/toggle", r.getQcHandler().ToggleRule)

		qc.GET("/hits", r.getQcHandler().ListHits)
		qc.GET("/hits/export", r.getQcHandler().ExportHits)
		qc.GET("/hits/:id", r.getQcHandler().GetHit)

		// The realtime WebSocket is registered outside the auth group (see
		// router.go), because a browser WS handshake cannot carry the
		// Authorization header.
		qc.GET("/config", r.getQcHandler().GetConfig)
		qc.PUT("/config", r.getQcHandler().UpdateConfig)
	}
}
