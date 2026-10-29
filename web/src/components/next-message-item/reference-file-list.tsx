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

import { useTranslate } from '@/hooks/common-hooks';
import { IReferenceChunk } from '@/interfaces/database/chat';
import { buildCitationDisplayMap } from '@/utils/chat';
import { useMemo } from 'react';
import { ReferenceDocumentList } from './reference-document-list';
import { aggregateReferenceDocs } from './utils';

type IProps = {
  chunks?: IReferenceChunk[] | Record<string, IReferenceChunk>;
  content?: string;
};

/**
 * 回答下方的「这轮答案照着哪些文件说的」。
 *
 * 只在正文里没有 [N] 引用标号时出现：有标号的时候，标号本身就带着切片和文档，
 * 再列一遍文件是重复信息。
 *
 * 没标号通常意味着画布上那个 Agent 节点没开「引用」——电话播报这类场景不能开，
 * 标号会被 TTS 念出来。但检索确实发生了，此时什么都不显示，等于把这轮答案的
 * 依据藏了起来，试用和运行时根本没法核对它是照着哪份材料答的。
 */
export function ReferenceFileList({ chunks, content }: IProps) {
  const { t } = useTranslate('chat');

  const documents = useMemo(() => {
    if (buildCitationDisplayMap(content ?? '').size > 0) {
      return [];
    }
    return aggregateReferenceDocs(chunks);
  }, [chunks, content]);

  if (documents.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <span className="text-xs text-text-secondary">
        {t('referenceFiles', { num: documents.length })}
      </span>
      <ReferenceDocumentList list={documents}></ReferenceDocumentList>
    </div>
  );
}
