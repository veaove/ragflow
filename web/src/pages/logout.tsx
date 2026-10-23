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

import userService from '@/services/user-service';
import authorizationUtil, { redirectToLogin } from '@/utils/authorization-util';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The header menu and external links both point at `/logout`, so it has to be
 * a real route instead of falling through to the 404 page. Opening the URL
 * directly must end the session too, which is why this page clears the stored
 * credentials itself rather than relying on a navigation side effect.
 *
 * The server call only invalidates the token server-side. It must never trap
 * the user here, so the redirect fires on whichever comes first: the request
 * settling, or the timeout below.
 */
const LOGOUT_TIMEOUT_MS = 1500;

const LogoutPage = () => {
  const { t } = useTranslation();
  const finishedRef = useRef(false);

  useEffect(() => {
    const finish = () => {
      if (finishedRef.current) {
        return;
      }
      finishedRef.current = true;
      authorizationUtil.removeAll();
      redirectToLogin();
    };

    // A slow or unreachable backend must not block signing out locally.
    const timer = window.setTimeout(finish, LOGOUT_TIMEOUT_MS);
    Promise.resolve()
      .then(() => userService.logout())
      .catch(() => undefined)
      .then(finish);

    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <Loader2 className="h-8 w-8 animate-spin text-text-secondary" />
      <div className="text-sm text-text-secondary">{t('common.loggingOut')}</div>
    </div>
  );
};

export default LogoutPage;
