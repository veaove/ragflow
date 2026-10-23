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
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { RAGFlowPagination } from '@/components/ui/ragflow-pagination';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useQcRealtime } from '@/hooks/use-qc-request';
import {
  IQcAppOption,
  IQcConfig,
  IQcHit,
  QcAppType,
  QcScope,
  exportQcHits,
  getQcConfig,
  getQcHit,
  listQcAppOptions,
  listQcHits,
  updateQcConfig,
} from '@/services/qc-service';
import * as React from 'react';
import { toast } from 'sonner';
import { QcRulePanel } from './rule-panel';

const PAGE_SIZE = 20;

const severityLabel: Record<string, string> = {
  info: '提示',
  warn: '警告',
  block: '阻断',
};

const scopeLabel: Record<QcScope, string> = {
  ai_answer: 'AI 回答',
  user_input: '用户输入',
  both: '两者',
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

const formatTime = (ms?: number) =>
  ms ? new Date(ms).toLocaleString() : '-';

type TabKey = 'rules' | 'realtime' | 'hits' | 'config';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'rules', label: '质检规则' },
  { key: 'realtime', label: '实时质检' },
  { key: 'hits', label: '命中记录' },
  { key: 'config', label: '系统配置' },
];

export function QcManagement() {
  const [tab, setTab] = React.useState<TabKey>('rules');

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pt-8 pb-4">
        <h1 className="text-2xl font-medium text-text-primary">会话质检</h1>
        <p className="mt-1 text-sm text-text-secondary">
          配置质检规则、查看实时命中与历史记录
        </p>
      </div>
      <div className="flex items-center gap-2 border-b border-border-base px-5 pt-3">
        {TABS.map((t) => (
          <Button
            key={t.key}
            size="sm"
            variant={tab === t.key ? 'default' : 'ghost'}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </Button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'rules' && <RulesTab />}
        {tab === 'realtime' && <RealtimePanel />}
        {tab === 'hits' && <HitsPanel />}
        {tab === 'config' && <ConfigPanel />}
      </div>
    </div>
  );
}

/**
 * 质检菜单里的规则配置：规则列表是**本租户全量**（配了几条展示几条），
 * 不再按应用过滤。上方下拉只决定「新建规则时的归属应用」；
 * 规则实际对哪些应用生效，看每条规则的「查看引用」。
 */
function RulesTab() {
  const [appType, setAppType] = React.useState<QcAppType>('chat');
  const [appId, setAppId] = React.useState('');
  const [options, setOptions] = React.useState<IQcAppOption[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const list = await listQcAppOptions(appType);
        if (cancelled) return;
        setOptions(list);
        setAppId(list[0]?.id ?? '');
      } catch {
        if (!cancelled) {
          setOptions([]);
          setAppId('');
          toast.error('加载应用列表失败');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appType]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border-base px-4 py-3">
        <span className="text-sm text-text-secondary">新建归属应用：</span>
        <select
          className="h-9 rounded-md border border-border-base bg-background-content px-3 text-sm"
          value={appType}
          onChange={(e) => {
            setAppType(e.target.value as QcAppType);
            setAppId('');
          }}
        >
          <option value="chat">聊天应用</option>
          <option value="canvas">对话流 / 工作流</option>
        </select>
        <select
          className="h-9 min-w-56 rounded-md border border-border-base bg-background-content px-3 text-sm"
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
          disabled={loading || options.length === 0}
        >
          {options.length === 0 ? (
            <option value="">{loading ? '加载中…' : '暂无可用应用'}</option>
          ) : (
            options.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.name}
              </option>
            ))
          )}
        </select>
        <span className="text-xs text-text-sub-title">
          这里维护规则的归属应用；聊天/智能体的设置页可直接选用已有规则
        </span>
      </div>
      <div className="min-h-0 flex-1">
        {appId ? (
          <QcRulePanel appType={appType} appId={appId} />
        ) : (
          <Empty
            type={EmptyType.Data}
            text={
              loading
                ? '正在加载应用…'
                : '暂无可配置的应用，请先创建聊天应用或对话流'
            }
          />
        )}
      </div>
    </div>
  );
}

function RealtimePanel() {
  const [events, setEvents] = React.useState<IQcHit[]>([]);
  const { connected } = useQcRealtime((hit) => {
    setEvents((prev) => [hit, ...prev].slice(0, 200));
  });

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-2 text-sm">
        <span
          className={`inline-block size-2 rounded-full ${
            connected ? 'bg-green-500' : 'bg-gray-300'
          }`}
        />
        {connected
          ? '实时推送中'
          : '未连接（实时推送不可用，命中仍可在此页与命中记录中查看）'}
      </div>
      {events.length === 0 ? (
        <Empty type={EmptyType.Data} text="暂无实时命中事件" />
      ) : (
        <div className="flex flex-col gap-2">
          {events.map((ev) => (
            <div
              key={ev.id}
              className="rounded-lg border border-border-base bg-background-content p-3"
            >
              <div className="flex items-center gap-2 text-xs text-text-sub-title">
                <span>{formatTime(ev.create_time)}</span>
                <span
                  className={`rounded px-2 py-0.5 ${severityTone[ev.severity]}`}
                >
                  {severityLabel[ev.severity]}
                </span>
                <span className="font-medium text-text-title">
                  {ev.rule_name}
                </span>
                <span className="ml-auto">{scopeLabel[ev.scope]}</span>
              </div>
              <div className="mt-1 text-sm">
                命中：<span className="font-medium">{ev.matched_text}</span>
              </div>
              {ev.context_before && (
                <div className="mt-1 text-xs text-text-sub-title">
                  …{ev.context_before}
                  <span className="text-text-title">{ev.matched_text}</span>
                  {ev.context_after}…
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HitsPanel() {
  const [hits, setHits] = React.useState<IQcHit[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(false);
  const [severity, setSeverity] = React.useState('');
  const [scope, setScope] = React.useState('');
  const [sessionId, setSessionId] = React.useState('');
  // Committed separately from the input: reading `sessionId` directly in the
  // query's dependency list fired one request per keystroke.
  const [appliedSessionId, setAppliedSessionId] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [detail, setDetail] = React.useState<IQcHit | null>(null);

  const reload = React.useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, size: PAGE_SIZE };
      if (severity) params.severity = severity;
      if (scope) params.scope = scope;
      if (appliedSessionId) params.session_id = appliedSessionId;
      if (from) params.from = new Date(from).getTime();
      if (to) params.to = new Date(to).getTime() + 86399999;
      const response = await listQcHits(params);
      setHits(response?.data?.data ?? []);
      setTotal(response?.data?.total ?? 0);
    } catch {
      toast.error('加载命中记录失败');
    } finally {
      setLoading(false);
    }
  }, [page, severity, scope, appliedSessionId, from, to]);

  React.useEffect(() => {
    reload();
  }, [reload]);

  const applySessionFilter = () => {
    setAppliedSessionId(sessionId.trim());
    setPage(1);
  };

  const openDetail = async (hit: IQcHit) => {
    try {
      const response = await getQcHit(hit.id);
      setDetail(response?.data?.data ?? hit);
    } catch {
      setDetail(hit);
    }
  };

  const doExport = async () => {
    try {
      const params: Record<string, any> = {};
      if (severity) params.severity = severity;
      if (scope) params.scope = scope;
      if (appliedSessionId) params.session_id = appliedSessionId;
      if (from) params.from = new Date(from).getTime();
      if (to) params.to = new Date(to).getTime() + 86399999;
      const response = await exportQcHits(params);
      const blob = new Blob([response.data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'qc_hits.csv';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('已导出');
    } catch {
      toast.error('导出失败');
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          className="h-9 rounded-md border border-border-base bg-background-content px-2 text-sm"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(1);
          }}
        />
        <span className="text-text-sub-title">至</span>
        <input
          type="date"
          className="h-9 rounded-md border border-border-base bg-background-content px-2 text-sm"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(1);
          }}
        />
        <select
          className="h-9 rounded-md border border-border-base bg-background-content px-2 text-sm"
          value={severity}
          onChange={(e) => {
            setSeverity(e.target.value);
            setPage(1);
          }}
        >
          <option value="">严重级：全部</option>
          <option value="info">提示</option>
          <option value="warn">警告</option>
          <option value="block">阻断</option>
        </select>
        <select
          className="h-9 rounded-md border border-border-base bg-background-content px-2 text-sm"
          value={scope}
          onChange={(e) => {
            setScope(e.target.value);
            setPage(1);
          }}
        >
          <option value="">范围：全部</option>
          <option value="ai_answer">AI 回答</option>
          <option value="user_input">用户输入</option>
        </select>
        <Input
          className="h-9 w-52"
          placeholder="会话 ID，回车查询"
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applySessionFilter();
          }}
        />
        <Button size="sm" variant="outline" onClick={applySessionFilter}>
          查询
        </Button>
        <Button size="sm" onClick={doExport}>
          导出 CSV
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border-base">
        {hits.length === 0 && !loading ? (
          <Empty type={EmptyType.Data} text="暂无命中记录" />
        ) : (
          <Table>
            <TableHeader className="bg-background-second">
              <TableRow>
                <TableHead className="h-10 text-text-title">时间</TableHead>
                <TableHead className="h-10 text-text-title">应用</TableHead>
                <TableHead className="h-10 text-text-title">会话</TableHead>
                <TableHead className="h-10 text-text-title">规则</TableHead>
                <TableHead className="h-10 text-text-title">命中文本</TableHead>
                <TableHead className="h-10 text-text-title">范围</TableHead>
                <TableHead className="h-10 text-text-title">严重级</TableHead>
                <TableHead className="h-10 text-text-title">动作</TableHead>
                <TableHead className="h-10 w-16 text-text-secondary">
                  操作
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {hits.map((hit) => (
                <TableRow key={hit.id}>
                  <TableCell className="whitespace-nowrap text-text-secondary">
                    {formatTime(hit.create_time)}
                  </TableCell>
                  <TableCell className="max-w-[160px] truncate text-text-title">
                    {hit.app_name || (
                      <span className="font-mono text-xs text-text-secondary">
                        {hit.app_id}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate font-mono text-xs text-text-secondary">
                    {hit.session_id}
                  </TableCell>
                  <TableCell className="text-text-title">
                    {hit.rule_name}
                  </TableCell>
                  <TableCell className="max-w-md truncate">
                    {hit.matched_text}
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    {scopeLabel[hit.scope]}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        severityTone[hit.severity]
                      }`}
                    >
                      {severityLabel[hit.severity]}
                    </span>
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    {actionLabel[hit.action_taken]}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="link"
                      onClick={() => openDetail(hit)}
                    >
                      详情
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {total > PAGE_SIZE && (
        <RAGFlowPagination
          current={page}
          pageSize={PAGE_SIZE}
          total={total}
          onChange={(next) => setPage(next)}
        />
      )}

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>命中详情</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="flex flex-col gap-2 text-sm">
              <Row label="规则" value={detail.rule_name} />
              <Row
                label="严重级"
                value={severityLabel[detail.severity]}
              />
              <Row label="动作" value={actionLabel[detail.action_taken]} />
              <Row label="范围" value={scopeLabel[detail.scope]} />
              <Row label="会话" value={detail.session_id} mono />
              <Row label="时间" value={formatTime(detail.create_time)} />
              <div>
                <div className="text-xs text-text-sub-title">命中文本</div>
                <div className="rounded bg-background-second px-2 py-1">
                  {detail.matched_text}
                </div>
              </div>
              {detail.context_before !== undefined && (
                <div>
                  <div className="text-xs text-text-sub-title">上下文</div>
                  <div className="rounded bg-background-second px-2 py-1 text-text-secondary">
                    …{detail.context_before}
                    <span className="text-text-title">
                      {detail.matched_text}
                    </span>
                    {detail.context_after}…
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <span className="w-16 shrink-0 text-text-sub-title">{label}</span>
      <span className={mono ? 'font-mono text-xs' : ''}>{value}</span>
    </div>
  );
}

function ConfigPanel() {
  const [config, setConfig] = React.useState<IQcConfig | null>(null);
  const [draft, setDraft] = React.useState<IQcConfig | null>(null);

  React.useEffect(() => {
    (async () => {
      try {
        const response = await getQcConfig();
        const cfg = response?.data?.data as IQcConfig;
        setConfig(cfg);
        setDraft(cfg);
      } catch {
        toast.error('加载质检配置失败');
      }
    })();
  }, []);

  const save = async () => {
    if (!draft) return;
    try {
      await updateQcConfig({
        enabled: draft.enabled,
        max_rules_per_tenant: draft.max_rules_per_tenant,
        retention_days: draft.retention_days,
      });
      setConfig(draft);
      toast.success('配置已保存');
    } catch {
      toast.error('保存失败');
    }
  };

  if (!draft) {
    return (
      <div className="p-4">
        <Empty type={EmptyType.Data} text="加载中…" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl p-6">
      <div className="flex flex-col gap-4 rounded-lg border border-border-base bg-background-content p-4">
        <label className="flex items-center justify-between">
          <span className="text-sm">质检总开关</span>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) =>
              setDraft({ ...draft, enabled: e.target.checked })
            }
          />
        </label>
        <div>
          <label className="mb-1 block text-sm text-text-secondary">
            单租户规则上限
          </label>
          <Input
            type="number"
            value={draft.max_rules_per_tenant}
            onChange={(e) =>
              setDraft({
                ...draft,
                max_rules_per_tenant: Number(e.target.value),
              })
            }
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-text-secondary">
            命中记录保留期（天）
          </label>
          <Input
            type="number"
            value={draft.retention_days}
            onChange={(e) =>
              setDraft({ ...draft, retention_days: Number(e.target.value) })
            }
          />
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={save}>
            保存
          </Button>
        </div>
      </div>
      <p className="mt-3 text-xs text-text-sub-title">
        提示：配置变更仅租户管理员可见并生效。{config ? '当前已加载。' : ''}
      </p>
    </div>
  );
}

export default QcManagement;
