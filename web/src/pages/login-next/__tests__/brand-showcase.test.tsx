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

import { fireEvent, render, screen } from '@testing-library/react';

import { TopBarMeta } from '../brand-showcase';

const mockChangeLanguage = jest.fn();
const mockI18n = { language: 'en' };

// locales/config 在模块作用域就初始化 i18next（LanguageDetector 读 localStorage），
// 单测里整体替换掉，只留切换入口。
jest.mock('@/locales/config', () => ({
  changeLanguageAsync: (...args: unknown[]) => mockChangeLanguage(...args),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: mockI18n, t: (key: string) => key }),
}));

function renderTopBar() {
  return render(<TopBarMeta envLabel="Development" helpLabel="Help Center" />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockI18n.language = 'en';
});

it('英文页面显示当前语言 English，点击切到简体中文', () => {
  renderTopBar();

  // 标签是「当前语言」，与站内 header 的「简体中文」同一套语义；
  // 点击后的动作放 title / aria-label。
  const button = screen.getByRole('button', { name: '切换为简体中文' });
  expect(button).toHaveTextContent('English');

  fireEvent.click(button);
  expect(mockChangeLanguage).toHaveBeenCalledWith('zh-Hans');
});

it('中文页面显示简体中文，点击切回 English', () => {
  mockI18n.language = 'zh-Hans';
  renderTopBar();

  const button = screen.getByRole('button', { name: '切换为English' });
  expect(button).toHaveTextContent('简体中文');

  fireEvent.click(button);
  expect(mockChangeLanguage).toHaveBeenCalledWith('en');
});
