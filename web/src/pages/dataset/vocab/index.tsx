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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { toast } from 'sonner';

import {
  type ISynonymGroup,
  type ISynonymWord,
  type SynonymDomain,
  type SynonymGroupType,
  type SynonymScope,
  createSynonymGroup,
  deleteSynonymGroup,
  getSynonymGroup,
  importSynonymGroups,
  listSynonymGroups,
  updateSynonymGroup,
} from '@/services/synonym-service';
import { getOrCreateChangeSet } from '@/services/change-set-service';

import { Badge } from '@/components/ui/badge';
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
import { cn } from '@/lib/utils';

const PAGE_SIZE = 10;

const scopeLabel: Record<SynonymScope, string> = {
  kb: '当前知识库',
  tenant: '租户全局',
};

type TabKey = 'synonym' | 'proper';

interface EditorState {
  groupId: string | null;
  name: string;
  domain: SynonymDomain;
  scope: SynonymScope;
  groupType: SynonymGroupType;
  remark: string;
  wordsText: string;
}

const emptyEditor = (groupType: SynonymGroupType): EditorState => ({
  groupId: null,
  name: '',
  domain: 'fund',
  scope: 'kb',
  groupType,
  remark: '',
  wordsText: '',
});

/**
 * Vocab 是词表管理页：维护同义词/近义词与专有词汇别名，用于查询扩展。
 *
 * 同义词/近义词（group_type=synonym）用于「整句改写」；专有词汇表
 * （group_type=proper）用于「实体归一」。两者共用 synonym_group 表，通过
 * group_type 区分，scope 控制生效范围（当前知识库 / 租户全局）。
 */
export default function Vocab() {
  const { id: datasetId = '' } = useParams();
  const [tab, setTab] = useState<TabKey>('synonym');
  const [groups, setGroups] = useState<ISynonymGroup[]>([]);
  const [loading, setLoading] = useState(false);
  // 加载失败要单独留状态。请求封装在 code != 0 时不抛异常，只弹一条通知，
  // 调用方拿到的是 {code, message, data: undefined}；原来这里无条件 `?? []`，
  // 于是「知识库解析不到 / 无权访问」被渲染成「暂无词组」——用户看到空表加一句
  // 英文报错，既判断不出是没数据还是没权限，也不知道该找谁。
  const [loadError, setLoadError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<EditorState | null>(null);

  const groupType: SynonymGroupType = tab === 'synonym' ? 'synonym' : 'proper';

  const reload = useCallback(async () => {
    if (!datasetId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const response = await listSynonymGroups(datasetId);
      if (response?.data?.code !== 0) {
        setGroups([]);
        setLoadError(response?.data?.message ?? '加载词表失败');
        return;
      }
      const all: ISynonymGroup[] = response?.data?.data ?? [];
      setGroups(
        all.filter(
          (g: ISynonymGroup) => (g.group_type ?? 'synonym') === groupType,
        ),
      );
    } catch {
      setGroups([]);
      setLoadError('加载词表失败');
    } finally {
      setLoading(false);
    }
  }, [datasetId, groupType]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    setPage(1);
  }, [tab]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return groups;
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(kw) ||
        (g.remark ?? '').toLowerCase().includes(kw),
    );
  }, [groups, keyword]);

  const paged = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );

  const openCreate = () => setEditor(emptyEditor(groupType));

  const openEdit = async (group: ISynonymGroup) => {
    try {
      const response = await getSynonymGroup(group.id);
      const words: ISynonymWord[] = response?.data?.data?.words ?? [];
      setEditor({
        groupId: group.id,
        name: group.name,
        domain: group.domain,
        scope: group.scope ?? 'kb',
        groupType: group.group_type ?? 'synonym',
        remark: group.remark ?? '',
        wordsText: words.map((w) => w.word).join('\n'),
      });
    } catch {
      toast.error('加载词条失败');
    }
  };

  const save = async (state: EditorState) => {
    const name = state.name.trim();
    if (!name) {
      toast.error('请填写词组名称');
      return;
    }
    const words = state.wordsText
      .split('\n')
      .map((w) => w.trim())
      .filter(Boolean);
    if (words.length < 2) {
      toast.error('至少需要两个词条才能形成别名关系');
      return;
    }

    const wordRows: ISynonymWord[] = words.map((word, i) => ({
      word,
      is_primary: i === 0,
    }));

    try {
      // 编辑进入待生效区，不直接生效；先获取/创建当前用户的变更集。
      const changeSetId = await getOrCreateChangeSet(datasetId);
      const payload = {
        name,
        domain: state.domain,
        scope: state.scope,
        group_type: state.groupType,
        remark: state.remark.trim(),
        words: wordRows,
        change_set_id: changeSetId,
      };
      const response = state.groupId
        ? await updateSynonymGroup(state.groupId, payload)
        : await createSynonymGroup(datasetId, payload);

      // 业务错误同样会 resolve（错误提示由请求拦截器统一弹出），所以不能无条件弹
      // 「已保存」——否则被拒绝的编辑（例如编辑了已被替换的历史词组）也会显示成功。
      if (response?.data?.code !== 0) {
        return;
      }
      const savedStatus = response?.data?.data?.status;
      toast.success(
        savedStatus === 'pending'
          ? '词组已保存为待生效变更，到「变更中心」发布后生效'
          : '词组已保存',
      );
      setEditor(null);
      reload();
    } catch {
      toast.error('保存失败');
    }
  };

  const remove = async (group: ISynonymGroup) => {
    if (
      !window.confirm(
        `确认删除词组「${group.name}」？该词组下的所有别名将一并删除。`,
      )
    )
      return;
    try {
      await deleteSynonymGroup(group.id);
      toast.success('词组已删除');
      reload();
    } catch {
      toast.error('删除失败');
    }
  };

  const doImport = async () => {
    const raw = window.prompt(
      '每行一条，格式：概念,别名1,别名2\n例如：\n华夏上证50ETF,50ETF,上证50\n华夏成长混合,华夏成长,成长混合',
    );
    if (!raw) return;

    const rows = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [concept, ...aliases] = line.split(',').map((s) => s.trim());
        return { concept, aliases: aliases.filter(Boolean) };
      })
      .filter((r) => r.concept);

    if (!rows.length) {
      toast.error('没有可导入的数据');
      return;
    }

    try {
      const response = await importSynonymGroups(datasetId, {
        domain: 'fund',
        rows,
      });
      toast.success(
        `成功导入 ${response?.data?.data?.created ?? rows.length} 个词组`,
      );
      reload();
    } catch {
      toast.error('导入失败');
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">词表管理</h1>
        <p className="mt-1 text-sm text-text-secondary">
          维护同义词、近义词与专有词汇别名，用于查询扩展。
        </p>
      </div>

      <div className="flex items-center gap-4 border-b border-border-base">
        <TabButton active={tab === 'synonym'} onClick={() => setTab('synonym')}>
          同义词 / 近义词
          <span className="ml-1.5 rounded bg-bg-card px-1.5 text-xs text-text-secondary">
            {groups.length}
          </span>
        </TabButton>
        <TabButton active={tab === 'proper'} onClick={() => setTab('proper')}>
          专有词汇表
        </TabButton>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          className="w-64"
          placeholder={
            tab === 'synonym'
              ? '搜索词组名、标准词或词条'
              : '搜索标准词、别名或领域'
          }
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value);
            setPage(1);
          }}
        />
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={doImport}>
            批量导入
          </Button>
          <Button size="sm" onClick={openCreate}>
            新增词组
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-border-base">
        <Table scroll="page">
          <TableHeader className="bg-background-second">
            <TableRow>
              <TableHead className="h-10 text-text-title">词组名称</TableHead>
              <TableHead className="h-10 text-text-title">标准词</TableHead>
              <TableHead className="h-10 text-text-title">
                {tab === 'synonym' ? '同义词 / 近义词' : '别名 / 简称'}
              </TableHead>
              <TableHead className="h-10 text-text-title">作用域</TableHead>
              <TableHead className="h-10 w-16 text-text-title">
                词条数
              </TableHead>
              <TableHead className="h-10 text-text-title">状态</TableHead>
              <TableHead className="h-10 w-32 text-text-title">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.length === 0 && !loading ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="h-40 text-center text-text-secondary"
                >
                  {loadError ? (
                    <div className="flex flex-col items-center gap-2">
                      <span className="text-state-error">词表加载失败</span>
                      <span className="max-w-xl text-xs text-text-secondary">
                        后端返回：{loadError}
                        <br />
                        常见原因：该知识库已被删除，或当前账号不在该知识库所属租户内。
                      </span>
                      <Button size="sm" variant="outline" onClick={reload}>
                        重试
                      </Button>
                    </div>
                  ) : (
                    '暂无词组，点击右上角「新增词组」'
                  )}
                </TableCell>
              </TableRow>
            ) : (
              paged.map((group) => {
                const primary = group.words?.[0]?.word ?? '';
                const aliases = group.words?.slice(1).map((w) => w.word) ?? [];
                // disabled = 已被某次发布替换下来的历史版本，不是「待生效」。
                // 之前统一按「非 live 即待生效」渲染，用户会把它当成正常词组点进去编辑。
                const status = group.status ?? 'live';
                return (
                  <TableRow key={group.id}>
                    <TableCell className="font-medium text-text-title">
                      {group.name}
                    </TableCell>
                    <TableCell>{primary || '-'}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {aliases.map((w) => (
                          <span
                            key={w}
                            className="rounded bg-bg-card px-1.5 py-0.5 text-xs text-text-primary"
                          >
                            {w}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-text-secondary">
                        {scopeLabel[group.scope ?? 'kb'] ?? group.scope}
                      </span>
                    </TableCell>
                    <TableCell>{group.word_count}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          status === 'live'
                            ? 'success'
                            : status === 'pending'
                              ? 'secondary'
                              : 'outline'
                        }
                        className={
                          status === 'disabled'
                            ? 'text-text-sub-title'
                            : undefined
                        }
                      >
                        {status === 'live'
                          ? '已生效'
                          : status === 'pending'
                            ? '待生效'
                            : '已替换'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {status === 'disabled' ? (
                          <span className="text-xs text-text-sub-title">
                            已被新版本替换
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="link"
                            onClick={() => openEdit(group)}
                          >
                            编辑
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="link"
                          onClick={() => remove(group)}
                        >
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {filtered.length > PAGE_SIZE && (
        <RAGFlowPagination
          current={page}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          onChange={setPage}
        />
      )}

      <VocabEditor
        state={editor}
        onClose={() => setEditor(null)}
        onSave={save}
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-3 py-2.5 text-sm transition-colors',
        active
          ? 'border-accent-primary font-medium text-accent-primary'
          : 'border-transparent text-text-secondary hover:text-text-primary',
      )}
    >
      {children}
    </button>
  );
}

/**
 * VocabEditor 编辑一个词组的名称、领域、作用域、类型与词条列表。词条以
 * 每行一个的纯文本编辑，第一行为标准词，其余为别名，与客户提供词表的方式一致。
 */
function VocabEditor({
  state,
  onClose,
  onSave,
}: {
  state: EditorState | null;
  onClose: () => void;
  onSave: (state: EditorState) => void;
}) {
  const [draft, setDraft] = useState<EditorState | null>(state);

  useEffect(() => {
    setDraft(state);
  }, [state]);

  return (
    <Dialog open={!!state} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{state?.groupId ? '编辑词组' : '新增词组'}</DialogTitle>
        </DialogHeader>

        {draft && (
          <div className="flex flex-col gap-4">
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="mb-1 block text-sm text-text-secondary">
                  词组名称
                </label>
                <Input
                  value={draft.name}
                  placeholder="如：退款类说法、华夏产品别名"
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className="w-36">
                <label className="mb-1 block text-sm text-text-secondary">
                  类型
                </label>
                <select
                  className="h-10 w-full rounded-md border border-border-base bg-background-content px-3 text-sm"
                  value={draft.groupType}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      groupType: e.target.value as SynonymGroupType,
                    })
                  }
                >
                  <option value="synonym">同义词 / 近义词</option>
                  <option value="proper">专有词汇</option>
                </select>
              </div>
              <div className="w-36">
                <label className="mb-1 block text-sm text-text-secondary">
                  作用域
                </label>
                <select
                  className="h-10 w-full rounded-md border border-border-base bg-background-content px-3 text-sm"
                  value={draft.scope}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      scope: e.target.value as SynonymScope,
                    })
                  }
                >
                  <option value="kb">当前知识库</option>
                  <option value="tenant">租户全局</option>
                </select>
              </div>
              <div className="w-32">
                <label className="mb-1 block text-sm text-text-secondary">
                  领域
                </label>
                <select
                  className="h-10 w-full rounded-md border border-border-base bg-background-content px-3 text-sm"
                  value={draft.domain}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      domain: e.target.value as SynonymDomain,
                    })
                  }
                >
                  <option value="fund">基金通用</option>
                  <option value="hx">华夏专属</option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm text-text-secondary">
                标准词
              </label>
              <Input
                value={draft.wordsText.split('\n')[0] ?? ''}
                placeholder="该词组指向的标准词或标准问题"
                onChange={(e) => {
                  const lines = draft.wordsText.split('\n');
                  lines[0] = e.target.value;
                  setDraft({ ...draft, wordsText: lines.join('\n') });
                }}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm text-text-secondary">
                {draft.groupType === 'proper'
                  ? '别名 / 简称'
                  : '同义词 / 近义词'}
                <span className="ml-1 text-xs text-text-secondary">
                  （每行一个，第一行为标准词）
                </span>
              </label>
              <Textarea
                rows={8}
                value={draft.wordsText}
                placeholder={'华夏上证50ETF\n50ETF\n上证50'}
                onChange={(e) =>
                  setDraft({ ...draft, wordsText: e.target.value })
                }
              />
              {/* 同义词现在按标准词的等价权重参与检索，一个单字（如「买」）
                  会把大量无关提问一并拉进来，所以先在这里提示一下。 */}
              <p className="mt-1 text-xs text-text-sub-title">
                同义词与标准词同等权重参与检索。请避免用单字（如「买」）当同义词，
                否则会召回过多无关内容；建议每条 ≥2 个字、语义明确。
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm text-text-secondary">
                备注
              </label>
              <Input
                value={draft.remark}
                placeholder="可选，说明这组词的用途"
                onChange={(e) => setDraft({ ...draft, remark: e.target.value })}
              />
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
