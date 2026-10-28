/**
 * `search.status` 是库里的 "1"/"0"，列表直接渲染会让用户看到裸数字。
 * 这里集中做映射，组件只负责翻译成当前语言。
 */
const STATUS_LABEL_KEYS: Record<string, string> = {
  '1': 'common.statusActive',
  '0': 'common.statusInactive',
};

/**
 * 状态对应的 i18n key；未知或缺失时返回 undefined，由调用方渲染占位符
 * 而不是把原始值或 key 名漏到界面上。
 */
export const searchStatusLabelKey = (status?: string): string | undefined => {
  if (!status) {
    return undefined;
  }
  return STATUS_LABEL_KEYS[status];
};
