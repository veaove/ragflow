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

import { PermissionDeniedDialog } from '@/components/permission-denied-dialog';

import type { ChangeSetEditAction } from './edit-permission';

const COPY: Record<ChangeSetEditAction, { title: string; description: string }> =
  {
    publish: {
      title: '无法发布变更',
      description:
        '你对这个知识库只有「可查看」权限，发布变更需要「可编辑」授权。请联系知识库所有者或本租户管理员调整授权后再试。',
    },
    discard: {
      title: '无法放弃变更',
      description:
        '你对这个知识库只有「可查看」权限，放弃变更需要「可编辑」授权。请联系知识库所有者或本租户管理员调整授权后再试。',
    },
  };

/**
 * EditPermissionDialog 是只读成员点「发布 / 放弃」时的唯一提示。
 *
 * 变更中心对只读成员可见可用（列表、diff、测试对比都是只读的），只有发布与
 * 放弃会改到库内容。这两步被拒时不能把后端的错误码/英文 message 甩给用户，
 * 也不该只留一句「操作失败」——要说清楚缺的是哪一条授权、找谁要。
 */
export function EditPermissionDialog({
  action,
  onClose,
}: {
  action: ChangeSetEditAction | null;
  onClose: () => void;
}) {
  const copy = action ? COPY[action] : null;

  return (
    <PermissionDeniedDialog
      open={!!action}
      title={copy?.title ?? ''}
      description={copy?.description ?? ''}
      testId="change-set-edit-denied"
      onClose={onClose}
    />
  );
}
