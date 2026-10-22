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

import { Outlet } from 'react-router';

/**
 * 配置中心与个人中心的容器。
 *
 * 原来这里左侧有一列二级导航（模型 / 数据源 / 聊天渠道 / MCP / 团队 / 概要 /
 * API）。这 7 项现已全部迁出：前 6 项进「配置中心」主菜单分组，概要改成头像
 * 下拉里的「个人中心」。主菜单已经是唯一定位入口，页内再放一列导航会和它打架，
 * 所以这里只保留容器布局。
 *
 * 高度必须是「确定高度」：外层的 main 是 overflow-hidden，这里的每一级若只是
 * `flex-1` 而不吃父级高度，子页面里的 `h-full` / `overflow-y-auto` 全部退化成
 * auto——表现就是「内容被裁掉、滚不动」（模型配置的可选模型、数据源列表、API
 * 文档都踩过）。所以这里固定用 flex-col + `min-h-0`，把确定高度一路传下去，
 * 由各页面自己决定滚动区域。
 */
function UserSetting() {
  return (
    <section className="flex size-full min-w-0 flex-col overflow-hidden pt-8">
      <div className="flex min-h-0 min-w-0 flex-1 pb-6 pr-2 md:pr-6">
        <Outlet />
      </div>
    </section>
  );
}

export default UserSetting;
