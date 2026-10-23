import { fireEvent, render, screen } from '@testing-library/react';

import { Input } from '../input';

/**
 * 密码字段不允许明文回显。
 *
 * 早期 `Input` 在 `type="password"` 时会自动渲染一个「小眼睛」按钮，点一下就把
 * `type` 切成 `text`。模型配置里的 API Key / 密钥、数据源 token、MCP 凭证都走
 * 这个组件，等于所有凭证都能被一键看见。该能力已移除，这里锁死行为：
 * 输入框始终是 password，且不存在可切换的按钮。
 */
describe('Input 密码字段', () => {
  it('渲染为 password，且不出现明文切换按钮', () => {
    render(<Input type="password" data-testid="secret" defaultValue="sk-123" />);

    const input = screen.getByTestId('secret') as HTMLInputElement;

    expect(input.type).toBe('password');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('聚焦、输入、点击都不会把 type 改成 text', () => {
    render(<Input type="password" data-testid="secret" defaultValue="" />);

    const input = screen.getByTestId('secret') as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'sk-abc' } });
    fireEvent.click(input);

    expect(input.type).toBe('password');
  });

  it('带 suffix 时依然不渲染按钮', () => {
    render(
      <Input
        type="password"
        data-testid="secret"
        suffix={<span data-testid="suffix-slot" />}
      />,
    );

    expect(screen.getByTestId('suffix-slot')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect((screen.getByTestId('secret') as HTMLInputElement).type).toBe(
      'password',
    );
  });
});
