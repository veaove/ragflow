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
  DialogFooter,
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
import { Textarea } from '@/components/ui/textarea';
import {
  IQcRule,
  IQcRulePayload,
  IQcTestResult,
  QcAppType,
  QcMatchMode,
  QcScope,
  createQcRule,
  deleteQcRule,
  listQcRules,
  testQcRule,
  toggleQcRule,
  updateQcRule,
} from '@/services/qc-service';
import * as React from 'react';
import { toast } from 'sonner';

const PAGE_SIZE = 10;

const matchModeLabel: Record<QcMatchMode, string> = {
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

/** 严重级与动作在 PRD 里是耦合的三档，用一个选择器表达。 */
const severityActionOptions: {
  severity: IQcRule['severity'];
  action: IQcRule['action'];
  label: string;
  desc: string;
}[] = [
  {
    severity: 'info',
    action: 'log',
    label: '提示 · 仅记录',
    desc: '命中后写入记录，不影响对话',
  },
  {
    severity: 'warn',
    action: 'log_and_alert',
    label: '警告 · 记录并告警',
    desc: '写入记录并实时推送告警，不影响对话',
  },
  {
    severity: 'block',
    action: 'block_and_alert',
    label: '阻断 · 拦截并告警',
    desc: '命中后该回答不返回用户，替换为提示信息',
  },
];

interface EditorState {
  id: string | null;
  name: string;
  keywordsText: string;
  matchMode: QcMatchMode;
  scope: QcScope;
  actionIndex: number;
  promptMessage: string;
  enabled: boolean;
  testText: string;
}

// Defaults for a brand-new rule. The scope default is `both` on purpose: most
// rules are written with the words a user would SAY (「基金怎么买」), while a
// `ai_answer`-only rule is only ever matched against the AI's reply — which
// does not contain the question itself, so the rule silently never fires while
// the app settings still list it as 「生效」. `both` matches either side, so the
// common case works out of the box; narrow it to `ai_answer` deliberately.
const emptyEditor = (): EditorState => ({
  id: null,
  name: '',
  keywordsText: '',
  matchMode: 'contains',
  scope: 'both',
  actionIndex: 1,
  promptMessage: '',
  enabled: true,
  testText: '',
});

/**
 * Splits the keyword textarea into keywords.
 *
 * Regex mode splits on newlines only: a comma is legal inside a quantifier
 * (`{2,3}`) or a character class, so splitting on it would silently shred a
 * valid pattern into pieces that no longer compile.
 */
const parseKeywords = (text: string, matchMode: QcMatchMode): string[] => {
  const separator = matchMode === 'regex' ? /\n/ : /[\n,，]/;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(separator)) {
    const kw = raw.trim();
    if (kw && !seen.has(kw)) {
      seen.add(kw);
      out.push(kw);
    }
  }
  return out;
};

const severityTone: Record<string, string> = {
  info: 'bg-accent-primary/10 text-accent-primary',
  warn: 'bg-orange-100 text-orange-600',
  block: 'bg-red-100 text-red-600',
};

/**
 * QcRulePanel 是「质检」菜单里的规则维护面板：规则的增删改、启停、实时测试
 * 都在这里完成。规则归属某一个聊天应用或对话流（home app）。
 *
 * 应用设置页里**不再**嵌这个面板 —— 那里只做「选用」已有规则，
 * 见 `rule-selector.tsx` 的 QcRuleSelector。
 */
export function QcRulePanel({
  appType,
  appId,
}: {
  appType: QcAppType;
  appId: string;
}) {
  const [rules, setRules] = React.useState<IQcRule[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(false);
  const [editor, setEditor] = React.useState<EditorState | null>(null);

  // Switching apps invalidates the page offset: keeping page 3 after selecting
  // an app with one page of rules would render an empty list with no way back.
  React.useEffect(() => {
    setPage(1);
  }, [appType, appId]);

  const reload = React.useCallback(async () => {
    if (!appId) return;
    setLoading(true);
    try {
      const response = await listQcRules({
        app_type: appType,
        app_id: appId,
        page,
        size: PAGE_SIZE,
      });
      setRules(response?.data?.data ?? []);
      setTotal(response?.data?.total ?? 0);
    } catch {
      toast.error('加载质检规则失败');
    } finally {
      setLoading(false);
    }
  }, [appType, appId, page]);

  React.useEffect(() => {
    reload();
  }, [reload]);

  const openCreate = () => setEditor(emptyEditor());

  const openEdit = (rule: IQcRule) => {
    const optIndex = severityActionOptions.findIndex(
      (o) => o.severity === rule.severity && o.action === rule.action,
    );
    setEditor({
      id: rule.id,
      name: rule.name,
      keywordsText: rule.keywords.join('\n'),
      matchMode: rule.match_mode,
      scope: rule.scope,
      actionIndex: optIndex >= 0 ? optIndex : 1,
      promptMessage: rule.prompt_message,
      enabled: rule.enabled,
      testText: '',
    });
  };

  const save = async (state: EditorState) => {
    const name = state.name.trim();
    if (!name) {
      toast.error('请填写规则名称');
      return;
    }
    const keywords = parseKeywords(state.keywordsText, state.matchMode);
    if (keywords.length === 0) {
      toast.error('请至少添加一个关键词');
      return;
    }
    if (!state.promptMessage.trim()) {
      toast.error('请填写提示信息');
      return;
    }
    const opt = severityActionOptions[state.actionIndex];
    const payload: IQcRulePayload = {
      app_type: appType,
      app_id: appId,
      name,
      keywords,
      match_mode: state.matchMode,
      scope: state.scope,
      severity: opt.severity,
      action: opt.action,
      prompt_message: state.promptMessage.trim(),
      enabled: state.enabled,
    };
    try {
      if (state.id) {
        await updateQcRule(state.id, payload);
        toast.success('规则已更新，立即生效');
      } else {
        await createQcRule(payload);
        toast.success('规则已创建');
      }
      setEditor(null);
      reload();
    } catch {
      toast.error('保存失败');
    }
  };

  const remove = async (rule: IQcRule) => {
    if (!window.confirm(`确认删除规则「${rule.name}」？历史命中记录仍会保留。`))
      return;
    try {
      await deleteQcRule(rule.id);
      toast.success('规则已删除');
      reload();
    } catch {
      toast.error('删除失败');
    }
  };

  const toggle = async (rule: IQcRule) => {
    try {
      await toggleQcRule(rule.id, !rule.enabled);
      reload();
    } catch {
      toast.error('操作失败');
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-text-secondary">
          规则归属当前应用｜共 {total} 条。新建的规则自动在归属应用生效，其他应用可在自己的设置页勾选选用
        </div>
        <Button size="sm" onClick={openCreate}>
          新建规则
        </Button>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-border-base">
        {rules.length === 0 && !loading ? (
          <Empty type={EmptyType.Data} text="本应用还没有质检规则" />
        ) : (
          <Table>
              <TableHeader className="bg-background-second">
                <TableRow>
                  <TableHead className="h-10 text-text-title">规则名称</TableHead>
                  <TableHead className="h-10 text-text-title">
                    触发关键词
                  </TableHead>
                  <TableHead className="h-10 text-text-title">匹配</TableHead>
                  <TableHead className="h-10 text-text-title">范围</TableHead>
                  <TableHead className="h-10 text-text-title">严重级</TableHead>
                  <TableHead className="h-10 text-text-title">动作</TableHead>
                  <TableHead className="h-10 text-text-title">状态</TableHead>
                  <TableHead className="h-10 w-40 text-text-secondary">
                    操作
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium text-text-title">
                      {rule.name}
                    </TableCell>
                    <TableCell className="max-w-md">
                      <div className="flex flex-wrap gap-1">
                        {rule.keywords.slice(0, 3).map((kw) => (
                          <span
                            key={kw}
                            className="rounded bg-background-second px-1.5 py-0.5 text-xs text-text-secondary"
                          >
                            {kw}
                          </span>
                        ))}
                        {rule.keywords.length > 3 && (
                          <span className="text-xs text-text-sub-title">
                            +{rule.keywords.length - 3}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {matchModeLabel[rule.match_mode]}
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {scopeLabel[rule.scope]}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${
                          severityTone[rule.severity]
                        }`}
                      >
                        {severityLabel[rule.severity]}
                      </span>
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {actionLabel[rule.action]}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${
                          rule.enabled
                            ? 'bg-green-100 text-green-600'
                            : 'bg-background-second text-text-sub-title'
                        }`}
                      >
                        {rule.enabled ? '启用' : '停用'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="link"
                          onClick={() => openEdit(rule)}
                        >
                          编辑
                        </Button>
                        <Button
                          size="sm"
                          variant="link"
                          onClick={() => toggle(rule)}
                        >
                          {rule.enabled ? '停用' : '启用'}
                        </Button>
                        <Button
                          size="sm"
                          variant="link"
                          className="text-red-500"
                          onClick={() => remove(rule)}
                        >
                          删除
                        </Button>
                      </div>
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

      <RuleEditor
        state={editor}
        onClose={() => setEditor(null)}
        onSave={save}
      />
    </div>
  );
}

function RuleEditor({
  state,
  onClose,
  onSave,
}: {
  state: EditorState | null;
  onClose: () => void;
  onSave: (state: EditorState) => void;
}) {
  const [draft, setDraft] = React.useState<EditorState | null>(state);
  const [testResult, setTestResult] = React.useState<IQcTestResult | null>(
    null,
  );

  React.useEffect(() => {
    setDraft(state);
    setTestResult(null);
  }, [state]);

  // Debounced live preview. It used to run on blur only, which contradicted the
  // "输入后自动预览" hint and silently skipped the last edit when the user hit
  // 保存 straight from the textarea.
  const testText = draft?.testText ?? '';
  const keywordsText = draft?.keywordsText ?? '';
  const matchMode: QcMatchMode = draft?.matchMode ?? 'contains';

  React.useEffect(() => {
    const keywords = parseKeywords(keywordsText, matchMode);
    if (keywords.length === 0 || !testText.trim()) {
      setTestResult(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const response = await testQcRule({
          keywords,
          match_mode: matchMode,
          text: testText,
        });
        if (!cancelled) setTestResult(response?.data?.data ?? null);
      } catch {
        if (!cancelled) setTestResult(null);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [testText, keywordsText, matchMode]);

  const highlighted = React.useMemo(() => {
    if (!draft || !testResult) return null;
    // Prefer the per-occurrence ranges: `hits` only carries the first
    // occurrence of each keyword, so highlighting from it would miss repeats.
    const raw = testResult.ranges?.length
      ? testResult.ranges
      : testResult.hits
          .filter((h) => h.end > h.start)
          .map((h) => ({ start: h.start, end: h.end }));
    const spans = [...raw].sort((a, b) => a.start - b.start);
    if (spans.length === 0) return null;
    const runes = Array.from(draft.testText);
    const nodes: React.ReactNode[] = [];
    let prev = 0;
    spans.forEach((h, i) => {
      if (h.start < prev) return;
      if (h.start > prev) {
        nodes.push(runes.slice(prev, h.start).join(''));
      }
      nodes.push(
        <mark key={i} className="rounded bg-yellow-200 px-0.5 text-yellow-800">
          {runes.slice(h.start, h.end).join('')}
        </mark>,
      );
      prev = h.end;
    });
    nodes.push(runes.slice(prev).join(''));
    return nodes;
  }, [draft, testResult]);

  return (
    <Dialog open={!!state} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {state?.id ? '编辑质检规则' : '新建质检规则'}
          </DialogTitle>
        </DialogHeader>

        {draft && (
          <div className="flex max-h-[70vh] flex-col gap-4 overflow-auto">
            <div>
              <label className="mb-1 block text-sm text-text-secondary">
                规则名称 *
              </label>
              <Input
                value={draft.name}
                placeholder="如：禁止承诺收益"
                maxLength={50}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm text-text-secondary">
                {draft.matchMode === 'regex'
                  ? '正则表达式 *（每行一个，最多 50 个）'
                  : '触发关键词 *（每行一个，或逗号分隔，最多 50 个）'}
              </label>
              <Textarea
                rows={4}
                value={draft.keywordsText}
                placeholder={'保本\n稳赚\n零风险'}
                onChange={(e) =>
                  setDraft({ ...draft, keywordsText: e.target.value })
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm text-text-secondary">
                  匹配模式
                </label>
                <select
                  className="h-10 w-full rounded-md border border-border-base bg-background-content px-3 text-sm"
                  value={draft.matchMode}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      matchMode: e.target.value as QcMatchMode,
                    })
                  }
                >
                  <option value="contains">包含</option>
                  <option value="whole_word">全词</option>
                  <option value="regex">正则</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm text-text-secondary">
                  作用范围
                </label>
                <select
                  className="h-10 w-full rounded-md border border-border-base bg-background-content px-3 text-sm"
                  value={draft.scope}
                  onChange={(e) =>
                    setDraft({ ...draft, scope: e.target.value as QcScope })
                  }
                >
                  <option value="ai_answer">AI 回答</option>
                  <option value="user_input">用户输入</option>
                  <option value="both">两者</option>
                </select>
                <p className="mt-1 text-xs text-text-sub-title">
                  选「AI 回答」时只在回复里找关键词，用户说的话不参与
                  —— 所以问句类关键词（如「基金怎么买」）不会命中。
                </p>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm text-text-secondary">
                严重级与动作 *
              </label>
              <div className="flex flex-col gap-2">
                {severityActionOptions.map((opt, i) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setDraft({ ...draft, actionIndex: i })}
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      draft.actionIndex === i
                        ? 'border-accent-primary bg-accent-primary/5'
                        : 'border-border-base'
                    }`}
                  >
                    <span className="font-medium">{opt.label}</span>
                    <span className="ml-2 text-xs text-text-sub-title">
                      {opt.desc}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm text-text-secondary">
                提示信息 *（阻断级同时作为替代话术返回用户）
              </label>
              <Textarea
                rows={3}
                value={draft.promptMessage}
                maxLength={500}
                placeholder="检测到承诺收益表述，涉嫌违规。请充分提示投资风险。"
                onChange={(e) =>
                  setDraft({ ...draft, promptMessage: e.target.value })
                }
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) =>
                  setDraft({ ...draft, enabled: e.target.checked })
                }
              />
              保存后立即生效
            </label>

            <div className="rounded-lg border border-border-base bg-background-second p-3">
              <div className="mb-1 text-sm text-text-secondary">
                实时测试（输入文本验证命中）
              </div>
              <Textarea
                rows={2}
                value={draft.testText}
                placeholder="输入测试文本后自动预览命中"
                onChange={(e) =>
                  setDraft({ ...draft, testText: e.target.value })
                }
              />
              {testResult && (
                <div className="mt-2 text-sm">
                  {testResult.hit_count === 0 ? (
                    <div className="rounded bg-green-50 px-2 py-1 text-green-600">
                      未命中任何关键词
                    </div>
                  ) : (
                    <>
                      <div className="rounded bg-yellow-50 px-2 py-1 text-yellow-700">
                        命中 {testResult.hit_count} 处，将执行「
                        {actionLabel[
                          severityActionOptions[draft.actionIndex].action
                        ]}
                        」
                      </div>
                      <div className="mt-1 rounded border border-border-base bg-background-content px-2 py-1">
                        {highlighted}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                取消
              </Button>
              <Button onClick={() => onSave(draft)}>保存</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default QcRulePanel;
