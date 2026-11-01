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

import type {
  MyPermissions,
  RolePermissionRow,
} from '@/services/console-service';
import { resolvePermissionRedirect } from '../permission-redirect';

const row = (module: string, canView: boolean): RolePermissionRow => ({
  module,
  can_view: canView,
  can_create: false,
  can_edit: false,
  can_delete: false,
  can_manage: false,
});

const buildPerms = (modules: Record<string, boolean>): MyPermissions => ({
  role: 'normal',
  role_id: 'role-technician',
  role_name: '技术员',
  modules: Object.fromEntries(
    Object.entries(modules).map(([module, canView]) => [
      module,
      row(module, canView),
    ]),
  ),
});

const menuItems = [
  { path: '/', name: 'header.home' },
  { path: '/datasets', name: 'header.dataset' },
  { path: '/chats', name: 'header.chat' },
  {
    path: 'console',
    name: 'console.title',
    children: [
      { path: '/console/organization', name: 'console.organization' },
      { path: '/console/members', name: 'console.members' },
    ],
  },
];

const resolve = (
  pathname: string,
  perms: MyPermissions | null,
  isOwner = false,
) => resolvePermissionRedirect({ pathname, perms, isOwner, menuItems });

describe('resolvePermissionRedirect', () => {
  it('技术员有 overview.can_view 时允许进入总览', () => {
    const perms = buildPerms({ overview: true });

    expect(resolve('/', perms)).toBeNull();
    expect(resolve('/overview', perms)).toBeNull();
  });

  it('没有 overview.can_view 时从总览弹到第一个可见页', () => {
    const perms = buildPerms({ dataset: true });

    expect(resolve('/', perms)).toBe('/datasets');
  });

  it('只有总览权限时仍停在总览，不会被弹到无权页', () => {
    const perms = buildPerms({ overview: true });

    expect(resolve('/datasets', perms)).toBe('/');
  });

  it('访问有权限的页面不重定向', () => {
    const perms = buildPerms({ overview: true, dataset: true });

    expect(resolve('/datasets', perms)).toBeNull();
    expect(resolve('/datasets/abc', perms)).toBeNull();
  });

  it('owner 与权限未加载时一律放行', () => {
    expect(resolve('/', null, true)).toBeNull();
    expect(resolve('/datasets', null)).toBeNull();
  });
});
