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

// `sidebar-nav` → `@/routes` 会在模块顶层调用 createBrowserRouter，而 node 环境
// 没有 Request，直接 import 会把整个测试拖崩。这里用最小替身顶掉 router 运行时，
// 路由表本身不参与本测试。
jest.mock('react-router', () => ({
  Link: () => null,
  Navigate: () => null,
  useLocation: () => ({ pathname: '/' }),
  createBrowserRouter: () => ({}),
  redirect: () => undefined,
}));

import { moduleListFor } from '@/hooks/use-console-permissions';
import { sidebarMenuItems } from '../components/sidebar-nav';
import { modulesForPath } from '../permission-redirect';

/** 只取判定用到的字段，避免把 sidebar-nav 的组件类型拖进测试。 */
interface MenuNode {
  path: string;
  name: string;
  children?: MenuNode[];
}

function leaves(items: MenuNode[]): MenuNode[] {
  return items.flatMap((item) =>
    item.children?.length ? leaves(item.children) : [item],
  );
}

const menuLeaves = leaves(sidebarMenuItems);

describe('菜单项与权限模块的一致性', () => {
  it('每个菜单项都有对应的权限模块', () => {
    // 漏配的后果是「后端授了权、菜单永远不出现」，比错配更难排查。
    const missing = menuLeaves
      .filter((item) => moduleListFor(item.name).length === 0)
      .map((item) => item.name);

    expect(missing).toEqual([]);
  });

  it('按路径反查的模块与菜单声明的模块完全一致', () => {
    const byPath = menuLeaves.map((item) => ({
      path: item.path,
      modules: modulesForPath(item.path, sidebarMenuItems),
    }));
    const declared = menuLeaves.map((item) => ({
      path: item.path,
      modules: moduleListFor(item.name),
    }));

    expect(byPath).toEqual(declared);
  });

  it('租户中心四个页面各自对应自己的模块', () => {
    // 这两条曾写错：组织架构按 member 判定、资源授权按 role 判定，
    // 结果是「菜单能进、页面说没权限」。
    expect(modulesForPath('/console/organization', sidebarMenuItems)).toEqual([
      'organization',
    ]);
    expect(modulesForPath('/console/members', sidebarMenuItems)).toEqual([
      'member',
    ]);
    expect(modulesForPath('/console/roles', sidebarMenuItems)).toEqual([
      'role',
    ]);
    expect(modulesForPath('/console/grants', sidebarMenuItems)).toEqual([
      'grant',
    ]);
  });

  it('会话质检是聚合页，任一质检模块有权限都能进', () => {
    expect(modulesForPath('/qc', sidebarMenuItems)).toEqual([
      'qc_rule',
      'qc_realtime',
      'qc_hit',
      'qc_config',
    ]);
  });

  it('总览、子路径与配置中心子页都能反查到模块', () => {
    expect(modulesForPath('/', sidebarMenuItems)).toEqual(['overview']);
    expect(modulesForPath('/datasets/ds-1', sidebarMenuItems)).toEqual([
      'dataset',
    ]);
    expect(modulesForPath('/user-setting/model', sidebarMenuItems)).toEqual([
      'model',
    ]);
    expect(modulesForPath('/not-a-menu-page', sidebarMenuItems)).toEqual([]);
  });
});
