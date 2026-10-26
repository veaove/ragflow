import { LanguageAbbreviation } from '@/constants/common';
import storage from '@/utils/authorization-util';
import dayjs from 'dayjs';
import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { upperFirst } from 'lodash';
import { initReactI18next } from 'react-i18next';
import translation_en from './en';

//The language is based on the .ng file stored in the client's local storage.
// The language stored in the database is for agent template resources, as these resources reside on the server.
// When a user logs in from a different machine, the login page language is the language configured by VITE_DEFAULT_LANGUAGE_CODE.

/**
 * Fallback language for a first visit (no persisted choice in localStorage).
 *
 * Defaults to Simplified Chinese: the product ships to Chinese customers, and
 * an English login page as the opening screen reads as "wrong product" to them.
 * A deployment that wants English by default sets VITE_DEFAULT_LANGUAGE_CODE.
 */
export const DEFAULT_LANGUAGE_CODE =
  import.meta.env.VITE_DEFAULT_LANGUAGE_CODE || LanguageAbbreviation.Zh;

/**
 * 本产品仅面向中文用户维护，故只保留中文（简/繁）与英文。
 *
 * 用户本地存储里若残留已删除的语言（如 'ja'），`supportedLngs` 会让 i18next
 * 回退到 fallbackLng，不会报错。
 */
const languageImports: Record<string, () => Promise<{ default: any }>> = {
  [LanguageAbbreviation.En]: () => import('./en'),
  [LanguageAbbreviation.Zh]: () => import('./zh'),
  [LanguageAbbreviation.ZhTraditional]: () => import('./zh-traditional'),
};

const supportedLanguageCodes: Intl.UnicodeBCP47LocaleIdentifier[] =
  Object.keys(languageImports);

export const supportedLanguages = supportedLanguageCodes.map((code) => {
  const locale = new Intl.Locale(code);

  return {
    code,
    locale,
    displayName: upperFirst(
      new Intl.DisplayNames(locale, { type: 'language' }).of(code)!,
    ),
  };
});

/**
 * UI 语言切换器展示的语言。
 *
 * 与 supportedLanguages 分开是为了兼容存量用户：本地存储里存了已下线语言的用户，
 * 仍应按该值渲染（切换器不展示它，但也不作废它），而不是被静默重置。
 */
const headerLanguageCodes: string[] = [
  LanguageAbbreviation.Zh,
  LanguageAbbreviation.En,
];

export const headerLanguages = supportedLanguages.filter((lang) =>
  headerLanguageCodes.includes(lang.code),
);

const resources = {
  [LanguageAbbreviation.En]: translation_en,
};

const updateDocumentLocale = (lng: string) => {
  document.documentElement.lang = lng;
  document.documentElement.dir = 'ltr';
  // 语言码是 zh-Hans / zh-Hant（constants/common 的 LanguageAbbreviation），
  // 而 dayjs 只认 zh-cn。原来写死 `lng === 'zh'` 永远不成立，
  // dayjs.locale() 收到不认识的码会静默保持原值（默认 en），
  // 于是中文界面下的日期全成了英文。这里按前缀归一化，
  // 繁简都落 zh-cn——日期格式上两者一致，且 dayjs 没有加载 zh-tw，
  // 传了反而会静默失败。
  dayjs.locale(lng.startsWith('zh') ? 'zh-cn' : lng);
};

i18n
  .use(initReactI18next)
  .use(LanguageDetector)
  .init({
    detection: {
      lookupLocalStorage: 'lng',
      order: ['localStorage'],
      caches: [],
    },
    supportedLngs: supportedLanguageCodes,
    resources,
    fallbackLng: DEFAULT_LANGUAGE_CODE,
    interpolation: {
      escapeValue: false,
    },
  });

export const loadLanguageAsync = async (lng: string): Promise<void> => {
  const normalizedLng = lng;

  if (i18n.hasResourceBundle(normalizedLng, 'translation')) {
    return;
  }

  const importFn = languageImports[normalizedLng];
  if (!importFn) {
    console.warn(`Language ${lng} is not supported for lazy loading`);
    return;
  }

  try {
    const module = await importFn();
    const translationData = module.default?.translation || module.default;
    i18n.addResourceBundle(normalizedLng, 'translation', translationData);
  } catch (error) {
    console.error(`Failed to load language ${lng}:`, error);
  }
};

export const changeLanguageAsync = async (
  lng: string,
  options: { persist?: boolean } = {},
): Promise<void> => {
  const { persist = true } = options;
  const normalizedLng = lng;

  if (
    normalizedLng !== LanguageAbbreviation.En &&
    !i18n.hasResourceBundle(normalizedLng, 'translation')
  ) {
    await loadLanguageAsync(normalizedLng);
  }

  if (persist) {
    storage.setLanguage(lng);
  }

  updateDocumentLocale(lng);

  await i18n.changeLanguage(normalizedLng);
};

export const initLanguage = async (): Promise<void> => {
  const currentLng = storage.getLanguage() || DEFAULT_LANGUAGE_CODE;

  await changeLanguageAsync(currentLng);
};

export default i18n;
