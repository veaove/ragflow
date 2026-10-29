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
  Docagg,
  IReferenceChunk,
  UploadResponseDataType,
} from '@/interfaces/database/chat';
import { IDocumentInfo } from '@/interfaces/database/document';
import { currentReg, parseCitationIndex } from '@/utils/chat';
import { getExtension } from '@/utils/document-util';

/**
 * 把本轮命中的切片按文档聚合，得到「这次回答翻了哪几个文件」。
 *
 * 为什么要前端自己聚合：智能体画布上「引用」开关没打开的节点（比如电话 IVR
 * 的播报节点，标号会被 TTS 念出来）不会在正文里插 [ID:…] 标号，后端也就把
 * doc_aggs 裁掉了。可试用/运行时最想知道的恰恰是「它照着哪份材料答的」，所以
 * 这里退一步用 chunks 自己数——chunks 一定带 document_id / document_name。
 *
 * 两种载荷形态都要认：问答应用给数组，智能体的 IReferenceObject 给 key→chunk 的字典。
 */
export function aggregateReferenceDocs(
  chunks?: IReferenceChunk[] | Record<string, IReferenceChunk>,
): Docagg[] {
  const list = Array.isArray(chunks) ? chunks : Object.values(chunks ?? {});
  const byDocument = new Map<string, Docagg>();

  list.forEach((chunk) => {
    const docId = chunk?.document_id;
    if (!docId) {
      return;
    }
    const existing = byDocument.get(docId);
    if (existing) {
      existing.count += 1;
      return;
    }
    byDocument.set(docId, {
      count: 1,
      doc_id: docId,
      doc_name: chunk.document_name ?? '',
    });
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
