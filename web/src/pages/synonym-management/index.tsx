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

import {
  ISynonymGroup,
  ISynonymWord,
  SynonymDomain,
  createSynonymGroup,
  deleteSynonymGroup,
  getSynonymGroup,
  importSynonymGroups,
  listSynonymGroups,
  updateSynonymGroup,
} from '@/services/synonym-service';
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
import * as React from 'react';
import { toast } from 'sonner';

type DomainFilter = SynonymDomain | 'all';

const PAGE_SIZE = 10;

const domainLabel: Record<SynonymDomain, string> = {
  fund: '基金通用',
  hx: '华夏专属',
};

/** Editing state of one group; a null groupId means "creating a new group". */
interface EditorState {
  groupId: string | null;
  name: string;
  domain: SynonymDomain;
  remark: string;
  /** One word per line; the first line is the canonical form. */
  wordsText: string;
}

const emptyEditor = (domain: SynonymDomain): EditorState => ({
  groupId: null,
  name: '',
  domain,
  remark: '',
  wordsText: '',
});

/**
 * SynonymManagement manages the vocabulary alias groups of one knowledge base.
 *
 * Every word in a group expands to the group's other words at query time, so a
 * group models a single concept: a fund's full name, its abbreviation and the
 * spellings customers actually type are all recorded as one entry.
 */
export function SynonymManagement({ datasetId }: { datasetId: string }) {
  const [groups, setGroups] = React.useState<ISynonymGroup[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [domain, setDomain] = React.useState<DomainFilter>('all');
  const [keyword, setKeyword] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(PAGE_SIZE);
  const [editor, setEditor] = React.useState<EditorState | null>(null);

  const reload = React.useCallback(async () => {
    if (!datasetId) return;
    setLoading(true);
    try {
      const response = await listSynonymGroups(
        datasetId,
        domain === 'all' ? undefined : domain,
      );
      setGroups(response?.data?.data ?? []);
    } catch {
      toast.error('加载词组失败');
    } finally {
      setLoading(false);
    }
  }, [datasetId, domain]);

  React.useEffect(() => {
    reload();
  }, [reload]);

  const filtered = React.useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return groups;
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(kw) ||
        (g.remark ?? '').toLowerCase().includes(kw),
    );
  }, [groups, keyword]);

  const paged = React.useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize],
  );

  const openCreate = () =>
    setEditor(emptyEditor(domain === 'all' ? 'fund' : domain));

  const openEdit = async (group: ISynonymGroup) => {
    try {
      const response = await getSynonymGroup(group.id);
      const words: ISynonymWord[] = response?.data?.data?.words ?? [];
      setEditor({
        groupId: group.id,
        name: group.name,
        domain: group.domain,
        remark: group.remark ?? '',
        // The API returns the canonical word first, which is exactly the order
        // the textarea expects.
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

    // The first line is the canonical form; the rest are its aliases.
    const payload: ISynonymWord[] = words.map((word, i) => ({
      word,
      is_primary: i === 0,
    }));

    try {
      if (state.groupId) {
        await updateSynonymGroup(state.groupId, {
          name,
          domain: state.domain,
          remark: state.remark.trim(),
          words: payload,
        });
        toast.success('词组已更新，检索立即生效');
      } else {
        await createSynonymGroup(datasetId, {
          name,
          domain: state.domain,
          remark: state.remark.trim(),
          words: payload,
        });
        toast.success('词组已创建');
      }
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
        domain: domain === 'all' ? 'fund' : domain,
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {(['all', 'fund', 'hx'] as DomainFilter[]).map((d) => (
            <Button
              key={d}
              size="sm"
              variant={domain === d ? 'default' : 'outline'}
              onClick={() => {
                setDomain(d);
                setPage(1);
              }}
            >
              {d === 'all' ? '全部' : domainLabel[d]}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Input
            className="w-56"
            placeholder="搜索词组名称或备注"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
          />
          <Button size="sm" variant="outline" onClick={doImport}>
            批量导入
          </Button>
          <Button size="sm" onClick={openCreate}>
            新建词组
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-border-base">
        {paged.length === 0 && !loading ? (
          <Empty type={EmptyType.Data} text="暂无词组，点击右上角新建" />
        ) : (
          <Table scroll="page">
            <TableHeader className="bg-background-second">
              <TableRow>
                <TableHead className="h-10 w-10 text-text-secondary">
                  序号
                </TableHead>
                <TableHead className="h-10 text-text-title">词组名称</TableHead>
                <TableHead className="h-10 text-text-title">领域</TableHead>
                <TableHead className="h-10 text-text-title">词条数</TableHead>
                <TableHead className="h-10 text-text-title">备注</TableHead>
                <TableHead className="h-10 w-40 text-text-secondary">
                  操作
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((group, index) => (
                <TableRow key={group.id}>
                  <TableCell className="text-text-secondary">
                    {(page - 1) * PAGE_SIZE + index + 1}
                  </TableCell>
                  <TableCell className="font-medium text-text-title">
                    {group.name}
                  </TableCell>
                  <TableCell>
                    <span className="rounded bg-accent-primary/10 px-2 py-0.5 text-xs text-accent-primary">
                      {domainLabel[group.domain] ?? group.domain}
                    </span>
                  </TableCell>
                  <TableCell>{group.word_count}</TableCell>
                  <TableCell className="max-w-md truncate text-text-secondary">
                    {group.remark || '-'}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="link"
                        onClick={() => openEdit(group)}
                      >
                        编辑
                      </Button>
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
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {filtered.length > 0 && (
        <RAGFlowPagination
          current={page}
          pageSize={pageSize}
          total={filtered.length}
          onChange={(next, nextSize) => {
            setPage(next);
            if (nextSize) setPageSize(nextSize);
          }}
        />
      )}

      <WordEditor
        state={editor}
        onClose={() => setEditor(null)}
        onSave={save}
      />
    </div>
  );
}

/**
 * WordEditor edits one group's name, domain, remark and word list. Words are
 * edited as free text, one per line, which matches how the customer supplies
 * the vocabulary and keeps the alias relationship obvious at a glance.
 */
function WordEditor({
  state,
  onClose,
  onSave,
}: {
  state: EditorState | null;
  onClose: () => void;
  onSave: (state: EditorState) => void;
}) {
  // Draft copy so typing does not disturb the list behind the dialog.
  const [draft, setDraft] = React.useState<EditorState | null>(state);

  React.useEffect(() => {
    setDraft(state);
  }, [state]);

  return (
    <Dialog open={!!state} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{state?.groupId ? '编辑词组' : '新建词组'}</DialogTitle>
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
                  placeholder="如：华夏上证50ETF"
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className="w-40">
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
                词条（每行一个，第一行为标准词）
              </label>
              <Textarea
                rows={8}
                value={draft.wordsText}
                placeholder={'华夏上证50ETF\n50ETF\n上证50'}
                onChange={(e) =>
                  setDraft({ ...draft, wordsText: e.target.value })
                }
              />
            </div>

            <div>
              <label className="mb-1 block text-sm text-text-secondary">
                备注
              </label>
              <Input
                value={draft.remark}
                placeholder="可选"
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

export default SynonymManagement;
