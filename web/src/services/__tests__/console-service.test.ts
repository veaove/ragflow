import {
  addTenantMember,
  createConsoleRole,
  createDepartment,
  resetMemberPassword,
  saveConsolePermissions,
  setGrants,
  updateConsoleMember,
  updateConsoleRole,
  updateDepartment,
} from '../console-service';

/**
 * umi-request 的简写签名是 `(url, options)`，请求体必须放在 `options.data`。
 *
 * 直接把 body 当第二个参数传，umi 会把它当成 options（`{...options, method}`），
 * `options.data` 为 undefined，于是请求体是空串：后端 `ShouldBindJSON` 抛 io.EOF，
 * 返回 400 EOF。而 TypeScript 完全看不出来——`RequestOptionsInit` 的字段全是可选的，
 * 非字面量对象的多余属性又不会被检查。
 *
 * 这个测试就是那道闸：只要哪个写接口又把 body 裸传，第二个参数就不会只剩 `data`。
 */
jest.mock('@/utils/request', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

// jest.mock 会被提升到 import 之前，工厂里引用外部变量会撞上 TDZ，
// 所以先注册工厂，再用 requireMock 取回同一个对象。
const mockRequest = jest.requireMock('@/utils/request').default as {
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
};
const TENANT = 'tenant-1';

/** 断言这次调用把 body 放进了 options.data，且没有额外多余的 options 键。 */
function expectDataSentAs(fn: jest.Mock, call: () => unknown) {
  fn.mockClear();
  call();
  expect(fn).toHaveBeenCalledTimes(1);
  const options = fn.mock.calls[0][1];
  expect(options).toBeDefined();
  expect(Object.keys(options)).toEqual(['data']);
}

describe('console-service 写接口的请求体位置', () => {
  beforeEach(() => {
    Object.values(mockRequest).forEach((fn) => fn.mockReset());
  });

  it('部门增改都把 body 放进 options.data', () => {
    expectDataSentAs(mockRequest.post, () =>
      createDepartment(TENANT, { name: '研发部', parent_id: 'p-1' }),
    );
    expectDataSentAs(mockRequest.put, () =>
      updateDepartment(TENANT, 'd-1', { name: '研发一部' }),
    );
  });

  it('成员与角色增改都把 body 放进 options.data', () => {
    expectDataSentAs(mockRequest.put, () =>
      updateConsoleMember(TENANT, 'u-1', { department_id: 'd-1' }),
    );
    expectDataSentAs(mockRequest.post, () =>
      createConsoleRole(TENANT, { name: '审核员' }),
    );
    expectDataSentAs(mockRequest.put, () =>
      updateConsoleRole(TENANT, 'r-1', { name: '审核员' }),
    );
  });

  it('权限、授权、改密、直接加成员都把 body 放进 options.data', () => {
    expectDataSentAs(mockRequest.put, () =>
      saveConsolePermissions(TENANT, 'r-1', [
        { module: 'dataset', action: 'read', granted: true } as never,
      ]),
    );
    expectDataSentAs(mockRequest.put, () =>
      setGrants(TENANT, 'dataset', 'kb-1', [
        { kind: 'team', id: 't', name: '全团队' },
      ]),
    );
    expectDataSentAs(mockRequest.put, () =>
      resetMemberPassword(TENANT, 'u-1', 'encrypted'),
    );
    expectDataSentAs(mockRequest.post, () =>
      addTenantMember(TENANT, { email: 'a@b.com', role: 'normal' }),
    );
  });
});