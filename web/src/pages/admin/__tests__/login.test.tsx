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

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import AdminLogin from '../login';

const mockGetCaptcha = jest.fn();
const mockLogin = jest.fn();
const mockNavigate = jest.fn();
const mockI18n = { language: 'zh-Hans' };

// 页面挂载时会调 createBrowserRouter()，jsdom 里没有 Request，必须整体 mock。
jest.mock('@/routes', () => ({
  Routes: { Admin: '/admin', AdminServices: '/admin/services' },
}));

jest.mock('react-i18next', () => ({
  // 顶栏 TopBarMeta 会读 i18n.language 决定语言标签，这里给一个固定值。
  useTranslation: () => ({ i18n: mockI18n, t: (key: string) => key }),
}));

// 语言切换入口来自 locales/config，整体替换掉，免得 i18next 在 jsdom 里真初始化。
jest.mock('@/locales/config', () => ({
  changeLanguageAsync: jest.fn(),
}));

jest.mock('react-router', () => ({
  useNavigate: () => mockNavigate,
}));

jest.mock('@/hooks/auth-hooks', () => ({
  useAuth: () => ({ isLogin: false }),
}));

jest.mock('@/services/admin-service', () => ({
  getCaptcha: (...args: unknown[]) => mockGetCaptcha(...args),
  login: (...args: unknown[]) => mockLogin(...args),
}));

jest.mock('@/pages/admin/layouts/root-layout', () => ({
  CurrentUserInfoContext: require('react').createContext([{}, jest.fn()]),
}));

function captchaResponse(id: string) {
  return {
    data: {
      code: 0,
      data: { captcha_id: id, captcha_image: `data:image/png;base64,${id}` },
    },
  };
}

function renderLogin() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AdminLogin />
    </QueryClientProvider>,
  );
}

function fillAndSubmit() {
  fireEvent.change(screen.getByPlaceholderText('emailFieldPlaceholder'), {
    target: { value: 'admin@example.com' },
  });
  fireEvent.change(screen.getByPlaceholderText('passwordFieldPlaceholder'), {
    target: { value: 'pw' },
  });
  fireEvent.change(screen.getByPlaceholderText('captchaLabel'), {
    target: { value: 'ABCD' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'login' }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetCaptcha.mockResolvedValue(captchaResponse('cid-1'));
});

it('进页面即拉取图形验证码并渲染图片', async () => {
  renderLogin();

  await waitFor(() =>
    expect(screen.getByAltText('captcha')).toBeInTheDocument(),
  );
  expect(screen.getByAltText('captcha')).toHaveAttribute(
    'src',
    'data:image/png;base64,cid-1',
  );
  expect(mockGetCaptcha).toHaveBeenCalledTimes(1);
});

it('登录请求带上 captcha_id 与 captcha，密码仍走 RSA', async () => {
  mockLogin.mockResolvedValue({
    data: { code: 0, data: { access_token: 'token', nickname: 'admin' } },
    headers: { get: () => 'Authorization-header' },
  });

  renderLogin();
  await waitFor(() =>
    expect(screen.getByAltText('captcha')).toBeInTheDocument(),
  );

  fillAndSubmit();

  await waitFor(() => expect(mockLogin).toHaveBeenCalledTimes(1));
  const payload = mockLogin.mock.calls[0][0] as Record<string, string>;
  expect(payload.email).toBe('admin@example.com');
  expect(payload.captcha_id).toBe('cid-1');
  expect(payload.captcha).toBe('ABCD');
  // rsaPsw 输出是密文，不等于明文。
  expect(payload.password).not.toBe('pw');
  expect(typeof payload.password).toBe('string');
  expect(payload.password.length).toBeGreaterThan(0);

  await waitFor(() =>
    expect(mockNavigate).toHaveBeenCalledWith('/admin/services'),
  );
});

it('登录失败后刷新验证码（一次性消费，不能拿旧 captcha_id 重试）', async () => {
  mockGetCaptcha
    .mockResolvedValueOnce(captchaResponse('cid-1'))
    .mockResolvedValueOnce(captchaResponse('cid-2'));
  mockLogin.mockResolvedValue({
    data: { code: 102, message: 'email and password do not match' },
    headers: {},
  });

  renderLogin();
  await waitFor(() =>
    expect(screen.getByAltText('captcha')).toBeInTheDocument(),
  );

  fillAndSubmit();

  await waitFor(() => expect(mockGetCaptcha).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(screen.getByAltText('captcha')).toHaveAttribute(
      'src',
      'data:image/png;base64,cid-2',
    ),
  );
  expect(mockNavigate).not.toHaveBeenCalled();
});
