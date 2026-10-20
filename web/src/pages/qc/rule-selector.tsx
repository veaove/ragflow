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

import Empty from '@/components/empty/empty';
import { EmptyType } from '@/components/empty/constant';
import { Routes } from '@/routes';
import {
  IQcRuleSelection,
  QcAppType,
  QcScope,
  getQcRuleSelection,
  updateQcRuleSelection,
} from '@/services/qc-service';
import { cn } from '@/lib/utils';
import { ExternalLink } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { toast } from 'sonner';

const matchModeLabel: Record<string, string> = {
  contains: '包含',
  whole_word: '全词',
  regex: '正则',
};

const scopeLabel: Record<QcScope, string> = {
  ai_answer: 'AI 回答',
  user_input: '用户输入',
  both: '两者',
};

const severityLabel: Record<string, string> = {
  info: '提示',
  warn: '警告',
  block: '阻断',
};

const actionLabel: Record<string, string> = {
  log: '仅记录',
  log_and_alert: '记录并告警',
  block_and_alert: '拦截并告警',
};

const severityTone: Record<string, string> = {
  info: 'bg-accent-primary/10 text-accent-primary',
  warn: 'bg-orange-100 text-orange-600',
  block: 'bg-red-100 text-red-600',
};

/**
 * QcRuleSelector 是应用设置页里的质检区块。
 *
 * 这里**不创建规则** —— 规则统一在「质检」菜单里维护，应用侧只做「选用」：
 * 勾选即引用该规则，取消勾选即解除引用，改动立即生效（不进聊天设置的表单，
 * 因为规则选择与会话业务字段是两件事，混在一个保存按钮里容易被取消按钮吞掉）。
 *
 * 规则本身归属某个应用（home）；本应用创建的规则恒生效，不可取消，
 * 面板上以「本应用创建」标记，其余规则都可自由勾选。
 */
export function QcRuleSelector({
  appType,
  appId,
  className,
}: {
  appType: QcAppType;
  appId: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const [rules, setRules] = React.useState<IQcRuleSelection[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const reload = React.useCallback(async () => {
    if (!appId) {
      setRules([]);
      return;
    }
    setLoading(true);
    try {
      const response = await getQcRuleSelection({
        app_type: appType,
        app_id: appId,
      });
      setRules(response?.data?.data ?? []);
    } catch {
      setRules([]);
      toast.error('加载质检规则失败');
    } finally {
      setLoading(false);
    }
  }, [appType, appId]);

  React.useEffect(() => {
    reload();
  }, [reload]);

  const toggle = async (rule: IQcRuleSelection) => {
    if (rule.home || saving) return;

    const next = rules.map((x) =>
      x.id === rule.id ? { ...x, selected: !x.selected } : x,
    );
    const ruleIds = next.filter((x) => x.selected).map((x) => x.id);

    // Optimistic: the checkbox must respond immediately. Reverting on failure
    // keeps the UI honest when the request is rejected.
    setRules(next);
    setSaving(true);
    try {
      const response = await updateQcRuleSelection({
        app_type: appType,
        app_id: appId,
        rule_ids: ruleIds,
      });
      if (response?.data?.code !== 0) {
        throw new Error(response?.data?.message);
      }
    } catch {
      setRules(rules);
      toast.error('保存质检规则失败');
    } finally {
      setSaving(false);
    }
  };

  const selectedCount = rules.filter((x) => x.selected).length;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-text-secondary">
          {t('chat.qcRulesHint')}
          {rules.length > 0 && (
            <span className="ml-2 text-text-sub-title">
              {t('chat.qcRulesSelectedCount', { selected: selectedCount })}
            </span>
          )}
        </div>
        <Link
          to={Routes.Qc}
          className="inline-flex shrink-0 items-center gap-1 text-xs text-accent-primary hover:underline"
        >
          {t('chat.qcRulesManage')}
          <ExternalLink className="size-3" />
        </Link>
      </div>

      {rules.length === 0 ? (
        <div className="rounded-lg border border-border-base">
          <Empty
            type={EmptyType.Data}
            text={loading ? t('chat.qcRulesLoading') : t('chat.qcRulesEmpty')}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rules.map((rule) => {
            const locked = rule.home;
            return (
              <label
                key={rule.id}
                className={cn(
                  'flex items-start gap-3 rounded-lg border p-3 transition-colors',
                  rule.selected
                    ? 'border-accent-primary/40 bg-accent-primary/5'
                    : 'border-border-base',
                  locked || saving
                    ? 'cursor-default'
                    : 'cursor-pointer hover:border-accent-primary/40',
                )}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-current"
                  checked={rule.selected}
                  disabled={locked || saving}
                  onChange={() => toggle(rule)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-text-title">
                      {rule.name}
                    </span>
                    {locked && (
                      <span className="shrink-0 rounded bg-background-second px-1.5 py-0.5 text-xs text-text-sub-title">
                        {t('chat.qcRuleHomeTag')}
                      </span>
                    )}
                    {!rule.enabled && (
                      <span className="shrink-0 rounded bg-background-second px-1.5 py-0.5 text-xs text-text-sub-title">
                        {t('chat.qcRuleDisabledTag')}
                      </span>
                    )}
                    <span
                      className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 text-xs',
                        severityTone[rule.severity],
                      )}
                    >
                      {severityLabel[rule.severity]}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {rule.keywords.slice(0, 4).map((kw) => (
                      <span
                        key={kw}
                        className="rounded bg-background-second px-1.5 py-0.5 text-xs text-text-secondary"
                      >
                        {kw}
                      </span>
                    ))}
                    {rule.keywords.length > 4 && (
                      <span className="text-xs text-text-sub-title">
                        +{rule.keywords.length - 4}
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-text-secondary">
                    <span>{matchModeLabel[rule.match_mode]}</span>
                    <span>·</span>
                    <span>{scopeLabel[rule.scope]}</span>
                    <span>·</span>
                    <span>{actionLabel[rule.action]}</span>
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default QcRuleSelector;
