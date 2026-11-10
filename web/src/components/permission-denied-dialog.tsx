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

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * PermissionDeniedDialog 是「操作被权限挡住」的统一提示。
 *
 * 被资源层拒绝时不能把错误码或英文 message 丢给用户（那正是 "错误: 404
 * Resource not found" 这类提示的来源），也不要只留一句「操作失败」：要说清楚
 * 缺的是哪条权限、改动还生效到哪一步、以及找谁要授权。
 */
export function PermissionDeniedDialog({
  open,
  title,
  description,
  testId,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  testId?: string;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className="max-w-[440px]"
        data-testid={testId ?? 'permission-denied-dialog'}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogDescription className="text-sm text-text-secondary">
          {description}
        </DialogDescription>
        <DialogFooter>
          <Button size="sm" onClick={onClose}>
            知道了
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
