import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useId, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { listRoles, listTenants } from '@/services/admin-service';

import EnterpriseFeature from '../components/enterprise-feature';
import { IS_ENTERPRISE } from '../utils';

interface CreateUserFormData {
  email: string;
  nickname: string;
  password: string;
  confirmPassword: string;
  role?: string;
  /** 所属租户，必选 —— 用户与租户解耦后建号时就要确定归属。 */
  tenantId: string;
}

interface CreateUserFormProps {
  id: string;
  form: ReturnType<typeof useForm<CreateUserFormData>>;
  onSubmit?: (data: CreateUserFormData) => void;
}

export const CreateUserForm = ({
  id,
  form,
  onSubmit = () => {},
}: CreateUserFormProps) => {
  const { t } = useTranslation();

  const { data: tenantList } = useQuery({
    queryKey: ['admin/tenants-all'],
    queryFn: async () => {
      const { data } = await listTenants({ page: 1, page_size: 100 });
      return data?.data?.list ?? [];
    },
  });

  const { data: roleList } = useQuery({
    queryKey: ['admin/listRoles'],
    queryFn: async () => (await listRoles()).data.data.roles,
    enabled: IS_ENTERPRISE,
    retry: false,
  });

  return (
    <Form {...form}>
      <form
        id={id}
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-6"
      >
        {/* Email field (editable) */}
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-medium">
                {t('admin.email')}
              </FormLabel>
              <FormControl>
                <Input
                  placeholder={t('admin.email')}
                  autoComplete="username"
                  className="mt-2 px-3 h-10 bg-bg-input border-border-button"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Nickname field */}
        <FormField
          control={form.control}
          name="nickname"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-medium">
                昵称 <span className="text-text-disabled">（可选，默认同邮箱）</span>
              </FormLabel>
              <FormControl>
                <Input
                  placeholder="显示昵称"
                  className="mt-2 px-3 h-10 bg-bg-input border-border-button"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Password field */}
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-medium">
                {t('admin.password')}
              </FormLabel>
              <FormControl>
                <Input
                  type="password"
                  placeholder={t('admin.password')}
                  autoComplete="new-password"
                  className="mt-2 px-3 h-10 bg-bg-input border-border-button"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Confirm password field */}
        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-medium">
                {t('admin.confirmPassword')}
              </FormLabel>
              <FormControl>
                <Input
                  type="password"
                  placeholder={t('admin.confirmPassword')}
                  autoComplete="new-password"
                  className="mt-2 px-3 h-10 bg-bg-input border-border-button"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="tenantId"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-medium">
                所属租户 <span className="text-text-disabled">（可选）</span>
              </FormLabel>
              <FormControl>
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger className="w-full h-10">
                    <SelectValue placeholder="请选择租户（可留空）" />
                  </SelectTrigger>
                  <SelectContent className="bg-bg-base">
                    <SelectItem value="__empty__">— 不分配 —</SelectItem>
                    {tenantList?.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    )) ?? (
                      <div className="text-text-secondary px-2 py-6 text-sm text-center">
                        暂无租户，请先在「租户管理」创建
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </FormControl>
              <FormMessage />
              <p className="text-xs text-text-secondary">
                用户创建后归属该租户，角色为普通成员；超管请在「租户管理」里单独设置。
              </p>
            </FormItem>
          )}
        />

        <EnterpriseFeature>
          {/* Role field */}
          {() => (
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium">
                    {t('admin.role')}
                  </FormLabel>
                  <FormControl>
                    <Select {...field}>
                      <SelectTrigger className="w-full h-10">
                        <SelectValue />
                      </SelectTrigger>

                      <SelectContent className="bg-bg-base">
                        <SelectGroup>
                          {roleList?.map((role) => (
                            <SelectItem key={role.id} value={role.role_name}>
                              {role.role_name}
                            </SelectItem>
                          )) ?? (
                            <div className="text-text-secondary px-2 py-6 text-sm text-center">
                              {t('common.noData')}
                            </div>
                          )}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </FormControl>
                </FormItem>
              )}
            />
          )}
        </EnterpriseFeature>
      </form>
    </Form>
  );
};

// Export the form validation state for parent component
function useCreateUserForm(props?: {
  defaultValues: Partial<CreateUserFormData>;
}) {
  const { t } = useTranslation();
  const id = useId();

  const schema = useMemo(() => {
    return z
      .object({
        email: z.string().email({ message: t('admin.invalidEmail') }),
        nickname: z.string().optional(),
        password: z.string().min(6, { message: t('admin.passwordMinLength') }),
        confirmPassword: z
          .string()
          .min(1, { message: t('admin.confirmPasswordRequired') }),
        role: z.string().optional(),
        tenantId: z.string().optional(),
      })
      .refine((data) => data.password === data.confirmPassword, {
        message: t('admin.confirmPasswordDoNotMatch'),
        path: ['confirmPassword'],
      });
  }, [t]);

  const form = useForm<CreateUserFormData>({
    defaultValues: {
      email: '',
      nickname: '',
      password: '',
      confirmPassword: '',
      tenantId: '',
      ...(props?.defaultValues ?? {}),
    },
    resolver: zodResolver(schema),
  });

  const FormComponent = useCallback(
    (props: Partial<CreateUserFormProps>) => (
      <CreateUserForm id={id} form={form} {...props} />
    ),
    [id, form],
  );

  return {
    schema,
    id,
    form,
    FormComponent,
  };
}

export default useCreateUserForm;
