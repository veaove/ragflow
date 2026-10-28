/**
 * 记忆列表里两个字典型字段的文案映射。
 *
 * 后端把 `memory_type`（raw / semantic / episodic / procedural）和
 * `storage_type`（table / graph）原样当枚举返回，`GET /memories/filters`
 * 里 `filterOptionsInOrder` 也是把 id 直接塞进 label，于是中文界面下
 * 筛选器和列表都会摆出英文枚举。这里统一收口成 i18n key。
 *
 * 不认识的枚举返回 undefined，由调用方决定回退口径：
 * 表格里显示 "-"，筛选器里保留服务端给的 label（未来新增枚举时至少
 * 还能筛，不会变成一个空选项）。
 */
const MEMORY_TYPE_LABEL_KEYS: Record<string, string> = {
  raw: 'memories.raw',
  semantic: 'memories.semantic',
  episodic: 'memories.episodic',
  procedural: 'memories.procedural',
};

const STORAGE_TYPE_LABEL_KEYS: Record<string, string> = {
  table: 'memories.storageTable',
  graph: 'memories.storageGraph',
};

export const memoryTypeLabelKey = (
  value?: string | null,
): string | undefined => {
  if (!value) {
    return undefined;
  }
  return MEMORY_TYPE_LABEL_KEYS[value];
};

export const storageTypeLabelKey = (
  value?: string | null,
): string | undefined => {
  if (!value) {
    return undefined;
  }
  return STORAGE_TYPE_LABEL_KEYS[value];
};
