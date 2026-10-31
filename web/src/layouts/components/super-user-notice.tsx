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

import { Button } from '@/components/ui/button';
import { Routes } from '@/routes';
import { LucideShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

/**
 * 平台超级管理员登录业务主站时的整页说明。
 *
 * 后端对 `is_superuser = 1` 的账号统一拒绝主站接口（只放行 `/admin`），
 * 所以这里任何页面都拿不到数据。以前表现为「侧栏空 + 永远转圈的加载权限…」，
 * 用户看到的就是「登录后一个页面都没有」。与其让人以为系统坏了，不如直接说清楚
 * 并给出去控制台的入口。
 */
const SuperUserNotice = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-lg rounded-xl border border-border-default bg-bg-card px-8 py-10 text-center">
        <LucideShieldAlert className="mx-auto mb-5 size-12 text-state-warning" />
        <h1 className="mb-3 text-lg font-semibold text-text-primary">
          {t('common.superUserTitle')}
        </h1>
        <p className="mb-8 text-sm leading-6 text-text-secondary">
          {t('common.superUserDesc')}
        </p>
        <div className="flex justify-center gap-3">
          <Button onClick={() => navigate(Routes.Admin)}>
            {t('common.superUserGoConsole')}
          </Button>
          <Button variant="outline" onClick={() => navigate(Routes.Logout)}>
            {t('common.superUserLogout')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default SuperUserNotice;
