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

import { Operator } from '@/constants/agent';

/**
 * 画布节点标签的本地化映射。
 *
 * 画布节点把 `component_name`（"GeneralChunker"）直接当标签展示，那是
 * 类型标识符而非展示文案。绝大多数语言的词条都是按标识符驼峰建的
 * （flow.generalChunker、flow.tokenChunker ...），这里只补两者对不上的键。
 */
const OperatorLabelKey: Record<string, string> = {
  [Operator.GeneralChunker]: 'flow.generalChunker',
  [Operator.TokenChunker]: 'flow.tokenChunker',
  [Operator.TitleChunker]: 'flow.titleChunker',
  [Operator.ManualChunker]: 'flow.manualChunker',
  [Operator.TableChunker]: 'flow.tableChunker',
  [Operator.QAChunker]: 'flow.qaChunker',
  [Operator.OneChunker]: 'flow.oneChunker',
  [Operator.PageChunker]: 'flow.pageChunker',
  [Operator.Parser]: 'flow.parser',
  [Operator.Extractor]: 'flow.extractor',
  [Operator.Compiler]: 'flow.compiler',
  [Operator.Tokenizer]: 'flow.tokenizer',
  [Operator.ExcelProcessor]: 'flow.excelProcessor',
};

/**
 * 返回该 operator 对应的 i18n key；未登记的类型返回 null，交由调用方
 * 回退到节点自带的 label（可能是用户自定义名称，不能丢）。
 */
export function operatorLabelKey(operatorType?: string): string | null {
  if (!operatorType) return null;
  return OperatorLabelKey[operatorType] ?? null;
}