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

/**
 * 模型配置页只展示国内服务商。
 *
 * 为什么是白名单而不是黑名单：`GET /providers` 一次返回 75 个服务商，其中约 20 个
 * 是查不到归属的小型聚合站。黑名单只能挡住叫得出名字的那批（OpenAI / Anthropic /
 * Gemini / xAI / Mistral / Cohere / Bedrock / Azure …），剩下的会一直留在列表里；
 * 白名单的默认动作是「不显示」，新来源不会被无声放进来。漏掉的国内厂商补进下面的
 * 数组即可。
 *
 * 三类例外同样保留 —— 它们不是境外云服务：
 *   - 本地推理运行时（Ollama / VLLM / Xinference / LocalAI / LM-Studio / GPUStack）
 *     跑在客户自己的机器上；
 *   - 国内开源的 OCR / ASR 组件（PaddleOCR / MinerU / MonkeyOCR / FunASR）通常也是
 *     本地部署；
 *   - OpenAI-API-Compatible 是接私有网关的通用入口。
 *
 * 已经配置过的服务商不受这份名单约束（见 sidebar.tsx）：名单难免遗漏，而把
 * 一个已有实例的服务商藏起来，会让它彻底没法管理。
 */
export const DOMESTIC_PROVIDER_NAMES = [
  // 国内大模型厂商
  'DeepSeek',
  'Tongyi-Qianwen',
  'Moonshot',
  'ZHIPU-AI',
  'MiniMax',
  'BaiChuan',
  'StepFun',
  'XunFei Spark',
  'BaiduYiyan',
  'Tencent Hunyuan',
  'Xiaomi',
  'LongCat',

  // 国内云平台 / 模型托管
  'HuaweiCloud',
  'VolcEngine',
  'SILICONFLOW',
  'ModelScope',
  'GiteeAI',
  'Qiniu',
  'PPIO',
  '302.AI',
  'Jiekou.AI',

  // 国内开源的解析 / 语音组件（多为本地部署）
  'PaddleOCR',
  'PaddleOCR.local',
  'MinerU',
  'MonkeyOCR',
  'MonkeyOCRv2',
  'FunASR',

  // 本地推理运行时
  'Ollama',
  'VLLM',
  'Xinference',
  'LocalAI',
  'LM-Studio',
  'GPUStack',

  // 接私有网关的通用入口
  'OpenAI-API-Compatible',
] as const;

const DOMESTIC_PROVIDER_SET = new Set<string>(DOMESTIC_PROVIDER_NAMES);

/** 服务商是否属于国内可展示范围。名称必须与后端返回的 `provider.name` 完全一致。 */
export const isDomesticProvider = (name: string): boolean =>
  DOMESTIC_PROVIDER_SET.has(name);

/**
 * 从后端返回的服务商列表里挑出可展示的：白名单内的，加上本租户已经配置过的。
 *
 * 「已经配置过」是兜底而不是例外 —— 名单难免漏掉某个厂商，一旦某个境外服务商
 * 曾经被配上，隐藏它等于让人没法在界面上查看或删掉那个实例。
 */
export function filterVisibleProviders<T extends { name: string }>(
  providers: readonly T[],
  configured: ReadonlySet<string>,
): T[] {
  return providers.filter(
    (p) => configured.has(p.name) || isDomesticProvider(p.name),
  );
}
