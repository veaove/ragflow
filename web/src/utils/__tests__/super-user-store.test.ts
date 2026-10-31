import {
  isSuperUserDenied,
  isSuperUserDeniedMessage,
  markSuperUserDenied,
  resetSuperUserDenied,
  subscribeSuperUserDenied,
} from '../super-user-store';

describe('isSuperUserDeniedMessage', () => {
  it('识别后端判超管的那条 403 message', () => {
    expect(
      isSuperUserDeniedMessage('Super user shouldn\'t access the URL'),
    ).toBe(true);
    // 大小写、空格写法变了也不能漏
    expect(isSuperUserDeniedMessage('Superuser shouldn’t access the URL')).toBe(
      true,
    );
    expect(isSuperUserDeniedMessage('SUPER USER SHOULDNT ACCESS THE URL')).toBe(
      true,
    );
  });

  it('普通权限提示不算超管', () => {
    expect(
      isSuperUserDeniedMessage('当前角色没有「数据源」模块的操作权限'),
    ).toBe(false);
    expect(isSuperUserDeniedMessage('Authorization is not valid!')).toBe(false);
    expect(isSuperUserDeniedMessage(undefined)).toBe(false);
    expect(isSuperUserDeniedMessage('')).toBe(false);
  });
});

describe('superUserDenied 标记', () => {
  afterEach(() => {
    resetSuperUserDenied();
  });

  it('翻 true 只通知一次，重复标记无副作用', () => {
    const notify = jest.fn();
    const unsubscribe = subscribeSuperUserDenied(notify);

    expect(isSuperUserDenied()).toBe(false);

    markSuperUserDenied();
    markSuperUserDenied();

    expect(isSuperUserDenied()).toBe(true);
    // 第二个 403 不应该再触发一次渲染
    expect(notify).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('换登录身份后能回到 false', () => {
    const notify = jest.fn();
    subscribeSuperUserDenied(notify);

    markSuperUserDenied();
    resetSuperUserDenied();

    expect(isSuperUserDenied()).toBe(false);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('取消订阅后不再收到通知', () => {
    const notify = jest.fn();
    const unsubscribe = subscribeSuperUserDenied(notify);
    unsubscribe();

    markSuperUserDenied();

    expect(notify).not.toHaveBeenCalled();
  });
});
