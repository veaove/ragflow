import { fireEvent, render, screen } from '@testing-library/react';

import { GrantBoundaryHint } from '../grant-boundary-hint';

/**
 * 授权页的说明文字只讲「哪三档可见」，最容易踩错的是另一件事：能不能改配置、
 * 删内容只看来源。这条规则挂在黄色感叹号后面，点开就得能对照到具体行。
 */
describe('GrantBoundaryHint', () => {
  it('点开提示能看到按来源划分的操作权限边界', () => {
    render(<GrantBoundaryHint />);

    fireEvent.click(
      screen.getByRole('button', { name: /操作权限边界（与档次无关/ }),
    );

    expect(screen.getByText('可改配置')).toBeInTheDocument();
    expect(screen.getByText('可再授权')).toBeInTheDocument();
    expect(
      screen.getByText('部门管理员（本部门创建的资源）'),
    ).toBeInTheDocument();
    expect(screen.getByText('显式授权 read')).toBeInTheDocument();
    expect(
      screen.getByText('无授权的普通成员'),
    ).toBeInTheDocument();
  });
});
