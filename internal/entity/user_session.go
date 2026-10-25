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

// UserSession 记录一次登录产生的会话。
//
// 为什么不复用 user.access_token：那张表是「一用户一列」，每次登录都覆盖，
// 天然只能容纳一个会话 —— 想同时保留多端就必须另存一份多行记录。
//
// 主键直接用 access_token 本身：校验时拿 token 就能一次点查命中，
// 不必再维护一张映射表。
type UserSession struct {
	// ID 就是 access_token 的值（UUID，长度 36，留到 64 兼容后续格式变化）。
	ID string `gorm:"column:id;size:64;primaryKey" json:"id"`
	// UserID 是会话归属用户，按它清理「不允许多端」时的其它会话。
	UserID string `gorm:"column:user_id;size:32;not null;index" json:"user_id"`
	// UserAgent / IP 只用于排查「这是哪台设备」。不参与鉴权判定。
	UserAgent string `gorm:"column:user_agent;size:255" json:"user_agent,omitempty"`
	IP        string `gorm:"column:ip;size:64" json:"ip,omitempty"`
	// CreateTime 是毫秒时间戳，与项目其它表保持一致。
	CreateTime int64 `gorm:"column:create_time;index" json:"create_time"`
}

// TableName specify table name
func (UserSession) TableName() string {
	return "user_session"
}
