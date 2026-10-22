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

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useFetchTenantInfo } from '@/hooks/use-user-setting-request';
import {
  addMemberDirect,
  findCandidateUser,
  ICandidateUser,
} from '@/services/user-service';

type CandidateStatus = ICandidateUser['status'];

/**
 * AddExistingMemberModal adds an already-registered user to the team without
 * sending an invitation.
 *
 * The lookup is exact-email only. That is a deliberate product decision, not a
 * limitation: a fuzzy match would let any tenant owner enumerate other tenants'
 * users. The dialog therefore never offers a list, and only queries on an
 * explicit submit.
 */
export default function AddExistingMemberModal({
  visible,
  hideModal,
  onAdded,
}: {
  visible: boolean;
  hideModal: () => void;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const { data: tenantInfo } = useFetchTenantInfo();

  const [email, setEmail] = useState('');
  const [result, setResult] = useState<ICandidateUser | null>(null);
  const [role, setRole] = useState<'normal' | 'admin'>('normal');
  const [querying, setQuerying] = useState(false);
  const [adding, setAdding] = useState(false);

  // Reset every time the dialog opens so a previous lookup never leaks in.
  useEffect(() => {
    if (visible) {
      setEmail('');
      setResult(null);
      setRole('normal');
    }
  }, [visible]);

  const onQuery = useCallback(async () => {
    const value = email.trim();
    if (!value || !tenantInfo?.tenant_id) return;
    setQuerying(true);
    try {
      const res = await findCandidateUser(tenantInfo.tenant_id, value);
      setResult(res?.data?.data ?? null);
    } finally {
      setQuerying(false);
    }
  }, [email, tenantInfo?.tenant_id]);

  const onAdd = useCallback(async () => {
    const value = email.trim();
    if (!value || !tenantInfo?.tenant_id) return;
    setAdding(true);
    try {
      await addMemberDirect(tenantInfo.tenant_id, value, role);
      onAdded();
      hideModal();
    } finally {
      setAdding(false);
    }
  }, [email, role, tenantInfo?.tenant_id, onAdded, hideModal]);

  // One message per backend status; the "addable" case renders the action row
  // instead of a message.
  const statusMessage = (status: CandidateStatus): string => {
    switch (status) {
      case 'member':
        return t('setting.candidateMember');
      case 'invited':
        return t('setting.candidateInvited');
      case 'owner':
        return t('setting.candidateOwner');
      case 'not_found':
        return t('setting.candidateNotFound');
      default:
        return '';
    }
  };

  const statusTone = (status: CandidateStatus): string => {
    switch (status) {
      case 'addable':
        return 'text-state-success';
      case 'not_found':
        return 'text-text-secondary';
      default:
        return 'text-state-warning';
    }
  };

  return (
    <Dialog open={visible} onOpenChange={(open) => !open && hideModal()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('setting.addExistingMember')}</DialogTitle>
        </DialogHeader>

        <p className="-mt-1 text-xs text-text-secondary">
          {t('setting.addExistingMemberHint')}
        </p>

        <div className="flex items-center gap-2">
          <Input
            value={email}
            placeholder="name@company.com"
            onChange={(e) => {
              setEmail(e.target.value);
              // A stale result next to a changed address is worse than none.
              setResult(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void onQuery();
              }
            }}
            data-testid="candidate-email-input"
          />
          <Button
            variant="outline"
            onClick={() => void onQuery()}
            disabled={!email.trim() || querying}
            data-testid="candidate-query-btn"
          >
            {querying ? '…' : t('setting.queryCandidate')}
          </Button>
        </div>

        {result && (
          <div
            className="rounded-lg border border-border-default p-3"
            data-testid={`candidate-result-${result.status}`}
          >
            {result.status === 'addable' ? (
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm text-text-primary">
                    {result.nickname_masked || '-'}
                  </div>
                  <div className="truncate text-xs text-text-secondary">
                    {result.email_masked}
                  </div>
                </div>
                <span className="flex-1" />
                <select
                  className="h-8 rounded-md border border-border-default bg-bg-base px-2 text-sm"
                  value={role}
                  onChange={(e) =>
                    setRole(e.target.value as 'normal' | 'admin')
                  }
                  data-testid="candidate-role-select"
                >
                  <option value="normal">{t('setting.roleNormal')}</option>
                  <option value="admin">{t('setting.roleAdmin')}</option>
                </select>
                <Button
                  onClick={() => void onAdd()}
                  disabled={adding}
                  data-testid="candidate-add-btn"
                >
                  {adding ? '…' : t('setting.addNow')}
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className={statusTone(result.status)}>
                  {statusMessage(result.status)}
                </span>
                {result.status === 'not_found' && (
                  <>
                    <span className="flex-1" />
                    <span className="text-xs text-text-secondary">
                      {t('setting.candidateNotFoundHint')}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="outline" onClick={hideModal}>
            {t('common.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
