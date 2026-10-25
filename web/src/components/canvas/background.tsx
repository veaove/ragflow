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

import { Background } from '@xyflow/react';

/**
 * 画布背景。
 *
 * `tech` 皮肤把底色和星点交给画布容器的 CSS（`canvas-skin.css` 的
 * `[data-canvas-skin='tech']::before/::after`），这里必须什么都不画：
 * Background 会铺一层不透明的 `bgColor`，盖住星海。
 *
 * 类型不直接复用 `pages/agent/canvas/use-canvas-skin`：这个组件属于通用
 * components 层，不该反向依赖某个页面模块，所以只按结构约定取值。
 */
export function AgentBackground({ skin }: { skin?: 'legacy' | 'tech' }) {
  if (skin === 'tech') {
    return null;
  }

  return (
    <Background
      color="var(--text-primary)"
      bgColor="rgb(var(--bg-canvas))"
      className="rounded-lg"
    />
  );
}
