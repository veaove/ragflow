// https://originui.com/r/comp-23.json

'use client';

import React, { useId } from 'react';
import { Input, InputProps } from '../ui/input';

/**
 * 密码输入的薄封装。
 *
 * 早期版本在这里做了「小眼睛」明文切换（`type` 在 text/password 之间切换）。
 * 现在全站密码字段一律不可明文回显——API Key、密钥、token 属于一次性写入的
 * 凭证，能被一键看见就等于能被顺手抄走。开关能力已从 `Input` 移除，
 * 这里也不再保留 `isVisible` 状态，避免留下可绕过的入口。
 */
export default React.forwardRef<HTMLInputElement, InputProps>(
  function PasswordInput({ ...props }, ref) {
    const id = useId();

    return (
      <div className="*:not-first:mt-2">
        <div className="relative">
          <Input
            id={id}
            type="password"
            placeholder="Password"
            ref={ref}
            {...props}
          />
        </div>
      </div>
    );
  },
);
