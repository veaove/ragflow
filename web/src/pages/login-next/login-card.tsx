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

import { ButtonLoading } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { UseFormReturn } from 'react-hook-form';

/** 验证码占位图：后端尚未提供图形验证码接口，先渲染静态占位。 */
function CaptchaPlaceholder({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'flex h-[38px] w-[104px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-[#D6DEE9] bg-[#EEF2F7]',
        className,
      )}
    >
      <svg width="88" height="34" viewBox="0 0 88 34" fill="none">
        <path
          d="M2 26C14 6 24 30 36 12s22 16 34-2"
          stroke="#8FA3BC"
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />
        <path
          d="M6 8l12 24M30 4l-8 26M56 6l-10 22M74 10l-12 18"
          stroke="#C3CEDD"
          strokeWidth="1"
        />
        <text
          x="44"
          y="24"
          textAnchor="middle"
          fontFamily="monospace"
          fontSize="17"
          fontWeight="700"
          fill="#7E8CA0"
          letterSpacing="3"
        >
          8K3M
        </text>
      </svg>
    </div>
  );
}

export type LoginCardCopy = {
  title: string;
  subtitle: string;
  emailPlaceholder: string;
  passwordPlaceholder: string;
  captchaLabel: string;
  rememberMe: string;
  forgotPassword: string;
  submit: string;
  agreementPrefix: string;
  agreementLink: string;
};

type LoginCardProps = {
  form: UseFormReturn<any>;
  loading: boolean;
  onSubmit: (params: any) => void;
  copy: LoginCardCopy;
  /** 验证码输入框的名称；后端接入前仅参与前端校验，不参与登录请求。 */
  captchaFieldName?: string;
  onForgotPassword?: () => void;
  className?: string;
};

/**
 * 登录卡片。布局与设计稿一致：标题 + 副标题、输入项、记住登录/忘记密码、提交按钮、协议说明。
 *
 * 注意：`captcha` 目前只做前端占位，提交时会被表单校验拦下但不会传给后端；
 * 后端登录接口接入图形验证码后，这里补上字段映射即可。
 */
export function LoginCard({
  form,
  loading,
  onSubmit,
  copy,
  captchaFieldName = 'captcha',
  onForgotPassword,
  className,
}: LoginCardProps) {
  return (
    <div
      className={cn(
        'w-full max-w-[400px] rounded-2xl border border-[#E7ECF3] bg-white px-8 py-9 shadow-[0_8px_32px_rgba(16,42,84,0.08)]',
        className,
      )}
    >
      <header className="mb-7">
        <h2 className="text-[22px] font-semibold text-[#1B2431]">
          {copy.title}
        </h2>
        <p className="mt-1.5 text-[13px] text-[#8A93A2]">{copy.subtitle}</p>
      </header>

      <Form {...form}>
        <form
          className="flex flex-col gap-5"
          data-testid="auth-form"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input
                    data-testid="auth-email"
                    placeholder={copy.emailPlaceholder}
                    autoComplete="email"
                    className="h-[42px] rounded-lg border-[#D6DEE9] text-[15px]"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input
                    data-testid="auth-password"
                    type="password"
                    placeholder={copy.passwordPlaceholder}
                    autoComplete="current-password"
                    className="h-[42px] rounded-lg border-[#D6DEE9] text-[15px]"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name={captchaFieldName}
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <div className="flex items-center gap-3">
                    <Input
                      data-testid="auth-captcha"
                      placeholder={copy.captchaLabel}
                      autoComplete="off"
                      className="h-[42px] flex-1 rounded-lg border-[#D6DEE9] text-[15px]"
                      {...field}
                    />
                    <CaptchaPlaceholder />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex items-center justify-between">
            <FormField
              control={form.control}
              name="remember"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-2">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(checked) => field.onChange(checked)}
                        className="size-4 data-[state=checked]:border-[#1B6DD6] data-[state=checked]:bg-[#1B6DD6] data-[state=checked]:text-white"
                      />
                    </FormControl>
                    <FormLabel className="cursor-pointer text-[13px] font-normal text-[#3F4A5C]">
                      {copy.rememberMe}
                    </FormLabel>
                  </div>
                </FormItem>
              )}
            />

            <button
              type="button"
              onClick={onForgotPassword}
              className="text-[13px] text-[#5A6474] underline-offset-4 transition-colors hover:text-[#1B6DD6] hover:underline"
            >
              {copy.forgotPassword}
            </button>
          </div>

          <ButtonLoading
            data-testid="auth-submit"
            type="submit"
            loading={loading}
            className="mt-1 h-[44px] w-full rounded-lg bg-[#1B6DD6] text-[15px] font-medium text-white hover:bg-[#1558B4]"
          >
            {copy.submit}
          </ButtonLoading>
        </form>
      </Form>

      <p className="mt-6 text-center text-[12px] leading-relaxed text-[#8A93A2]">
        {copy.agreementPrefix}
        <a
          href="#"
          onClick={(event) => event.preventDefault()}
          className="mx-1 text-[#1B6DD6] hover:underline"
        >
          {copy.agreementLink}
        </a>
      </p>
    </div>
  );
}
