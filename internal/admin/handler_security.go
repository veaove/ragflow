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

package admin

import (
	"github.com/gin-gonic/gin"

	"ragflow/internal/common"
	"ragflow/internal/dao"
	"ragflow/internal/service/security"
)

// GetSecuritySettings GET /admin/security
//
// @Summary 读取平台安全策略（登录方式 / 密码策略 / 会话与锁定）
// @Description 未保存过的项返回内置默认值，因此前端不需要处理空配置。
func (h *Handler) GetSecuritySettings(c *gin.Context) {
	if dao.DB == nil {
		common.ErrorWithCode(c, common.CodeServerError, "database is not ready")
		return
	}
	settings, err := security.Load(c.Request.Context(), dao.DB)
	if err != nil {
		common.ErrorWithCode(c, common.CodeServerError, err.Error())
		return
	}
	common.SuccessWithData(c, settings, "Get security settings")
}

// UpdateSecuritySettings PUT /admin/security
//
// @Summary 保存平台安全策略
// @Description 整体替换。保存成功后回读一次并返回完整配置，前端可直接用它覆盖
// 本地表单状态，避免"保存成功但界面和库里不一致"。
func (h *Handler) UpdateSecuritySettings(c *gin.Context) {
	if dao.DB == nil {
		common.ErrorWithCode(c, common.CodeServerError, "database is not ready")
		return
	}
	var req security.Settings
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorWithCode(c, common.CodeBadRequest, err.Error())
		return
	}
	if err := req.Save(c.Request.Context(), dao.DB); err != nil {
		// Validation failures are the caller's fault, not the server's.
		common.ErrorWithCode(c, common.CodeBadRequest, err.Error())
		return
	}
	saved, err := security.Load(c.Request.Context(), dao.DB)
	if err != nil {
		common.ErrorWithCode(c, common.CodeServerError, err.Error())
		return
	}
	// The session TTL lives in a process-wide atomic, so it has to be pushed
	// explicitly. Without this an admin would change the timeout, see "saved",
	// and still get the old behaviour until the next restart.
	common.SetAccessTokenTTL(saved.TimeoutSeconds())
	common.SuccessWithData(c, saved, "Update security settings")
}

// UnlockUserLogin PUT /admin/users/:username/unlock
//
// @Summary 解除某个账号的登录失败锁定
// @Description 锁定策略生效后，用户只能等窗口过去。这里提供人工解锁通道，
// 避免密码策略把用户和客服都堵死。
func (h *Handler) UnlockUserLogin(c *gin.Context) {
	username := c.Param("username")
	if err := h.userService.UnlockLogin(c.Request.Context(), username); err != nil {
		common.ErrorWithCode(c, common.CodeBadRequest, err.Error())
		return
	}
	common.SuccessWithData(c, gin.H{"username": username, "locked": false}, "Login unlocked")
}
