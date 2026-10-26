import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
// 精确到子路径导入：date-fns/locale 的 barrel 会把全部 160+ 个语言包
// 一起打进 bundle，这里只用得到 en-US 和 zh-CN。
import { enUS } from 'date-fns/locale/en-US';
import { zhCN } from 'date-fns/locale/zh-CN';

/**
 * 当前界面语言对应的 date-fns locale。
 *
 * react-day-picker（日历面板）和 date-fns format（日期文本）都不读 i18next，
 * 各自默认 en-US。界面切到中文时这两处会留在英文，和其余部分割裂——
 * 表现为「中文界面里嵌一块 October 2026 / Su Mo Tu 的日历」。
 * 在这里按 i18n 语言喂对应的 locale 对象，让日期跟着语言走。
 *
 * dayjs 那一侧不走这里：`locales/config` 的 updateDocumentLocale 已经
 * 在语言切换时全局设置 dayjs.locale()，utils/date.ts 的格式化自动跟随。
 */
export function useDateLocale() {
  const { i18n } = useTranslation();
  // resolvedLanguage 是 i18next 解析后的最终语言（zh-Hans）；
  // language 在初始化早期可能还是浏览器探测值，取前者更稳。
  const language = i18n.resolvedLanguage || i18n.language || 'en';

  return useMemo(() => (language.startsWith('zh') ? zhCN : enUS), [language]);
}
