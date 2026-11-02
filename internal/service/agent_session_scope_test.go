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

package service

import (
	"testing"

	"ragflow/internal/common"
	"ragflow/internal/dao"
	"ragflow/internal/entity"
	"ragflow/internal/permission"
)

// 会话（api_4_conversation）存的是两个人的私聊记录，不是画布内容。
// 「能打开这个智能体」不等于「能看别人跟它的对话」，所以 /agents/:id/sessions
// 与 /agents/:id/sessions/:session_id 必须以会话归属为边界。
//
// 这组测试锁住三条规则：
//   - 普通成员只读得到自己的会话，即使不传任何过滤条件、或者伪造别人的 id；
//   - 画布所有者（以及走同一条 AccessSourceOwner 的租户管理员）仍能看全部；
//   - 别人的会话对普通成员表现为「不存在」，读与删都一样。

// createTeamVisibleCanvas creates a canvas shared with the whole tenant, which
// is the only shape where a non-owner can reach the sessions endpoint at all.
func createTeamVisibleCanvas(t *testing.T, id, ownerUserID, tenantID string) {
	t.Helper()
	if err := dao.DB.Create(&entity.UserCanvas{
		ID:             id,
		UserID:         ownerUserID,
		TenantID:       tenantID,
		Title:          sptr("Team Agent"),
		CanvasCategory: "agent_canvas",
		Permission:     string(entity.TenantPermissionTeam),
	}).Error; err != nil {
		t.Fatalf("failed to create canvas %s: %v", id, err)
	}
}

func addSessionTestTenantMember(t *testing.T, tenantID, userID, role string) {
	t.Helper()
	status := string(entity.StatusValid)
	if err := dao.DB.Create(&entity.UserTenant{
		ID:        "ut-" + userID,
		UserID:    userID,
		TenantID:  tenantID,
		Role:      role,
		InvitedBy: userID,
		Status:    &status,
	}).Error; err != nil {
		t.Fatalf("failed to create membership for %s: %v", userID, err)
	}
}

// setupSharedCanvasFixture builds a team-visible canvas with one session owned
// by the canvas owner and one owned by a plain member.
func setupSharedCanvasFixture(t *testing.T) {
	t.Helper()
	setupAgentSessionServiceTest(t)

	createTeamVisibleCanvas(t, "canvas-team", "owner-1", "tenant-1")
	addSessionTestTenantMember(t, "tenant-1", "owner-1", string(permission.RoleOwner))
	addSessionTestTenantMember(t, "tenant-1", "member-1", string(permission.RoleNormal))

	createAgentSessionTestConversation(t, "session-owner", "canvas-team", "owner-1", 1000)
	createAgentSessionTestConversation(t, "session-member", "canvas-team", "member-1", 2000)
}

func TestListAgentSessionsScopesMemberToOwnSessions(t *testing.T) {
	setupSharedCanvasFixture(t)

	resp, code, err := NewAgentService().ListAgentSessions(t.Context(), "member-1", "member-1", "canvas-team", ListAgentSessionsRequest{
		Page:     1,
		PageSize: 10,
	})
	if err != nil {
		t.Fatalf("ListAgentSessions failed: %v", err)
	}
	if code != common.CodeSuccess {
		t.Fatalf("expected code %d, got %d", common.CodeSuccess, code)
	}
	// 关键断言：不传 user_id / exp_user_id 时，原实现会把 owner 的会话一起返回。
	if resp.Total != 1 {
		t.Fatalf("expected only the caller's session, got total %d", resp.Total)
	}
	if len(resp.Data) != 1 || resp.Data[0]["id"] != "session-member" {
		t.Fatalf("expected session-member, got %v", resp.Data)
	}
}

func TestListAgentSessionsOwnerStillSeesEverySession(t *testing.T) {
	setupSharedCanvasFixture(t)

	resp, code, err := NewAgentService().ListAgentSessions(t.Context(), "owner-1", "owner-1", "canvas-team", ListAgentSessionsRequest{
		Page:     1,
		PageSize: 10,
	})
	if err != nil {
		t.Fatalf("ListAgentSessions failed: %v", err)
	}
	if code != common.CodeSuccess {
		t.Fatalf("expected code %d, got %d", common.CodeSuccess, code)
	}
	if resp.Total != 2 {
		t.Fatalf("expected the owner to see both sessions, got total %d", resp.Total)
	}
}

func TestListAgentSessionsIgnoresForeignUserFilter(t *testing.T) {
	setupSharedCanvasFixture(t)

	svc := NewAgentService()
	// 客户端直接把别人的 id 塞进 user_id，必须在归属边界上被 AND 掉。
	resp, code, err := svc.ListAgentSessions(t.Context(), "member-1", "member-1", "canvas-team", ListAgentSessionsRequest{
		Page:     1,
		PageSize: 10,
		UserID:   "owner-1",
	})
	if err != nil {
		t.Fatalf("ListAgentSessions failed: %v", err)
	}
	if code != common.CodeSuccess {
		t.Fatalf("expected code %d, got %d", common.CodeSuccess, code)
	}
	if resp.Total != 0 {
		t.Fatalf("expected no rows for a foreign user_id filter, got total %d", resp.Total)
	}

	// 下拉框走的是 exp_user_id 分支，同样不能越权。
	names, code, err := svc.ListAgentSessions(t.Context(), "member-1", "member-1", "canvas-team", ListAgentSessionsRequest{
		ExpUserID: "owner-1",
	})
	if err != nil {
		t.Fatalf("ListAgentSessions(names) failed: %v", err)
	}
	if code != common.CodeSuccess {
		t.Fatalf("expected code %d, got %d", common.CodeSuccess, code)
	}
	if names.Total != 0 {
		t.Fatalf("expected no names for a foreign exp_user_id filter, got total %d", names.Total)
	}
}

func TestGetAgentSessionHidesForeignSession(t *testing.T) {
	setupSharedCanvasFixture(t)

	session, code, err := NewAgentService().GetAgentSession(t.Context(), "member-1", "canvas-team", "session-owner")
	if err == nil {
		t.Fatalf("expected foreign session to be hidden, got %+v", session)
	}
	// 统一回「不存在」，不暴露「这个 id 存在但不是你的」。
	if code != common.CodeNotFound {
		t.Fatalf("expected code %d, got %d", common.CodeNotFound, code)
	}
}

func TestDeleteAgentSessionItemRefusesForeignSession(t *testing.T) {
	setupSharedCanvasFixture(t)

	deleted, code, err := NewAgentService().DeleteAgentSessionItem(t.Context(), "member-1", "canvas-team", "session-owner")
	if err != nil {
		t.Fatalf("DeleteAgentSessionItem failed: %v", err)
	}
	if code != common.CodeSuccess {
		t.Fatalf("expected code %d, got %d", common.CodeSuccess, code)
	}
	if deleted {
		t.Fatal("expected foreign session not to be deleted")
	}

	still, gerr := dao.NewAPI4ConversationDAO().GetBySessionID(t.Context(), dao.DB, "session-owner", "canvas-team")
	if gerr != nil {
		t.Fatalf("reload session failed: %v", gerr)
	}
	if still == nil {
		t.Fatal("foreign session was deleted")
	}
}

func TestDeleteAgentSessionsRefusesDeleteAllForMember(t *testing.T) {
	setupSharedCanvasFixture(t)

	_, code, err := NewAgentService().DeleteAgentSessions(t.Context(), "member-1", "canvas-team", nil, true)
	if err == nil {
		t.Fatal("expected permission error for delete_all")
	}
	if code != common.CodeDataError {
		t.Fatalf("expected code %d, got %d", common.CodeDataError, code)
	}

	listed, lerr := dao.NewAPI4ConversationDAO().ListIDsByAgentID(t.Context(), dao.DB, "canvas-team")
	if lerr != nil {
		t.Fatalf("list session ids failed: %v", lerr)
	}
	if len(listed) != 2 {
		t.Fatalf("expected both sessions to survive, got %d", len(listed))
	}
}
