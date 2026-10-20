/**
 * 分页规则（产品文档《交互调整说明》3.3）。
 *
 * 智能体与工作室两个列表页共用同一份规则：默认 12 条/页，可选
 * 8/12/24/48；页数 ≤7 时全部显示，超出则首尾 + 当前页 ±1。
 *
 * 放在共享常量里而不是各自定义，是为了让「两个页面规则完全一致」
 * 这条要求在代码层面成立——改一处即可，不会出现两页漂移。
 */
export const LIST_PAGE_SIZE_OPTIONS = [8, 12, 24, 48];

export const LIST_DEFAULT_PAGE_SIZE = 12;

export const LIST_MAX_DISPLAYED_PAGES = 7;
