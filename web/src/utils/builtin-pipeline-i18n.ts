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

import type {
  IBuiltinPipeline,
  IBuiltinPipelineHelp,
} from '@/interfaces/database/agent';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Built-in pipeline catalogues ship their title/description in several
 * languages (see internal/ingestion/pipeline/template/ingestion_pipeline_*.json).
 * The API returns the canonical English text plus a `*_i18n` map keyed by the
 * bare language subtag. These helpers pick the entry matching the active UI
 * locale so the built-in agents list follows the language switch, falling back
 * to English whenever a translation is missing.
 */

/** Locale codes that must resolve to a bare subtag other than their own. */
const LocaleSubtagOverrides: Record<string, string> = {
  // Simplified and Traditional Chinese both fall back to the templates' "zh".
  'zh-hans': 'zh',
  'zh-hant': 'zh',
  'zh-tw': 'zh',
  'zh-cn': 'zh',
  'zh-hk': 'zh',
  'zh-sg': 'zh',
  'pt-br': 'pt',
};

/**
 * Reduces a UI locale code to the bare subtag the API keys translations by:
 * "zh-Hans" => "zh", "pt-BR" => "pt", "en" => "en". Locale codes the templates
 * carry no translations for (ja, fr, ...) still reduce correctly and simply miss
 * the lookup, landing on the English fallback.
 */
export function normalizeBuiltinLang(lang?: string): string {
  const raw = (lang ?? '').trim().toLowerCase();
  if (!raw) return '';
  return LocaleSubtagOverrides[raw] ?? raw.split(/[-_]/)[0];
}

/**
 * Picks the best available translation from an i18n map: the active language
 * first, then English, then any translation at all, then the canonical
 * fallback. A missing/empty map yields the fallback unchanged, which keeps
 * single-language templates rendering exactly as before.
 */
export function pickBuiltinTranslation(
  translations: Record<string, string> | undefined,
  fallback: string | undefined,
  lang?: string,
): string | undefined {
  if (translations) {
    const target = normalizeBuiltinLang(lang);
    if (target && translations[target]) {
      return translations[target];
    }
    if (translations.en) {
      return translations.en;
    }
    const first = Object.values(translations).find((x) => x);
    if (first) return first;
  }
  return fallback;
}

/** Resolves a built-in pipeline's title for the given locale. */
export function resolveBuiltinTitle(
  item: IBuiltinPipeline,
  lang?: string,
): string {
  return (
    pickBuiltinTranslation(item.title_i18n, item.title, lang) ?? item.title ?? ''
  );
}

/** Resolves a built-in pipeline's description for the given locale. */
export function resolveBuiltinDescription(
  item: IBuiltinPipeline,
  lang?: string,
): string {
  return (
    pickBuiltinTranslation(item.description_i18n, item.description, lang) ?? ''
  );
}

/**
 * Resolves a built-in pipeline's help block for the given locale.
 *
 * 和 title / description 走同一套回退：当前语言 → en → 任意一种 → undefined。
 * 全都没有时返回 undefined，让调用方决定不渲染问号 —— 空 tooltip 比没有更糟。
 */
export function resolveBuiltinHelp(
  item: IBuiltinPipeline,
  lang?: string,
): IBuiltinPipelineHelp | undefined {
  const help = item.help;
  if (!help) return undefined;
  const target = normalizeBuiltinLang(lang);
  if (target && help[target]) return help[target];
  if (help.en) return help.en;
  return Object.values(help).find((x) => x);
}

/**
 * Hook form of the resolvers above. Every surface that renders a built-in
 * pipeline (agent cards, the read-only canvas header, the dataset parser
 * dropdown) uses this so they all follow the same language switch, and
 * `i18n.language` is the reactive dependency that re-renders them on change.
 */
export function useBuiltinPipelineLabels() {
  const { i18n } = useTranslation();

  // Not every consumer of this hook renders under a fully initialised i18n
  // instance (test doubles commonly expose only `t`), so treat a missing one
  // as "no active language": the resolvers then yield the canonical English
  // text, which is exactly what an untranslated catalogue should show.
  const lang = i18n?.resolvedLanguage || i18n?.language || '';

  return useMemo(() => {
    return {
      lang,
      title: (item: IBuiltinPipeline) => resolveBuiltinTitle(item, lang),
      description: (item: IBuiltinPipeline) =>
        resolveBuiltinDescription(item, lang),
      help: (item: IBuiltinPipeline) => resolveBuiltinHelp(item, lang),
    };
  }, [lang]);
}