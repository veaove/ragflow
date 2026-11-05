import { render, screen } from '@testing-library/react';

import { GrantChip, grantChipLabel } from '../grant-chip';

describe('GrantChip', () => {
  it('排除标成「已排除」并使用错误色', () => {
    render(
      <GrantChip
        grant={{
          kind: 'user',
          id: 'u1',
          name: '和君测试',
          permission: 'read',
          effect: 'deny',
        }}
      />,
    );

    const chip = screen.getByText('和君测试(已排除)');
    expect(chip.className).toContain('text-state-error');
  });

  it('允许按级别区分只读与可编辑', () => {
    expect(
      grantChipLabel({
        kind: 'user',
        id: 'u1',
        name: '张三',
        permission: 'read',
        effect: 'allow',
      }),
    ).toBe('张三(只读)');
    expect(
      grantChipLabel({
        kind: 'department',
        id: 'd1',
        name: '技术部',
        permission: 'edit',
        effect: 'allow',
      }),
    ).toBe('技术部(可编辑)');
  });

  it('全团队用固定文案，不显示主体 id', () => {
    expect(
      grantChipLabel({
        kind: 'team',
        id: '',
        name: '',
        permission: 'edit',
        effect: 'allow',
      }),
    ).toBe('全团队(可编辑)');
  });
});
