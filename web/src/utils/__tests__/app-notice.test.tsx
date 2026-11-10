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

import { act, fireEvent, render, screen } from '@testing-library/react';

import { AppNoticeHost } from '@/components/app-notice-host';
import message from '@/components/ui/message';
import { dismissAppNotice, getAppNotices } from '@/utils/app-notice';
import notification from '@/utils/notification';
import { toast } from '@/utils/toast';

jest.mock('sonner', () => ({
  __esModule: true,
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
    loading: jest.fn(() => 'loading-id'),
    dismiss: jest.fn(),
    custom: jest.fn(),
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sonner = require('sonner').toast;

const drainNotices = () => {
  getAppNotices().forEach((notice) => dismissAppNotice(notice.id));
};

/**
 * 红 / 黄提示统一走弹框：toast.error / toast.warning / message.error /
 * notification.error|warning 都是同一条出口，成功与进行中仍是轻提示。
 */
describe('unified app notice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    act(() => drainNotices());
  });

  it('renders a red toast as the shared dialog instead of a corner toast', () => {
    render(<AppNoticeHost />);

    act(() => {
      toast.error('发布失败');
    });

    expect(screen.getByText('发布失败')).toBeInTheDocument();
    expect(screen.getByText('知道了')).toBeInTheDocument();
    expect(sonner.error).not.toHaveBeenCalled();
  });

  it('splits the permission warning into title and description', () => {
    render(<AppNoticeHost />);

    act(() => {
      notification.warning({
        message: '权限不足',
        description: '您当前角色没有「该功能」的操作权限，请联系管理员授予相应权限。',
      });
    });

    expect(screen.getByText('权限不足')).toBeInTheDocument();
    expect(
      screen.getByText('您当前角色没有「该功能」的操作权限，请联系管理员授予相应权限。'),
    ).toBeInTheDocument();
    expect(sonner.warning).not.toHaveBeenCalled();
  });

  it('routes message.error through the same dialog', () => {
    render(<AppNoticeHost />);

    act(() => {
      message.error('保存失败', { description: '磁盘空间不足' });
    });

    expect(screen.getByText('保存失败')).toBeInTheDocument();
    expect(screen.getByText('磁盘空间不足')).toBeInTheDocument();
    expect(sonner.error).not.toHaveBeenCalled();
  });

  it('keeps success as a light toast', () => {
    render(<AppNoticeHost />);

    act(() => {
      toast.success('已保存');
    });

    expect(sonner.success).toHaveBeenCalledWith('已保存');
    expect(screen.queryByText('已保存')).not.toBeInTheDocument();
  });

  it('shows one dialog per distinct message and queues the rest', () => {
    render(<AppNoticeHost />);

    act(() => {
      toast.error('上传失败');
      toast.error('上传失败');
    });

    expect(getAppNotices()).toHaveLength(1);

    act(() => {
      fireEvent.click(screen.getByText('知道了'));
    });

    expect(screen.queryByText('上传失败')).not.toBeInTheDocument();
    expect(getAppNotices()).toHaveLength(0);
  });
});
