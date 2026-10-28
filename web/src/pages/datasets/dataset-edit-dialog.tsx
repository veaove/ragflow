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

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { IModalProps } from '@/interfaces/common';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ButtonLoading } from '@/components/ui/button';

export interface DatasetEditValues {
  name: string;
  description: string;
  category: string;
}

/**
 * 编辑知识库：名称 / 描述 / 分类。
 *
 * 不复用通用的 RenameDialog：它只有单个名称输入，而这里要一次改三个字段、
 * 且三个字段一起提交（后端的更新接口本身支持部分更新，但弹窗只有一次「保存」）。
 */
export function DatasetEditDialog({
  hideModal,
  initialName,
  initialDescription,
  initialCategory,
  onOk,
  loading,
}: IModalProps<any> & {
  initialName?: string;
  initialDescription?: string;
  initialCategory?: string;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName ?? '');
  const [description, setDescription] = useState(initialDescription ?? '');
  const [category, setCategory] = useState(initialCategory ?? '');
  const [error, setError] = useState('');

  // 弹窗是条件渲染的（visible 才挂载），但仍用 effect 同步一次：
  // 同一个实例被不同行复用时，props 变了要跟着变。
  useEffect(() => {
    setName(initialName ?? '');
    setDescription(initialDescription ?? '');
    setCategory(initialCategory ?? '');
    setError('');
  }, [initialName, initialDescription, initialCategory]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('common.namePlaceholder'));
      return;
    }
    if (trimmed.length > 100) {
      setError('名称不能超过 100 个字符');
      return;
    }
    setError('');
    const ret = await onOk?.({
      name: trimmed,
      description: description.trim(),
      category: category.trim(),
    });
    if (ret) {
      hideModal?.();
    }
  };

  return (
    <Dialog open onOpenChange={hideModal}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>编辑知识库</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm text-text-secondary">名称</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder={t('common.namePlaceholder')}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm text-text-secondary">分类</label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              maxLength={64}
              placeholder="例如：产品资料 / 合规制度（可留空）"
            />
            <p className="text-xs text-text-secondary">
              自由填写，用来给知识库分组；留空表示不归类。
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm text-text-secondary">描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full resize-y rounded-md border border-border-default bg-bg-base px-3 py-2 text-sm text-text-primary outline-none focus-visible:border-accent-primary"
              placeholder="这个知识库存什么、给谁用（可留空）"
            />
          </div>

          {error && <p className="text-sm text-text-primary">{error}</p>}
        </div>

        <DialogFooter>
          <ButtonLoading
            type="button"
            onClick={submit}
            loading={loading}
            disabled={loading}
          >
            {t('common.save')}
          </ButtonLoading>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
