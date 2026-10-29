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
  /** 卡片去重键：标号卡片用标号，文档卡片用文档 id。 */
  key: string;
  /** 切片里抽出的配图。为空表示这份文档没有配图，卡片位置放文件图标。 */
  imageId: string;
  documentId: string;
  documentName: string;
  /** 卡片顺序。标号卡片用它算 [N] 徽标。 */
  index: number;
  /** 只有标号卡片才带 [N] 徽标；文档卡片没有编号。 */
  label?: string;
};

/**
 * 回答下方那些引用卡片的数据。
 *
 * 两种情形共用同一套卡片：
 *  1. 回答里有 [N] 标号 —— 一个标号一张卡，卡上是那句话引用的那张图，带 [N] 徽标；
 *  2. 回答里没有标号 —— 画布上的 Agent 节点没开「引用」（电话 IVR 不能开，标号会被
 *     TTS 念出来）。这时退化成「每份命中文档一张卡」：有配图用配图，没配图放文件图标。
 *
 * 为什么第 2 种要退化而不是什么都不画：检索确实发生了，界面上却一片空白，试用和
 * 运行时就没法核对这轮答案的依据是什么。
 *
 * 标号本身选切片：普通问答的数字标号按位置索引 chunks（徽标显示 n + 1），智能体的
 * [ID:<chunkId>] 标号按切片自己的 id 匹配。两条路径都不依赖载荷顺序。
 */
export function buildReferenceImages(
  chunks: IReferenceChunk[] | Record<string, IReferenceChunk> | undefined,
  content: string | undefined,
  options: { fallbackToHitDocuments?: boolean } = {},
): ReferenceImageItem[] {
  const list = Array.isArray(chunks) ? chunks : Object.values(chunks ?? {});
  const markers = buildCitationDisplayMap(content ?? '');

  if (markers.size > 0) {
    return [...markers.entries()]
      .map(([key, position]): ReferenceImageItem | null => {
        const chunk = resolveCitationChunk(list, key);
        // 标号卡片是「那句话引用的那张图」，无图切片没有图可放，和原来一样跳过。
        if (!chunk?.image_id || !chunk?.document_id) {
          return null;
        }
        const index = typeof key === 'number' ? key : position;
        return {
          key: String(key),
          imageId: chunk.image_id ?? '',
          documentId: chunk.document_id,
          documentName: chunk.document_name ?? '',
          index,
          label: `[${index + 1}]`,
        };
      })
      .filter((item): item is ReferenceImageItem => item !== null);
  }

  if (!options.fallbackToHitDocuments) {
    return [];
  }

  const byDocument = new Map<string, ReferenceImageItem>();
  list.forEach((chunk) => {
    const documentId = chunk?.document_id;
    if (!documentId) {
      return;
    }
    const imageId = chunk.image_id ?? '';
    const existing = byDocument.get(documentId);
    if (!existing) {
      byDocument.set(documentId, {
        key: documentId,
        imageId,
        documentId,
        documentName: chunk.document_name ?? '',
        index: byDocument.size,
      });
      return;
    }
    // 同一份文档只有部分切片带图，别因为先撞上无图的那条就把图丢掉。
    if (!existing.imageId && imageId) {
      existing.imageId = imageId;
    }
  });

  return [...byDocument.values()];
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
