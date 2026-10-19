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

/** 趋势图与环比计算覆盖的天数。 */
export const TREND_DAYS = 7;

/** 轮询间隔：看板数据变化较慢，60s 足够，避免 5s 级高频请求。 */
export const POLL_INTERVAL_MS = 60_000;

/**
 * 后端文档后缀 -> 业务来源分类的映射。
 *
 * 后端 `GET /datasets/{id}/documents?type=filter` 只返回 `suffix -> count`，
 * 这里按业务视角归类。新增后缀时补这里即可，无需改组件。
 */
export const SUFFIX_CATEGORY: Record<string, string> = {
  // 结构化问答
  csv: 'spreadsheet',
  xls: 'spreadsheet',
  xlsx: 'spreadsheet',

  // 文档
  pdf: 'document',
  doc: 'document',
  docx: 'document',
  txt: 'document',
  md: 'document',

  // 演示
  ppt: 'presentation',
  pptx: 'presentation',

  // 图片
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  bmp: 'image',
  tif: 'image',
  tiff: 'image',
  svg: 'image',
  webp: 'image',

  // 音视频
  mp3: 'media',
  wav: 'media',
  m4a: 'media',
  mp4: 'media',
  avi: 'media',
  mov: 'media',

  // 网页
  html: 'web',
  htm: 'web',
};

/** 来源分类的配色，顺序对应图表扇区顺序。 */
export const SOURCE_COLORS: Record<string, string> = {
  qa: '#7C4DFF',
  document: '#2F80ED',
  spreadsheet: '#27AE60',
  presentation: '#F2994A',
  image: '#EB5757',
  media: '#9B51E0',
  web: '#56CCF2',
  other: '#BDBDBD',
};

/** 来源分类的展示名（中文）。 */
export const SOURCE_LABELS: Record<string, string> = {
  qa: '结构化问答',
  document: 'PDF / Word',
  spreadsheet: 'Excel / CSV',
  presentation: 'PPT',
  image: '图片',
  media: '音视频',
  web: '网页',
  other: '其他',
};

/** 品牌主色，与 tailwind.css 的 --accent-primary 保持一致。 */
export const BRAND_BLUE = '#065BC1';
