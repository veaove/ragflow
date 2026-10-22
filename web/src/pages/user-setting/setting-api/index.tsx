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

import ApiContent from '@/components/api-service/chat-overview-modal/api-content';

/**
 * API 文档页。
 *
 * `ApiContent` 是为弹窗写的：内部滚动区靠 `flex-1 min-h-0` 吃父级高度。
 * 这里作为整页渲染时，父级高度由容器 flex 拉伸给出，但内容高度是 auto，
 * 于是那段 `overflow-auto` 永远不触发、文档底部（错误码表、Langfuse 卡片）
 * 被外层 overflow-hidden 裁掉。所以整页再包一层滚动容器，由它负责滚动。
 */
const ApiPage = () => {
  return (
    <div className="size-full min-h-0 overflow-y-auto scrollbar-auto">
      <ApiContent idKey="dialogId"></ApiContent>
    </div>
  );
};

export default ApiPage;
