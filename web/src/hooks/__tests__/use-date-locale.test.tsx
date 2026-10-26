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

import { renderHook } from '@testing-library/react';
import { useTranslation } from 'react-i18next';
import { useDateLocale } from '../use-date-locale';

// 直接 mock 掉 i18next：本用例只关心「语言码 → date-fns locale」的映射，
// 不想把 i18next 的初始化拖进来（那个在 node 环境里会报错）。
jest.mock('react-i18next', () => ({
  useTranslation: jest.fn(),
}));

const mockUseTranslation = useTranslation as jest.Mock;

const mockLanguage = (resolvedLanguage?: string, language = 'en') => {
  mockUseTranslation.mockReturnValue({ i18n: { resolvedLanguage, language } });
};

describe('useDateLocale', () => {
  it('中文界面返回 zh-CN', () => {
    mockLanguage('zh-Hans', 'zh-Hans');

    const { result } = renderHook(() => useDateLocale());

    expect(result.current.code).toBe('zh-CN');
  });

  it('英文界面返回 en-US', () => {
    mockLanguage('en', 'en');

    const { result } = renderHook(() => useDateLocale());

    expect(result.current.code).toBe('en-US');
  });

  it('繁体中文同样落 zh-CN（日期格式与简体一致）', () => {
    mockLanguage('zh-Hant', 'zh-Hant');

    const { result } = renderHook(() => useDateLocale());

    expect(result.current.code).toBe('zh-CN');
  });

  it('resolvedLanguage 缺失时回退到 language', () => {
    mockLanguage(undefined, 'zh-Hans');

    const { result } = renderHook(() => useDateLocale());

    expect(result.current.code).toBe('zh-CN');
  });

  it('中文 locale 的月份名是中文（回归：曾经恒为英文）', () => {
    mockLanguage('zh-Hans', 'zh-Hans');

    const { result } = renderHook(() => useDateLocale());

    // 10 月：英文 locale 会给 'October'
    expect(result.current.localize.month(9)).toBe('十月');
  });

  it('英文 locale 的月份名是英文', () => {
    mockLanguage('en', 'en');

    const { result } = renderHook(() => useDateLocale());

    expect(result.current.localize.month(9)).toBe('October');
  });
});
