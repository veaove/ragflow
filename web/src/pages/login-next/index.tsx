import { useAuth } from '@/hooks/auth-hooks';
import { useLogin } from '@/hooks/use-login-request';
import { useSystemConfig } from '@/hooks/use-system-request';
import { rsaPsw } from '@/utils';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { cn } from '@/lib/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import { FileImage, FileStack, ShieldCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { BrandShowcase, TopBarMeta } from './brand-showcase';
import { LoginCard } from './login-card';

const Login = () => {
  const navigate = useNavigate();
  const { login, loading } = useLogin();
  const { config } = useSystemConfig();
  const { t } = useTranslation('translation', { keyPrefix: 'login' });
  const { isLogin } = useAuth();

  useEffect(() => {
    if (isLogin) {
      navigate('/');
    }
  }, [isLogin, navigate]);

  const FormSchema = z.object({
    email: z
      .string()
      .email()
      .min(1, { message: t('emailPlaceholder') }),
    password: z.string().min(1, { message: t('passwordPlaceholder') }),
    captcha: z.string().optional(),
    remember: z.boolean().optional(),
  });
  type FormValues = z.infer<typeof FormSchema>;

  const form = useForm<FormValues>({
    defaultValues: { email: '', password: '', captcha: '', remember: true },
    resolver: zodResolver(FormSchema),
  });

  const onCheck = async (params: FormValues) => {
    try {
      // captcha 目前仅前端占位，等后端提供图形验证码接口后再并入登录请求。
      const code = await login({
        email: `${params.email}`.trim(),
        password: rsaPsw(params.password) as string,
      });
      if (code === 0) {
        navigate('/');
      }
    } catch (errorInfo) {
      console.log('Failed:', errorInfo);
    }
  };

  const disablePasswordLogin = !!config?.disablePasswordLogin;

  const copy = useMemo(
    () => ({
      title: t('accountLogin'),
      subtitle: t('loginSubtitle'),
      emailPlaceholder: t('emailFieldPlaceholder'),
      passwordPlaceholder: t('passwordFieldPlaceholder'),
      captchaLabel: t('captchaLabel'),
      rememberMe: t('rememberLogin'),
      forgotPassword: t('forgotPassword'),
      submit: t('login'),
      agreementPrefix: t('agreementPrefix'),
      agreementLink: t('agreementLink'),
    }),
    [t],
  );

  const highlights = useMemo(
    () => [
      {
        icon: FileImage,
        title: t('highlightIngest'),
        desc: t('highlightIngestDesc'),
      },
      {
        icon: FileStack,
        title: t('highlightSearch'),
        desc: t('highlightSearchDesc'),
      },
      {
        icon: ShieldCheck,
        title: t('highlightSecurity'),
        desc: t('highlightSecurityDesc'),
      },
    ],
    [t],
  );

  return (
    <div className="relative flex h-full min-h-screen w-full flex-col overflow-auto bg-[#F7F9FC]">
      {/* 顶部品牌栏 */}
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#E7ECF3] bg-white px-6 py-4 xl:px-10">
        <div className="flex min-w-0 items-center gap-3">
          <img
            src="/logo.svg"
            alt={`${t('brandName')} logo`}
            className="size-9 shrink-0"
          />
          {/* truncate 而非换行：空间不足时省略号优于逐字竖排 */}
          <span className="truncate text-[18px] font-bold tracking-tight text-[#0B4DA2] sm:text-[20px]">
            {t('brandName')}
          </span>
        </div>
        <TopBarMeta
          productionLabel={t('productionEnv')}
          helpLabel={t('helpCenter')}
        />
      </header>

      {/* 主体：左侧品牌区 + 右侧登录卡片 */}
      <main className="flex flex-1 flex-col items-center justify-center gap-12 px-6 py-10 lg:flex-row lg:gap-10 lg:py-14 xl:gap-16 xl:px-10">
        <BrandShowcase
          className={cn(
            // 关键：不要用 flex-1。它等价于 flex-basis:0%，而右侧 wrapper 用了
            // w-full(100%)，两者相加远超容器宽度；flex 收缩时 basis 为 0 的这一项
            // 无从压缩，宽度会被压到 0，只剩 padding，内容区宽度为负——
            // 中文便按 CJK 逐字换行规则一行一个字地竖着排。
            // 改为 w-full + max-w 限高，靠 flex 默认的 min-content 撑开即可。
            'w-full max-w-[720px]',
            disablePasswordLogin && 'lg:shrink-0',
          )}
          productName={t('productName')}
          tagline={t('productTagline')}
          highlights={highlights}
        />

        {/* 登录卡片：固定宽度且不允许被压缩，否则它会挤占品牌区的排版空间 */}
        <div className="flex w-full max-w-[400px] shrink-0 justify-center">
          <LoginCard
            form={form}
            loading={loading}
            onSubmit={onCheck}
            copy={copy}
          />
        </div>
      </main>

      <footer className="shrink-0 px-6 py-5 text-center text-[13px] text-[#8A93A2] xl:px-10">
        {t('copyright')}
      </footer>
    </div>
  );
};

export default Login;
