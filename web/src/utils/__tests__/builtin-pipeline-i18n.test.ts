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

import type { IBuiltinPipeline } from '@/interfaces/database/agent';
import {
  normalizeBuiltinLang,
  pickBuiltinTranslation,
  resolveBuiltinDescription,
  resolveBuiltinTitle,
} from '../builtin-pipeline-i18n';

const general: IBuiltinPipeline = {
  id: 'general',
  title: 'General',
  description: 'Segments parsed files by token count.',
  filename: 'ingestion_pipeline_general.json',
  title_i18n: { en: 'General', de: 'Allgemein', zh: '通用' },
  description_i18n: {
    en: 'Segments parsed files by token count.',
    de: 'Teilt die geparste Datei anhand der Token-Anzahl auf.',
    zh: '按照 token 数量对解析后的文件进行切片。',
  },
};

// A template that only ever declared one language, i.e. no *_i18n map at all.
const singleLanguage: IBuiltinPipeline = {
  id: 'book',
  title: 'Book',
  description: 'Long document parsing',
};

describe('normalizeBuiltinLang', () => {
  it('reduces a plain subtag to itself', () => {
    expect(normalizeBuiltinLang('en')).toBe('en');
    expect(normalizeBuiltinLang('de')).toBe('de');
  });

  it('strips script and region subtags', () => {
    expect(normalizeBuiltinLang('ja-JP')).toBe('ja');
    expect(normalizeBuiltinLang('fr-CA')).toBe('fr');
  });

  it('maps both Chinese variants onto the templates" zh key', () => {
    // The UI uses BCP-47 codes while the templates key on a bare "zh".
    expect(normalizeBuiltinLang('zh-Hans')).toBe('zh');
    expect(normalizeBuiltinLang('zh-Hant')).toBe('zh');
    expect(normalizeBuiltinLang('zh-TW')).toBe('zh');
  });

  it('maps pt-BR onto pt', () => {
    expect(normalizeBuiltinLang('pt-BR')).toBe('pt');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(normalizeBuiltinLang('  ZH-Hans ')).toBe('zh');
  });

  it('returns an empty string for a missing language', () => {
    expect(normalizeBuiltinLang(undefined)).toBe('');
    expect(normalizeBuiltinLang('')).toBe('');
  });
});

describe('pickBuiltinTranslation', () => {
  it('picks the translation for the active language', () => {
    expect(pickBuiltinTranslation(general.title_i18n, general.title, 'zh-Hans')).toBe(
      '通用',
    );
    expect(pickBuiltinTranslation(general.title_i18n, general.title, 'de')).toBe(
      'Allgemein',
    );
  });

  it('falls back to English when the language has no translation', () => {
    expect(pickBuiltinTranslation(general.title_i18n, general.title, 'ja')).toBe(
      'General',
    );
  });

  it('falls back to the canonical value when there is no i18n map', () => {
    expect(pickBuiltinTranslation(undefined, 'General', 'zh-Hans')).toBe(
      'General',
    );
  });

  it('falls back to any available translation when English is missing', () => {
    expect(pickBuiltinTranslation({ zh: '通用' }, 'General', 'ja')).toBe('通用');
  });

  it('yields undefined when there is nothing at all to show', () => {
    expect(pickBuiltinTranslation(undefined, undefined, 'zh-Hans')).toBeUndefined();
  });
});

describe('resolveBuiltinTitle / resolveBuiltinDescription', () => {
  it('localises a fully translated pipeline', () => {
    expect(resolveBuiltinTitle(general, 'zh-Hans')).toBe('通用');
    expect(resolveBuiltinDescription(general, 'zh-Hans')).toBe(
      '按照 token 数量对解析后的文件进行切片。',
    );
    expect(resolveBuiltinTitle(general, 'de')).toBe('Allgemein');
  });

  it('keeps a single-language pipeline rendering as before', () => {
    expect(resolveBuiltinTitle(singleLanguage, 'zh-Hans')).toBe('Book');
    expect(resolveBuiltinDescription(singleLanguage, 'zh-Hans')).toBe(
      'Long document parsing',
    );
  });

  it('returns an empty string for a missing description rather than undefined', () => {
    const noDescription = { id: 'x', title: 'X' } as IBuiltinPipeline;
    expect(resolveBuiltinDescription(noDescription, 'zh-Hans')).toBe('');
  });

  it('returns an empty title for an item with no title at all', () => {
    const empty = { id: 'x' } as unknown as IBuiltinPipeline;
    expect(resolveBuiltinTitle(empty, 'zh-Hans')).toBe('');
  });
});