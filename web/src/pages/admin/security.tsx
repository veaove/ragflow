import { useEffect, useMemo, useState } from 'react';

import { useTranslation } from 'react-i18next';

import { useMutation, useQuery } from '@tanstack/react-query';

import { LucideLoader2, LucideSave, LucideShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import message from '@/components/ui/message';
import {
  getSecuritySettings,
  updateSecuritySettings,
  type SecuritySettings,
} from '@/services/admin-service';

/** 一行配置项：左侧标题+说明，右侧控件。 */
const Field = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <div className="flex items-start justify-between gap-6 py-3">
    <div className="min-w-0">
      <div className="text-sm font-medium text-text-primary">{label}</div>
      {hint ? (
        <div className="mt-0.5 text-xs text-text-secondary">{hint}</div>
      ) : null}
    </div>
    <div className="flex shrink-0 items-center gap-2">{children}</div>
  </div>
);

/** 带单位后缀的数字输入。 */
const NumberInput = ({
  value,
  onChange,
  unit,
  min,
  max,
  disabled,
}: {
  value: number;
  onChange: (num: number) => void;
  unit: string;
  min: number;
  max: number;
  disabled?: boolean;
}) => (
  <div className="flex items-center gap-2">
    <Input
      type="number"
      className="w-24"
      value={Number.isFinite(value) ? value : min}
      min={min}
      max={max}
      disabled={disabled}
      onChange={(e) => {
        // An emptied input reports NaN; clamp instead of letting it reach the API.
        const parsed = Number(e.target.value);
        onChange(Number.isFinite(parsed) ? parsed : min);
      }}
    />
    <span className="text-xs text-text-secondary">{unit}</span>
  </div>
);

export default function SecurityPage() {
  const { t } = useTranslation();

  const [form, setForm] = useState<SecuritySettings | null>(null);

  const {
    data: loaded,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['admin/security'],
    queryFn: async () => (await getSecuritySettings()).data.data,
  });

  // Mirror the fetched policy into local form state so edits stay local until
  // the administrator presses Save.
  useEffect(() => {
    if (loaded) {
      setForm(structuredClone(loaded));
    }
  }, [loaded]);

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: async (payload: SecuritySettings) =>
      (await updateSecuritySettings(payload)).data.data,
    onSuccess: (saved) => {
      // Trust the server's echo: it normalises zero values and re-reads the row.
      setForm(saved);
      message.success(t('admin.securityPage.saved'));
      refetch();
    },
    onError: (err: any) => {
      const detail =
        err?.response?.data?.message ?? err?.message ?? String(err);
      message.error(`${t('admin.securityPage.saveFailed')}: ${detail}`);
    },
  });

  const canSubmit = useMemo(() => {
    if (!form) return false;
    const login = form.login;
    // Mirror the backend rule so the button is disabled before the round trip.
    return login.method_password || login.method_sso || login.method_ldap;
  }, [form]);

  const patchLogin = (patch: Partial<SecuritySettings['login']>) =>
    setForm((prev) =>
      prev ? { ...prev, login: { ...prev.login, ...patch } } : prev,
    );
  const patchPassword = (patch: Partial<SecuritySettings['password']>) =>
    setForm((prev) =>
      prev ? { ...prev, password: { ...prev.password, ...patch } } : prev,
    );
  const patchSession = (patch: Partial<SecuritySettings['session']>) =>
    setForm((prev) =>
      prev ? { ...prev, session: { ...prev.session, ...patch } } : prev,
    );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-text-secondary">
        <LucideLoader2 className="mr-2 size-4 animate-spin" />
        {t('admin.securityPage.saving')}
      </div>
    );
  }

  if (isError || !form) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="text-sm text-text-secondary">
          {t('admin.securityPage.loadFailed')}
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          {t('admin.securityPage.save')}
        </Button>
      </div>
    );
  }

  const lockDisabled = !form.login.lock_enabled;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-4 border-b border-border-default px-6 py-4">
        <div className="flex items-start gap-3">
          <LucideShieldCheck className="mt-0.5 size-5 text-accent-primary" />
          <div>
            <h1 className="text-base font-semibold text-text-primary">
              {t('admin.securitySettings')}
            </h1>
            <p className="mt-0.5 text-xs text-text-secondary">
              {t('admin.securityPage.description')}
            </p>
          </div>
        </div>
        <Button
          disabled={!canSubmit || saving}
          onClick={() => save(form)}
          className="shrink-0"
        >
          {saving ? (
            <LucideLoader2 className="mr-1.5 size-4 animate-spin" />
          ) : (
            <LucideSave className="mr-1.5 size-4" />
          )}
          {saving
            ? t('admin.securityPage.saving')
            : t('admin.securityPage.save')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex max-w-4xl flex-col gap-4 pb-6">
          {/* 登录方式 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                {t('admin.securityPage.loginMethods')}
              </CardTitle>
              <CardDescription className="text-xs">
                {t('admin.securityPage.loginMethodsDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent className="divide-y divide-border-default pt-0">
              <Field
                label={t('admin.securityPage.methodPassword')}
                hint={t('admin.securityPage.methodPasswordDesc')}
              >
                <Switch
                  checked={form.login.method_password}
                  onCheckedChange={(v) => patchLogin({ method_password: v })}
                />
              </Field>
              <Field
                label={t('admin.securityPage.methodSSO')}
                hint={t('admin.securityPage.methodSSODesc')}
              >
                <span className="rounded-sm bg-state-warning-5 px-1.5 py-0.5 text-xs text-state-warning">
                  {t('admin.securityPage.enterpriseOnly')}
                </span>
                <Switch
                  checked={form.login.method_sso}
                  onCheckedChange={(v) => patchLogin({ method_sso: v })}
                />
              </Field>
              <Field
                label={t('admin.securityPage.methodLDAP')}
                hint={t('admin.securityPage.methodLDAPDesc')}
              >
                <span className="rounded-sm bg-state-warning-5 px-1.5 py-0.5 text-xs text-state-warning">
                  {t('admin.securityPage.enterpriseOnly')}
                </span>
                <Switch
                  checked={form.login.method_ldap}
                  onCheckedChange={(v) => patchLogin({ method_ldap: v })}
                />
              </Field>
              {!canSubmit ? (
                <div className="py-2 text-xs text-state-error">
                  {t('admin.securityPage.atLeastOneMethod')}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* 密码策略 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                {t('admin.securityPage.passwordPolicy')}
              </CardTitle>
              <CardDescription className="text-xs">
                {t('admin.securityPage.passwordPolicyDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent className="divide-y divide-border-default pt-0">
              <Field label={t('admin.securityPage.minLength')}>
                <NumberInput
                  value={form.password.min_length}
                  min={6}
                  max={128}
                  unit={t('admin.securityPage.minLengthUnit')}
                  onChange={(v) => patchPassword({ min_length: v })}
                />
              </Field>
              <Field
                label={t('admin.securityPage.complexity')}
                hint={t('admin.securityPage.complexityDesc')}
              >
                <Switch
                  checked={form.password.complexity}
                  onCheckedChange={(v) => patchPassword({ complexity: v })}
                />
              </Field>
              <Field
                label={t('admin.securityPage.expireDays')}
                hint={t('admin.securityPage.expireNever')}
              >
                <NumberInput
                  value={form.password.expire_days}
                  min={0}
                  max={3650}
                  unit={t('admin.securityPage.expireDaysUnit')}
                  onChange={(v) => patchPassword({ expire_days: v })}
                />
              </Field>
            </CardContent>
          </Card>

          {/* 会话与登录安全 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                {t('admin.securityPage.sessionSecurity')}
              </CardTitle>
              <CardDescription className="text-xs">
                {t('admin.securityPage.sessionSecurityDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent className="divide-y divide-border-default pt-0">
              <Field label={t('admin.securityPage.sessionTimeout')}>
                <NumberInput
                  value={form.session.timeout_minutes}
                  min={5}
                  max={43200}
                  unit={t('admin.securityPage.minutes')}
                  onChange={(v) => patchSession({ timeout_minutes: v })}
                />
              </Field>
              <Field
                label={t('admin.securityPage.lockEnabled')}
                hint={t('admin.securityPage.lockEnabledDesc')}
              >
                <Switch
                  checked={form.login.lock_enabled}
                  onCheckedChange={(v) => patchLogin({ lock_enabled: v })}
                />
              </Field>
              <Field label={t('admin.securityPage.lockThreshold')}>
                <NumberInput
                  value={form.login.lock_threshold}
                  min={1}
                  max={100}
                  unit={t('admin.securityPage.lockThresholdUnit')}
                  disabled={lockDisabled}
                  onChange={(v) => patchLogin({ lock_threshold: v })}
                />
              </Field>
              <Field
                label={t('admin.securityPage.lockMinutes')}
                hint={t('admin.securityPage.lockHint')}
              >
                <NumberInput
                  value={form.login.lock_minutes}
                  min={1}
                  max={1440}
                  unit={t('admin.securityPage.minutes')}
                  disabled={lockDisabled}
                  onChange={(v) => patchLogin({ lock_minutes: v })}
                />
              </Field>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
