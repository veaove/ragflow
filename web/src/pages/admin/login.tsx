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

import { type AxiosResponseHeaders } from 'axios';
import { Activity, ShieldCheck, Users } from 'lucide-react';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useMutation } from '@tanstack/react-query';

import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { ButtonLoading } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Authorization } from '@/constants/authorization';

import { useAuth } from '@/hooks/auth-hooks';
import { Routes } from '@/routes';
import { rsaPsw } from '@/utils';
import authorizationUtil from '@/utils/authorization-util';

import { getCaptcha, login } from '@/services/admin-service';

import { TopBarMeta } from '../login-next/brand-showcase';

import { CurrentUserInfoContext } from './layouts/root-layout';

/**
 * 管理后台登录页。
 *
 * 版式与租户端登录页（pages/login-next）对齐：顶栏 + 左侧能力区 + 右侧登录卡 + 页脚。
 * 下面这些差异是刻意留的，用来区分「运维后台」和「面向终端用户的产品入口」：
 * - 配色更冷更深（石墨蓝 #12233F / 深钢蓝 #1B4F8A），顶部一条深色渐变条；
 * - 能力卡讲管理侧的事（账号 / 服务 / 审计），不是产品卖点；
 * - 没有「忘记密码」和协议勾选：后台不提供自助找回，协议是面向终端用户的；
 * - 「记住登录状态」默认不勾选。
 */
function AdminLogin() {
  const navigate = useNavigate();
  const [, setCurrentUserInfo] = useContext(CurrentUserInfoContext);
  // admin 命名域放管理侧文案；表单措辞沿用 login 命名域，和租户端共用一套。
  const { t } = useTranslation('translation', { keyPrefix: 'admin' });
  const { t: tLogin } = useTranslation('translation', { keyPrefix: 'login' });
  const { isLogin } = useAuth();

  // 图形验证码：后端 LoginByEmail 强校验（缺了直接 109），
  // 进页面拉一张，登录失败后再换一张。与前台登录页同一套接口。
  const [captcha, setCaptcha] = useState<{
    id: string;
    image: string;
  } | null>(null);
  const refreshCaptcha = useCallback(async () => {
    try {
      const { data } = await getCaptcha();
      const payload = data?.data;
      if (payload?.captcha_id) {
        setCaptcha({ id: payload.captcha_id, image: payload.captcha_image });
      }
    } catch {
      setCaptcha(null);
    }
  }, []);

  useEffect(() => {
    refreshCaptcha();
  }, [refreshCaptcha]);

  const loginMutation = useMutation({
    mutationKey: ['adminLogin'],
    mutationFn: async (params: {
      email: string;
      password: string;
      captcha: string;
    }) => {
      const rsaPassWord = rsaPsw(params.password) as string;
      return await login({
        email: params.email,
        password: rsaPassWord,
        captcha_id: captcha?.id,
        captcha: params.captcha,
      });
    },
    onSuccess: (request) => {
      const { data: req, headers } = request;

      if (req?.code === 0) {
        const authorization = (headers as AxiosResponseHeaders)?.get(
          Authorization,
        );
        const token = req.data.access_token;

        // Lift to global user info context
        setCurrentUserInfo({
          userInfo: req.data,
          source: 'serverRequest',
        });

        authorizationUtil.setItems({
          Authorization: authorization as string,
          Token: token,
          userInfo: JSON.stringify({
            ...req.data,
            name: req.data.nickname,
          }),
        });

        navigate('/admin/services');
      } else {
        // 验证码一次性消费：登录失败后必须换一张，
        // 否则用户拿旧 captcha_id 重试会报「captcha expired」。
        refreshCaptcha();
      }
    },
    onError: (error) => {
      console.log('Failed:', error);
    },
    retry: false,
  });

  const loading = loginMutation.isPending;

  useEffect(() => {
    if (isLogin) {
      navigate(Routes.AdminServices);
    }
  }, [isLogin, navigate]);

  const FormSchema = z.object({
    email: z
      .string()
      .email()
      .min(1, { message: tLogin('emailPlaceholder') }),
    password: z.string().min(1, { message: tLogin('passwordPlaceholder') }),
    captcha: z.string().min(1, { message: tLogin('captchaRequired') }),
    // 后台不留「默认记住」的便利：共用机器上长期存会话不是好默认。
    remember: z.boolean().optional(),
  });

  const form = useForm({
    defaultValues: {
      email: '',
      password: '',
      captcha: '',
      remember: false,
    },
    resolver: zodResolver(FormSchema),
  });

  const highlights = useMemo(
    () => [
      {
        icon: Users,
        title: t('loginHighlightAccounts'),
        desc: t('loginHighlightAccountsDesc'),
      },
      {
        icon: Activity,
        title: t('loginHighlightServices'),
        desc: t('loginHighlightServicesDesc'),
      },
      {
        icon: ShieldCheck,
        title: t('loginHighlightAudit'),
        desc: t('loginHighlightAuditDesc'),
      },
    ],
    [t],
  );

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-auto bg-[#F4F6FA]">
      {/* 顶部深色渐变条：一眼区分「这是后台」 */}
      <div
        aria-hidden
        className="h-1 w-full shrink-0 bg-gradient-to-r from-[#12233F] via-[#1B4F8A] to-[#12233F]"
      />

      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#E2E8F0] bg-white px-6 py-4 xl:px-10">
        <div className="flex min-w-0 items-center gap-3">
          <img src="/logo.svg" alt="logo" className="size-9 shrink-0" />
          <span className="truncate text-[18px] font-bold tracking-tight text-[#12233F] sm:text-[20px]">
            {tLogin('brandName')}
          </span>
          <span className="hidden shrink-0 rounded-md border border-[#D8E1EE] bg-[#EEF3FA] px-2 py-0.5 text-[12px] font-medium text-[#1B4F8A] sm:inline">
            {t('loginTitle')}
          </span>
        </div>
        <TopBarMeta
          envLabel={tLogin('envLabel')}
          helpLabel={tLogin('helpCenter')}
        />
      </header>

      <main className="relative flex flex-1 flex-col items-center justify-center gap-10 px-6 py-8 lg:flex-row lg:gap-10 lg:py-10 xl:gap-16 xl:px-10">
        {/* 极淡网格：控制台质感；mask 让它只留在左上方，不压到登录卡 */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(to right, #E4EAF2 1px, transparent 1px), linear-gradient(to bottom, #E4EAF2 1px, transparent 1px)',
            backgroundSize: '56px 56px',
            maskImage:
              'radial-gradient(ellipse at 18% 30%, #000 0%, transparent 72%)',
            WebkitMaskImage:
              'radial-gradient(ellipse at 18% 30%, #000 0%, transparent 72%)',
          }}
        />

        <section className="relative w-full max-w-[720px] shrink px-2">
          <h1 className="text-[32px] font-bold leading-tight tracking-tight text-[#12233F] sm:text-[40px] xl:text-[46px]">
            {t('loginTitle')}
          </h1>

          <p className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[15px] font-medium text-[#3F4A5C] sm:text-[17px]">
            {t('loginTagline')
              .split('·')
              .map((item, index) => (
                <span
                  key={item}
                  className="flex items-center gap-3 whitespace-nowrap"
                >
                  {index > 0 && (
                    <span aria-hidden className="text-[#B4BDC9]">
                      ·
                    </span>
                  )}
                  {item.trim()}
                </span>
              ))}
          </p>

          {/* 窄屏不铺三张能力卡：手机上一屏内要先能看到登录表单 */}
          <ul className="mt-8 hidden grid-cols-1 gap-5 sm:mt-9 sm:grid sm:grid-cols-3">
            {highlights.map(({ icon: Icon, title, desc }) => (
              <li
                key={title}
                className="flex min-w-0 flex-col items-center gap-2.5 rounded-2xl border border-[#E2E8F0] bg-white px-4 py-6 text-center shadow-[0_1px_2px_rgba(16,42,84,0.04)]"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#EEF3FA] text-[#1B4F8A]">
                  <Icon className="size-5" strokeWidth={2} />
                </span>
                <span className="text-[15px] font-semibold text-[#12233F]">
                  {title}
                </span>
                <span className="text-xs leading-relaxed text-[#8A93A2]">
                  {desc}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <div className="relative flex w-full max-w-[400px] shrink-0 justify-center">
          <div className="w-full rounded-2xl border border-[#E2E8F0] bg-white px-8 py-7 shadow-[0_8px_32px_rgba(16,42,84,0.08)]">
            <header className="mb-5">
              <h2 className="text-[22px] font-semibold text-[#12233F]">
                {t('loginCardTitle')}
              </h2>
              <p className="mt-1.5 text-[13px] text-[#8A93A2]">
                {t('loginCardSubtitle')}
              </p>
            </header>

            <Form {...form}>
              <form
                className="flex flex-col gap-4"
                data-testid="admin-login-form"
                onSubmit={form.handleSubmit((data) =>
                  loginMutation.mutate(data),
                )}
              >
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          data-testid="admin-email"
                          placeholder={tLogin('emailFieldPlaceholder')}
                          autoComplete="email"
                          className="h-[42px] rounded-lg border-[#D6DEE9] bg-white text-[15px] text-[#1F2937] placeholder:text-[#9CA3AF]"
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
                          data-testid="admin-password"
                          type="password"
                          placeholder={tLogin('passwordFieldPlaceholder')}
                          autoComplete="current-password"
                          className="h-[42px] rounded-lg border-[#D6DEE9] bg-white text-[15px] text-[#1F2937] placeholder:text-[#9CA3AF]"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="captcha"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <div className="flex items-center gap-3">
                          <Input
                            data-testid="admin-captcha"
                            placeholder={tLogin('captchaLabel')}
                            autoComplete="off"
                            className="h-[42px] flex-1 rounded-lg border-[#D6DEE9] bg-white text-[15px] text-[#1F2937] placeholder:text-[#9CA3AF]"
                            {...field}
                          />
                          <button
                            type="button"
                            onClick={refreshCaptcha}
                            title={tLogin('captchaRefresh')}
                            className="flex h-[38px] w-[104px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-[#D6DEE9] bg-[#EEF3FA]"
                          >
                            {captcha?.image ? (
                              <img
                                src={captcha.image}
                                alt="captcha"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <span className="text-xs text-[#8A93A2]">
                                {tLogin('captchaLoading')}
                              </span>
                            )}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="remember"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center gap-2">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={(checked) =>
                              field.onChange(checked)
                            }
                            className="size-4 data-[state=checked]:border-[#1B4F8A] data-[state=checked]:bg-[#1B4F8A] data-[state=checked]:text-white"
                          />
                        </FormControl>
                        <span className="text-[13px] text-[#3F4A5C]">
                          {tLogin('rememberLogin')}
                        </span>
                      </div>
                    </FormItem>
                  )}
                />

                <ButtonLoading
                  data-testid="admin-submit"
                  type="submit"
                  loading={loading}
                  className="mt-1 h-[44px] w-full rounded-lg bg-[#1B4F8A] text-[15px] font-medium text-white hover:bg-[#153F6E]"
                >
                  {tLogin('login')}
                </ButtonLoading>
              </form>
            </Form>

            <p className="mt-5 flex items-start gap-2 rounded-lg bg-[#F6F8FB] px-3 py-2 text-[12px] leading-relaxed text-[#6B7686]">
              <ShieldCheck
                className="mt-0.5 size-3.5 shrink-0 text-[#1B4F8A]"
                strokeWidth={2}
              />
              <span>{t('loginSecurityNote')}</span>
            </p>
          </div>
        </div>
      </main>

      <footer className="shrink-0 px-6 py-5 text-center text-[13px] text-[#8A93A2] xl:px-10">
        {tLogin('copyright')}
      </footer>
    </div>
  );
}

export default AdminLogin;
