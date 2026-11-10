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

import { useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  dismissAppNotice,
  getAppNotices,
  subscribeAppNotices,
} from '@/utils/app-notice';

/**
 * AppNoticeHost 把排队的红 / 黄提示逐条渲染成统一弹框。
 *
 * 一次只显示一条，点「知道了」才放下一条 —— 弹框是阻塞的，同时叠三个窗口比
 * 角落里的 toast 更难处理。挂在应用根节点上，任何页面（包括请求层）都能弹。
 */
export function AppNoticeHost() {
  const notices = useSyncExternalStore(
    subscribeAppNotices,
    getAppNotices,
    getAppNotices,
  );
  const current = notices[0];

  const close = () => {
    if (current) {
      dismissAppNotice(current.id);
    }
  };

  return (
    <Dialog
      open={!!current}
      onOpenChange={(open) => {
        if (!open) {
          close();
        }
      }}
    >
      <DialogContent
        className="max-w-[440px]"
        data-testid="app-notice-dialog"
        data-level={current?.level}
      >
        <DialogHeader>
          <DialogTitle>{current?.title ?? ''}</DialogTitle>
        </DialogHeader>
        {current?.description && (
          <DialogDescription className="whitespace-pre-line text-sm text-text-secondary">
            {current.description}
          </DialogDescription>
        )}
        <DialogFooter>
          <Button size="sm" onClick={close}>
            知道了
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
