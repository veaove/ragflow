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

package handler

import (
	"ragflow/internal/common"
	"ragflow/internal/dao"
	"ragflow/internal/engine/kvrocks"
	"ragflow/internal/entity"
	permissionresponse "ragflow/internal/permission/response"
	"ragflow/internal/server"

	"github.com/gin-gonic/gin"
)

func permissionErrorResult(err error, hideResource bool) (common.ErrorCode, string) {
	normalize := permissionresponse.Normalize
	if hideResource {
		normalize = permissionresponse.NormalizeHidden
	}
	code, normalizedErr := normalize(err)
	return code, normalizedErr.Error()
}

func respondPermissionError(c *gin.Context, err error, hideResource bool) {
	code, message := permissionErrorResult(err, hideResource)
	common.ResponseWithCodeData(c, code, nil, message)
}

func respondPermissionErrorIf(c *gin.Context, err error, hideResource bool) bool {
	if !permissionresponse.IsPermissionError(err) {
		return false
	}
	respondPermissionError(c, err, hideResource)
	return true
}

func respondPermissionFailure(c *gin.Context, err error, hideResource bool) {
	code, message := permissionErrorResult(err, hideResource)
	common.ErrorWithCode(c, code, message)
}

func respondHTTPPermissionError(c *gin.Context, err error, hideResource bool) {
	code, message := permissionErrorResult(err, hideResource)
	common.ResponseWithHttpCodeData(c, int(code), code, nil, message)
}

// sortTermsFromQuery reads the `sort` parameter, a comma separated list of
// `column:direction` terms such as `name:asc,create_time:desc`. A handler that
// rejects an unrecognised `orderby` or `desc` reads this first and skips that
// check when terms came back, because a request whose `sort` decides the order
// is not held to the spelling of a field it does not use.
func sortTermsFromQuery(c *gin.Context) []dao.OrderTerm {
	return dao.ParseOrderTerms(c.Query("sort"))
}

// orderTerms prefers the parsed `sort` terms and falls back to the older
// `orderby` and `desc` pair, which still works on its own. A term naming a
// column the entity does not order by is dropped rather than rejected, so a
// caller that already sends an unknown name keeps the result it has today.
func orderTerms(sortTerms []dao.OrderTerm, orderby string, desc bool) []dao.OrderTerm {
	if len(sortTerms) > 0 {
		return sortTerms
	}
	return []dao.OrderTerm{{Column: orderby, Desc: desc}}
}

func orderTermsFromQuery(c *gin.Context, orderby string, desc bool) []dao.OrderTerm {
	return orderTerms(sortTermsFromQuery(c), orderby, desc)
}

// CurrentAccessToken 从请求里解出 access_token。
//
// 只有「需要精确到某个会话」的动作才用它（登出要只删自己那条，
// 否则多端在线时会把别的设备一起踢下线）。解析失败返回空串，
// 调用方按「会话未知」降级处理，不要因此拒绝请求。
func CurrentAccessToken(c *gin.Context) string {
	auth := c.GetHeader("Authorization")
	if auth == "" {
		if cookie, err := c.Cookie("Authorization"); err == nil {
			auth = cookie
		}
	}
	if auth == "" {
		return ""
	}
	secretKey, err := server.GetSecretKey(c.Request.Context(), kvrocks.Get())
	if err != nil {
		return ""
	}
	token, err := common.ExtractAccessToken(auth, secretKey)
	if err != nil {
		return ""
	}
	return token
}

func GetUser(c *gin.Context) (*entity.User, common.ErrorCode, string) {
	userAny, exist := c.Get("user")
	if !exist {
		return nil, common.CodeUnauthorized, "User not found"
	}

	user, ok := userAny.(*entity.User)
	if !ok {
		return nil, common.CodeUnauthorized, "User not found"
	}
	return user, common.CodeSuccess, ""
}
