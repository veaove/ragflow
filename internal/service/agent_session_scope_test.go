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
//   - 别人的会话对普通成员表现为「不存在」。
//
// 删除不在范围内：共享画布的成员可以删该画布下任何会话是既有契约，见
// agent_test.go 的 TestDeleteAgentSessionItem_SharedCanvasGrantsDeleteAccess。

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
	// team 档只覆盖租户管理层，普通成员要看别人的画布得有一条显式授权。
	grantTestResource(t, "tenant-1", permission.ResourceKindCanvas, "canvas-team", "member-1")

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

func TestGetAgentSessionOwnerReadsAnySession(t *testing.T) {
	setupSharedCanvasFixture(t)

	session, code, err := NewAgentService().GetAgentSession(t.Context(), "owner-1", "canvas-team", "session-member")
	if err != nil {
		t.Fatalf("GetAgentSession failed: %v", err)
	}
	if code != common.CodeSuccess {
		t.Fatalf("expected code %d, got %d", common.CodeSuccess, code)
	}
	if session == nil || session.ID != "session-member" {
		t.Fatalf("expected session-member, got %+v", session)
	}
}

// 删除侧保持既有契约：共享画布的成员可以删该画布下的任何会话
// （见 agent_test.go 的 TestDeleteAgentSessionItem_SharedCanvasGrantsDeleteAccess）。
// 这里只锁定「读收紧了、删没动」，防止以后误以为两处一起改了。
func TestDeleteAgentSessionItemStillFollowsCanvasAccess(t *testing.T) {
	setupSharedCanvasFixture(t)

	deleted, code, err := NewAgentService().DeleteAgentSessionItem(t.Context(), "member-1", "canvas-team", "session-owner")
	if err != nil {
		t.Fatalf("DeleteAgentSessionItem failed: %v", err)
	}
	if code != common.CodeSuccess || !deleted {
		t.Fatalf("expected delete to follow canvas access, code=%v deleted=%v", code, deleted)
	}
}
