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

import { AudioExtensions } from '@/constants/common';
import {
  IReferenceChunk,
  UploadResponseDataType,
} from '@/interfaces/database/chat';
import { IDocumentInfo } from '@/interfaces/database/document';
import {
  buildCitationDisplayMap,
  currentReg,
  parseCitationIndex,
  resolveCitationChunk,
} from '@/utils/chat';
import { getExtension } from '@/utils/document-util';

export type ReferenceImageItem = {
  /** 卡片去重键，就是引用标号本身（[n] 或 [ID:<chunkId>]）。 */
  key: string;
  /** 切片里抽出的配图。没有图的切片不出卡片。 */
  imageId: string;
  documentId: string;
  documentName: string;
  /** 卡片顺序，同时是 [N] 徽标的序号来源。 */
  index: number;
  /** 图上的 [N] 徽标。 */
  label: string;
};

/**
 * 回答下方那些引用卡片的数据：一个标号一张卡，卡上是那句话引用的那张图。
 *
 * 标号本身选切片 —— 普通问答的数字标号按位置索引 chunks（徽标显示 n + 1），
 * 智能体的 [ID:<chunkId>] 标号按切片自己的 id 匹配。两条路径都不依赖载荷顺序：
 * 载荷按检索顺序排，和正文引用的先后无关。
 *
 * 没有标号的回答（画布上的 Agent 节点没开「引用」）不出卡片 —— 卡片是"这句话
 * 引用了哪张图"，不是"这轮检索命中了什么"。要让 IVR 这类智能体也有卡片，
 * 应该打开节点的「引用」开关，而不是在这里按文档堆卡。
 */
export function buildReferenceImages(
  chunks: IReferenceChunk[] | Record<string, IReferenceChunk> | undefined,
  content: string | undefined,
): ReferenceImageItem[] {
  const list = Array.isArray(chunks) ? chunks : Object.values(chunks ?? {});

  return [...buildCitationDisplayMap(content ?? '').entries()]
    .map(([key, position]): ReferenceImageItem | null => {
      const chunk = resolveCitationChunk(list, key);
      // 无图切片没有图可放：卡片只服务"引用到的那张图"。
      if (!chunk?.image_id || !chunk?.document_id) {
        return null;
      }
      const index = typeof key === 'number' ? key : position;
      return {
        key: String(key),
        imageId: chunk.image_id,
        documentId: chunk.document_id,
        documentName: chunk.document_name ?? '',
        index,
        label: `[${index + 1}]`,
      };
    })
    .filter((item): item is ReferenceImageItem => item !== null);
}

export const extractNumbersFromMessageContent = (content: string) => {
  const matches = content?.match(currentReg);
  if (matches) {
    const list = matches
      .map((match) => {
        const parsed = parseCitationIndex(match);
        return Number.isNaN(parsed) ? null : parsed;
      })
      .filter((num) => num !== null) as number[];

    return list;
  }
  return [];
};

const ImageExtensions = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'webp',
  'svg',
  'ico',
  'avif',
];

export function getFileMimeType(
  file: File | IDocumentInfo | UploadResponseDataType,
): string {
  if (file instanceof File) {
    return file.type;
  }
  if ('mime_type' in file && typeof file.mime_type === 'string') {
    return file.mime_type;
  }
  return '';
}

export function isImageFile(
  file: File | IDocumentInfo | UploadResponseDataType,
): boolean {
  const mimeType = getFileMimeType(file);
  if (mimeType) {
    return mimeType.startsWith('image/');
  }
  return ImageExtensions.includes(getExtension(file.name));
}

export function isAudioFile(
  file: File | IDocumentInfo | UploadResponseDataType,
): boolean {
  const mimeType = getFileMimeType(file);
  if (mimeType) {
    return mimeType.startsWith('audio/');
  }
  return AudioExtensions.includes(getExtension(file.name));
}
