import { IDialog } from '@/interfaces/database/chat';

/**
 * 知识问答列表（表格 + 卡片）共用的展示口径。
 *
 * 产品要求很明确：列表里看到的是**名称**，不是 id。库里 llm_id / rerank_id
 * 存的是 uuid 或 `model@instance@provider` 复合值，知识库只存 id，所以展示层
 * 必须先做一次 id → 名称映射，映射不到才兜底 "-"。
 *
 * 这些函数刻意留在这里而不是塞进组件：表格和卡片必须用同一套规则，
 * 各写一份迟早会出现「表格显示名字、卡片显示 uuid」的错位。
 *
 * 本文件只放纯函数（不引 hooks、不碰 React），映射规则因此可以被单测直接覆盖；
 * 模型列表的取数与缓存见 `use-model-name-resolver.ts`。
 */

/** 映射不到名称时的统一占位符。 */
export const EMPTY_LABEL = '-';

/** 未关联任何知识库时的文案，与改造前保持一致。 */
export const NO_KNOWLEDGE_BASE_LABEL = '未关联';

/**
 * 知识库列：接口成对返回 `dataset_ids` 与 `kb_names`，两个数组在同一个循环里
 * 同时 append（`getDatasetNamesAndIDs`），因此下标一一对应。
 *
 * 某个 id 没有对应名称时按产品要求兜底 "-"；完全没有 id 时返回空数组，
 * 由调用方展示「未关联」。
 */
export function getKnowledgeBaseNames(
  row: Pick<IDialog, 'dataset_ids' | 'kb_names'>,
): string[] {
  const ids = row.dataset_ids ?? [];
  const names = row.kb_names ?? [];

  if (!ids.length) {
    // 只有名称、没有 id 的旧响应形状：原样展示，不要因为缺 id 就清空。
    return names;
  }

  return ids.map((_, index) => names[index] || EMPTY_LABEL);
}

/**
 * 单元格文案：最多平铺两个名称，其余收成「等 N 个」，
 * 完整列表放 title，避免一列被十几个知识库撑爆。
 */
export function formatKnowledgeBaseCell(names: string[]): {
  text: string;
  title?: string;
} {
  if (!names.length) {
    return { text: NO_KNOWLEDGE_BASE_LABEL };
  }

  const full = names.join('、');

  return {
    text: names.length > 2 ? `${names.slice(0, 2).join('、')} 等 ${names.length} 个` : full,
    title: full,
  };
}
