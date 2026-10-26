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

import Tenants from '../tenants';

const mockListTenants = jest.fn();
const mockListUsers = jest.fn();
const mockUpdateTenantName = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'zh-Hans' },
    t: (key: string) => key,
  }),
}));

jest.mock('@/services/admin-service', () => ({
  listTenants: (...args: unknown[]) => mockListTenants(...args),
  listUsers: (...args: unknown[]) => mockListUsers(...args),
  updateTenantName: (...args: unknown[]) => mockUpdateTenantName(...args),
  createTenant: jest.fn(),
  deleteTenant: jest.fn(),
  setTenantEnabled: jest.fn(),
  setTenantOwner: jest.fn(),
  listTenantResources: jest
    .fn()
    .mockResolvedValue({ data: { code: 0, data: [] } }),
  getTenantResourceSummary: jest
    .fn()
    .mockResolvedValue({ data: { code: 0, data: [] } }),
}));

const TENANT = {
  id: 'tenant-1',
  name: "nick's Kingdom",
  member_count: 2,
  kb_count: 11,
  agent_count: 13,
  status: '1',
  enabled: true,
  create_date: 1760000000000,
};

function renderTenants() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <Tenants />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockListTenants.mockResolvedValue({
    data: { code: 0, data: { list: [TENANT], total: 1 } },
  });
  mockListUsers.mockResolvedValue({ data: { code: 0, data: [] } });
  mockUpdateTenantName.mockResolvedValue({
    data: { code: 0, data: { id: TENANT.id, name: '新名字' } },
  });
});

describe('租户重命名', () => {
  it('点名称旁的编辑按钮打开重命名弹窗，并带出当前名称', async () => {
    renderTenants();

    const trigger = await screen.findByRole('button', {
      name: `重命名租户 ${TENANT.name}`,
    });
    fireEvent.click(trigger);

    const input = await screen.findByRole('textbox');
    expect((input as HTMLInputElement).value).toBe(TENANT.name);
  });

  it('提交后调用改名接口并刷新列表', async () => {
    renderTenants();

    fireEvent.click(
      await screen.findByRole('button', { name: `重命名租户 ${TENANT.name}` }),
    );

    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: '新名字' } });
    fireEvent.click(screen.getByRole('button', { name: '确定' }));

    await waitFor(() => {
      expect(mockUpdateTenantName).toHaveBeenCalledWith(TENANT.id, '新名字');
    });
    // 成功后要重新拉列表，否则表格还显示旧名字。
    await waitFor(() => {
      expect(mockListTenants.mock.calls.length).toBeGreaterThan(1);
    });
  });

  it('名称为空时不发请求', async () => {
    renderTenants();

    fireEvent.click(
      await screen.findByRole('button', { name: `重命名租户 ${TENANT.name}` }),
    );

    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: '   ' } });

    // 确定按钮此时应当禁用
    const confirm = screen.getByRole('button', { name: '确定' });
    expect(confirm).toBeDisabled();
    expect(mockUpdateTenantName).not.toHaveBeenCalled();
  });

  it('接口报错时把错误提示显示出来', async () => {
    mockUpdateTenantName.mockResolvedValue({
      data: { code: 102, message: '租户名称不能为空' },
    });
    renderTenants();

    fireEvent.click(
      await screen.findByRole('button', { name: `重命名租户 ${TENANT.name}` }),
    );

    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: '新名字' } });
    fireEvent.click(screen.getByRole('button', { name: '确定' }));

    expect(await screen.findByText('租户名称不能为空')).toBeInTheDocument();
  });
});
