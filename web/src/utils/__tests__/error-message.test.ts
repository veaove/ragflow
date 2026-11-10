import {
  actionLabelFromMethod,
  classifyFailure,
  describeFailure,
  describeSessionExpired,
} from '../error-message';

/**
 * 失败提示只有一个出口：界面上不许出现状态码、业务码、接口地址和英文原文，
 * 只讲「原因类别 + 下一步做什么」。这里锁住的就是这条边界。
 */
describe('failure classification', () => {
  test('requests that never reached the server are network failures', () => {
    // 请求层拿不到响应时自己填 1999；它是断网，不是登录失效。
    expect(classifyFailure({ code: 1999 })).toBe('network');
    expect(classifyFailure({ message: 'Failed to fetch' })).toBe('network');
    expect(classifyFailure({ message: 'timeout of 300000ms exceeded' })).toBe(
      'network',
    );
  });

  test('404 covers both "deleted" and "no permission"', () => {
    expect(classifyFailure({ code: 404 })).toBe('notFound');
    expect(classifyFailure({ status: 404 })).toBe('notFound');
  });

  test('permission failures keep their own category', () => {
    expect(classifyFailure({ status: 403 })).toBe('permission');
    expect(classifyFailure({ code: 108 })).toBe('permission');
  });

  test('auth is reserved for an expired session', () => {
    expect(classifyFailure({ status: 401 })).toBe('auth');
    expect(classifyFailure({ code: 401 })).toBe('auth');
  });
});

describe('describeFailure', () => {
  test('never renders codes, urls or english messages', () => {
    const notice = describeFailure({ status: 500, message: 'panic: nil map' });

    expect(notice.title).toBe('操作失败');
    expect(notice.description).not.toMatch(/500|panic|nil map/);
  });

  test('keeps a backend message that is already written for humans', () => {
    const notice = describeFailure({
      code: 409,
      message: '同名文件已存在',
    });

    expect(notice.description).toContain('同名文件已存在');
  });

  test('uses the action in the title', () => {
    expect(describeFailure({ status: 500 }, '保存').title).toBe('保存失败');
  });

  test('notFound tells the user how to get access back', () => {
    const notice = describeFailure({ code: 404 }, '保存');

    expect(notice.description).toContain('刷新');
    expect(notice.description).toContain('可编辑');
  });
});

describe('action labels', () => {
  test('maps the http method to what the user was trying to do', () => {
    expect(actionLabelFromMethod('get')).toBe('加载');
    expect(actionLabelFromMethod('POST')).toBe('保存');
    expect(actionLabelFromMethod('delete')).toBe('删除');
    expect(actionLabelFromMethod(undefined)).toBe('操作');
  });
});

describe('describeSessionExpired', () => {
  test('explains the redirect instead of echoing the token error', () => {
    const notice = describeSessionExpired();

    expect(notice.category).toBe('auth');
    expect(notice.title).toBe('登录状态已失效');
    expect(notice.description).toContain('重新登录');
  });
});
