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

/** 图形验证码：显示后端下发的 base64 图片，点击刷新。 */
function CaptchaImage({
  image,
  onRefresh,
  className,
}: {
  image?: string;
  onRefresh?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onRefresh}
      title="点击刷新验证码"
      className={cn(
        'flex h-[38px] w-[104px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-[#D6DEE9] bg-[#EEF2F7]',
        className,
      )}
    >
      {image ? (
        <img src={image} alt="captcha" className="h-full w-full object-cover" />
      ) : (
        <span className="text-xs text-[#8FA3BC]">加载中</span>
      )}
    </button>
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
  /** 验证码输入框的名称。 */
  captchaFieldName?: string;
  /** 后端下发的 base64 图形验证码图片。 */
  captchaImage?: string;
  /** 点击验证码图片刷新。 */
  onRefreshCaptcha?: () => void;
  onForgotPassword?: () => void;
  className?: string;
};

/**
 * 登录卡片。布局与设计稿一致：标题 + 副标题、输入项、记住登录/忘记密码、提交按钮、协议说明。
 *
 * 图形验证码已接入后端：图片来自 GET /auth/captcha 下发的 base64，
 * 提交时连同 captcha_id 一起发送，后端做一次性校验。
 */
export function LoginCard({
  form,
  loading,
  onSubmit,
  copy,
  captchaFieldName = 'captcha',
  captchaImage,
  onRefreshCaptcha,
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
                    <CaptchaImage image={captchaImage} onRefresh={onRefreshCaptcha} />
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
