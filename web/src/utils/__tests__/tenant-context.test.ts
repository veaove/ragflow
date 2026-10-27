import storage from '../authorization-util';
import {
  getCurrentDepartmentId,
  getCurrentTenantId,
  setCurrentDepartmentId,
  setCurrentTenantId,
} from '../tenant-context';

/**
 * 「当前租户」存在 localStorage，由请求拦截器统一塞进 X-Tenant-ID。
 * 它属于某个人的上下文，所以必须跟着会话一起生灭 —— 否则换个人登录后，
 * 浏览器会拿上一个账号的租户 id 去请求，服务端日志和顶栏都跟着错位。
 */
describe('tenant context lifecycle', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('switching tenant drops the department of the previous tenant', () => {
    setCurrentTenantId('tenant-a');
    setCurrentDepartmentId('dept-a');

    setCurrentTenantId('tenant-b');

    expect(getCurrentTenantId()).toBe('tenant-b');
    // 部门是租户下的二级上下文，换了租户就不该再留着旧部门
    expect(getCurrentDepartmentId()).toBe('');
  });

  test('signing out clears the tenant context for the next account', () => {
    setCurrentTenantId('tenant-a');
    setCurrentDepartmentId('dept-a');

    storage.removeAll();

    expect(getCurrentTenantId()).toBe('');
    expect(getCurrentDepartmentId()).toBe('');
  });
});
