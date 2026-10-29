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

import type { IReferenceChunk } from '@/interfaces/database/chat';

export const normalizeCitationDigits = (text: string) => {
  if (!text) return text;
  return text.replace(/[٠-٩۰-۹]/g, (char) => {
    const code = char.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) {
      return String.fromCharCode(code - 0x0660 + 0x30);
    }
    if (code >= 0x06f0 && code <= 0x06f9) {
      return String.fromCharCode(code - 0x06f0 + 0x30);
    }
    return char;
  });
};

export type CitationKey = number | string;

const citationIdPattern = '[0-9a-fA-F\u0660-\u0669\u06F0-\u06F9]+';

// A citation marker has two accepted spellings: the canonical ASCII form
// ([12], [ID:12], [ID:12ab]) and the full-width form Chinese models fall back
// to when answering in Chinese — 【ID:12ab】, 【来源：ID12ab】. The full-width
// form must carry the ID or a source label, so ordinary Chinese brackets such
// as 【2024】 are not mistaken for citations.
const citationMarkerTemplate = (id: string) =>
  [
    `\\[(?:ID:)?${id}\\]`,
    `【\\s*(?:来源|出处|source)\\s*[:：]?\\s*(?:ID\\s*[:：]?\\s*)?${id}\\s*】`,
    `【\\s*ID\\s*[:：]\\s*${id}\\s*】`,
  ].join('|');

const citationMarkerPattern = citationMarkerTemplate(citationIdPattern);

export const citationMarkerReg = new RegExp(citationMarkerPattern, 'gi');

// react-string-replace hands its callback the LAST capture group, so the whole
// marker has to be the only group; citationMarkerReg keeps its id uncaptured.
export const citationWholeMarkerReg = new RegExp(
  `(${citationMarkerPattern})`,
  'gi',
);

const citationMarkerCaptureReg = new RegExp(
  citationMarkerTemplate(`(${citationIdPattern})`),
  'i',
);

export const parseCitationIndex = (value: string): CitationKey => {
  const normalized = normalizeCitationDigits(value);
  // Each marker spelling captures its id in its own group, so the id is
  // whichever captured group actually matched.
  const captured = normalized
    .match(citationMarkerCaptureReg)
    ?.slice(1)
    .find(Boolean);
  if (captured) {
    return /^\d+$/.test(captured) ? Number(captured) : captured;
  }
  if (/^\d+$/.test(normalized)) return Number(normalized);
  if (/^[0-9a-fA-F]+$/.test(normalized)) return normalized;
  return Number.NaN;
};

// Resolve the chunk a citation marker points at. A numeric key is the
// chunk's position in the payload — the plain-chat contract, where the
// backend numbers each marker by its index into reference.chunks. A string
// key is the chunk id an agent answer embeds in its [ID:<chunkId>] markers;
// match it against the chunk's own id, never positionally: the payload
// ships in retrieval order, which is unrelated to the order the answer
// cites passages in, so a positional read permutes the sources. A chunk id
// is 16 hex chars — an all-digit id would parse as a position (~0.05% per
// id), accepted and recorded here so it is not rediscovered as a mystery.
export const resolveCitationChunk = (
  chunks:
    | IReferenceChunk[]
    | Record<string, IReferenceChunk>
    | null
    | undefined,
  key: CitationKey,
): IReferenceChunk | undefined => {
  const list = Array.isArray(chunks) ? chunks : Object.values(chunks ?? {});
  if (typeof key === 'number') {
    return list[key];
  }
  return list.find(
    (chunk) =>
      chunk?.id === key ||
      (chunk as { chunk_id?: string } | undefined)?.chunk_id === key,
  );
};

// Map each unique citation marker ([n] or [ID:<chunkId>]) to its stable
// 0-based display position by first occurrence; the chip renders
// position + 1. This numbering is display-only — the chunk behind a marker
// is resolved by resolveCitationChunk, never by this position.
export const buildCitationDisplayMap = (
  content: string,
): Map<CitationKey, number> => {
  const map = new Map<CitationKey, number>();
  const reg = new RegExp(citationMarkerReg.source, citationMarkerReg.flags);
  let match: RegExpExecArray | null;
  while ((match = reg.exec(content ?? '')) !== null) {
    const key = parseCitationIndex(match[0]);
    if (Number.isNaN(key)) continue;
    if (!map.has(key)) {
      map.set(key, map.size);
    }
  }
  return map;
};

/**
 * 去掉回答里的引用标号，给「要念出来」的场景用（喇叭按钮、自动朗读）。
 *
 * 开了「引用」的智能体会在正文里插 [ID:<chunkId>]（前端渲染成 [1][2] 小标），
 * 语音渠道直接念原文就会把 "方括号 ID 冒号 4983…" 念出来。这里连同标号前面的
 * 那个空格一起去掉，免得中文标点前留一个空档。
 */
export const stripCitationMarkers = (content: string): string =>
  (content ?? '')
    .replace(citationMarkerReg, '')
    .replace(/[ \t]+(?=[，。；：！？、）】」』,.!?;:])/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
