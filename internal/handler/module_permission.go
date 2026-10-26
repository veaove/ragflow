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

package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"ragflow/internal/common"
)

// ModulePermission 按路由组接入角色权限矩阵。
//
// 用法：把整组路由挂上即可，不用逐个 handler 改：
//
//	chatChannel := v1.Group("/chat-channels", ModulePermission("channel"))
//
// 动作由 HTTP method 推断（GET→view / POST→create / PUT|PATCH→edit /
// DELETE→delete），与 console 那边 inferModuleAction 的口径一致。
//
// 之所以做成中间件而不是在 handler 里逐行调用：配置中心、质检这些模块
// 一个组里七八个接口，逐行加容易漏，而且新增接口时还得记得补。
//
// 语义沿用 checkModuleAction 的「默认放行」：矩阵里没有该模块的行就放过，
// 只有显式 false 才拒绝 —— 避免历史数据/未初始化租户被整体锁死。
func ModulePermission(module string) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, code, msg := GetUser(c)
		if code != common.CodeSuccess {
			common.ErrorWithCode(c, code, msg)
			c.Abort()
			return
		}

		action := actionFromMethod(c.Request.Method)
		if action == "" {
			// OPTIONS / HEAD 之类不参与授权
			c.Next()
			return
		}

		tenantID := CurrentTenantID(c)
		if tenantID == "" {
			common.ResponseWithHttpCodeData(c, http.StatusForbidden, common.CodeForbidden, nil, "无法确定当前租户")
			c.Abort()
			return
		}

		if err := checkModuleAction(c, user.ID, tenantID, module, action); err != nil {
			common.ResponseWithHttpCodeData(c, http.StatusForbidden, common.CodeForbidden, nil, err.Error())
			c.Abort()
			return
		}
		c.Next()
	}
}

// actionFromMethod 把 HTTP 方法映射到矩阵动作，语义与 console 侧保持一致。
func actionFromMethod(method string) string {
	switch method {
	case http.MethodGet, http.MethodHead:
		return actionView
	case http.MethodPost:
		return actionCreate
	case http.MethodPut, http.MethodPatch:
		return actionEdit
	case http.MethodDelete:
		return actionDelete
	}
	return ""
}

// moduleLabelOr 返回模块中文名，用于错误提示。
func moduleLabelOr(module string) string {
	if label, ok := moduleLabels[module]; ok && label != "" {
		return label
	}
	return module
}
