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
)

// GetOverview 平台运营概览。
//
// 一次请求返回全部 KPI 与两条趋势序列：管理端首屏只需要一次往返，
// 拆成多个接口只会让页面出现分批闪烁。
func (h *Handler) GetOverview(c *gin.Context) {
	overview, err := h.service.GetPlatformOverview(c.Request.Context())
	if err != nil {
		common.ErrorWithCode(c, common.CodeServerError, err.Error())
		return
	}

	common.SuccessWithData(c, overview, "Platform overview")
}
