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

import { canAction } from '../use-console-permissions';

type Perms = Parameters<typeof canAction>[0];

const row = (overrides: Record<string, boolean> = {}) => ({
  module: 'dataset',
  can_view: false,
  can_create: false,
  can_edit: false,
  can_delete: false,
  can_manage: false,
  ...overrides,
});

const buildPerms = (
  modules: Record<string, ReturnType<typeof row>>,
): Perms =>
  ({
    role: 'normal',
    role_id: 'role-technician',
    role_name: '技术员',
    modules,
  }) as Perms;

describe('canAction', () => {
  it('只放行矩阵里为 true 的动作', () => {
    const perms = buildPerms({
      dataset: row({ can_view: true, can_edit: true }),
    });

    expect(canAction(perms, 'dataset', 'edit')).toBe(true);
    expect(canAction(perms, 'dataset', 'create')).toBe(false);
    expect(canAction(perms, 'dataset', 'delete')).toBe(false);
    expect(canAction(perms, 'dataset', 'manage')).toBe(false);
  });

  it('矩阵里没有该模块的行时按无权限处理', () => {
    const perms = buildPerms({ dataset: row({ can_view: true }) });

    expect(canAction(perms, 'chat', 'create')).toBe(false);
  });

  it('权限未加载时一律无权限', () => {
    expect(canAction(null, 'dataset', 'edit')).toBe(false);
  });
});
