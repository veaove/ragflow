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
  type IChangeSet,
  type IChangeSetDiff,
  type IChangeSetScope,
  discardChangeSet,
  getChangeSetDiff,
  listChangeSets,
  publishChangeSet,
} from '@/services/change-set-service';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TestCompareDialog } from './test-compare-dialog';

/**
 * ChangeCenter 是变更中心：所有修改先进入待生效区，测试对比通过后再发布。
 * 一个变更集（change set）聚合一批待生效变更，发布时原子生效。
 *
 * 列表支持勾选：表头「全选」，每行一个复选框。操作按钮按作用域区分——
 * 「放弃选中」「选中发布」只作用于勾选项（无勾选时置灰），「发布全部」作用于
 * 整个变更集；「测试对比」有勾选时只对比选中项，否则全量对比。
 */
export default function ChangeCenter() {
  const { id: datasetId = '' } = useParams();
  const [changeSets, setChangeSets] = useState<IChangeSet[]>([]);
  const [diff, setDiff] = useState<IChangeSetDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  // 勾选项的稳定 key：`sq:<chunk_id>` / `syn:<group_id>`。
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    if (!datasetId) return;
    setLoading(true);
    try {
      const res = await listChangeSets(datasetId);
      const sets: IChangeSet[] = res?.data?.data ?? [];
      setChangeSets(sets);
      // 取第一个（最新）变更集的 diff 展示
      if (sets.length > 0) {
        const d = await getChangeSetDiff(datasetId, sets[0].id);
        const nextDiff: IChangeSetDiff | null = d?.data?.data ?? null;
        setDiff(nextDiff);
        // 勾选项随 reload 修剪：已不在 diff 里的项自动取消勾选。
        setSelected((prev) => {
          const valid = new Set<string>();
          nextDiff?.similar_questions.forEach((sq) =>
            valid.add(`sq:${sq.chunk_id}`),
          );
          nextDiff?.synonyms.forEach((g) => valid.add(`syn:${g.group_id}`));
          return new Set([...prev].filter((k) => valid.has(k)));
        });
      } else {
        setDiff(null);
        setSelected(new Set());
      }
    } catch {
      toast.error('加载变更中心失败');
    } finally {
      setLoading(false);
    }
  }, [datasetId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const changeCount = useMemo(() => {
    if (!diff) return 0;
    return diff.similar_questions.length + diff.synonyms.length;
  }, [diff]);

  // 勾选范围：只有勾选非空时才生成 scope，且两个数组恒同时存在（可为空），
  // 这样「只勾了相似问」绝不会误发布同义词组。
  const scope: IChangeSetScope | undefined = useMemo(() => {
    if (!diff || selected.size === 0) return undefined;
    const chunk_ids = diff.similar_questions
      .filter((sq) => selected.has(`sq:${sq.chunk_id}`))
      .map((sq) => sq.chunk_id);
    const group_ids = diff.synonyms
      .filter((g) => selected.has(`syn:${g.group_id}`))
      .map((g) => g.group_id);
    return { chunk_ids, group_ids };
  }, [diff, selected]);

  const selectedCount = useMemo(() => {
    if (!diff) return 0;
    return (
      diff.similar_questions.filter((sq) => selected.has(`sq:${sq.chunk_id}`))
        .length +
      diff.synonyms.filter((g) => selected.has(`syn:${g.group_id}`)).length
    );
  }, [diff, selected]);

  const allSelected = changeCount > 0 && selectedCount === changeCount;
  const someSelected = selectedCount > 0 && !allSelected;

  const toggle = useCallback((key: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (!diff) return;
    setSelected((prev) => {
      const keys: string[] = [];
      diff.similar_questions.forEach((sq) => keys.push(`sq:${sq.chunk_id}`));
      diff.synonyms.forEach((g) => keys.push(`syn:${g.group_id}`));
      const allOn = keys.length > 0 && keys.every((k) => prev.has(k));
      if (allOn) return new Set();
      return new Set(keys);
    });
  }, [diff]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const doPublishSelected = async () => {
    if (!diff || !scope) return;
    if (
      !window.confirm(
        `确认发布选中的 ${selectedCount} 项变更？发布后线上检索将立即生效，未选中的项将保留在待生效区。`,
      )
    )
      return;
    try {
      await publishChangeSet(datasetId, diff.change_set_id, scope);
      toast.success('已发布选中变更');
      setSelected(new Set());
      reload();
    } catch (e: any) {
      toast.error(e?.message || '发布失败');
    }
  };

  const doPublishAll = async () => {
    if (!diff) return;
    if (
      !window.confirm(
        `确认发布 ${changeCount} 项变更？发布后线上检索将立即生效。`,
      )
    )
      return;
    try {
      await publishChangeSet(datasetId, diff.change_set_id);
      toast.success('发布成功');
      setSelected(new Set());
      reload();
    } catch (e: any) {
      toast.error(e?.message || '发布失败');
    }
  };

  const doDiscardSelected = async () => {
    if (!diff || !scope) return;
    if (
      !window.confirm(
        `确认放弃选中的 ${selectedCount} 项变更？线上数据将保持原样，未选中的项将保留在待生效区。`,
      )
    )
      return;
    try {
      await discardChangeSet(datasetId, diff.change_set_id, scope);
      toast.success('已放弃选中变更');
      setSelected(new Set());
      reload();
    } catch {
      toast.error('放弃失败');
    }
  };

  const hasPending = changeCount > 0;

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">变更中心</h1>
          <p className="mt-1 text-sm text-text-secondary">
            所有修改先进入这里暂存，测试对比通过后再发布。发布前不会影响线上检索。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={doDiscardSelected}
            disabled={selectedCount === 0}
          >
            放弃选中
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setTestOpen(true)}
            disabled={!hasPending}
          >
            测试对比
          </Button>
          <Button
            size="sm"
            variant="accent"
            onClick={doPublishSelected}
            disabled={selectedCount === 0}
          >
            选中发布
          </Button>
          <Button size="sm" onClick={doPublishAll} disabled={!hasPending}>
            发布全部
          </Button>
        </div>
      </div>

      {diff && (
        <div className="flex gap-4">
          <StatCard label="待生效变更" value={`${changeCount}`} unit="项" />
          <StatCard
            label="涉及问答对"
            value={`${diff.similar_questions.length}`}
            unit="个"
          />
          <StatCard
            label="涉及词表"
            value={`${diff.synonyms.length}`}
            unit="组"
          />
          <StatCard
            label="变更集状态"
            value={changeSets[0]?.status === 'tested' ? '已测试' : '待测试'}
            unit=""
          />
        </div>
      )}

      {hasPending && (
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          {selectedCount > 0 ? (
            <>
              <span>已选 {selectedCount} 项</span>
              <button
                type="button"
                className="text-text-title underline underline-offset-2 hover:text-accent-primary"
                onClick={clearSelection}
              >
                清除选择
              </button>
            </>
          ) : (
            <span>勾选列表项后可按选中项发布或放弃</span>
          )}
        </div>
      )}

      <div className="flex-1 overflow-auto rounded-lg border border-border-base">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-text-secondary">
            加载中…
          </div>
        ) : !diff || changeCount === 0 ? (
          <div className="flex h-40 items-center justify-center text-text-secondary">
            暂无待生效变更，所有修改均已发布
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-background-second">
              <TableRow>
                <TableHead className="h-10 w-12 text-text-title">
                  <Checkbox
                    checked={
                      allSelected
                        ? true
                        : someSelected
                          ? 'indeterminate'
                          : false
                    }
                    onCheckedChange={toggleAll}
                    aria-label="全选"
                  />
                </TableHead>
                <TableHead className="h-10 w-24 text-text-title">
                  变更类型
                </TableHead>
                <TableHead className="h-10 text-text-title">对象</TableHead>
                <TableHead className="h-10 text-text-title">变更前</TableHead>
                <TableHead className="h-10 text-text-title">变更后</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {diff.synonyms.map((g) => {
                const key = `syn:${g.group_id}`;
                return (
                  <TableRow key={key}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(key)}
                        onCheckedChange={(v) => toggle(key, v === true)}
                        aria-label={`选择词表 ${g.name}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          g.group_type === 'proper' ? 'secondary' : 'default'
                        }
                      >
                        {g.group_type === 'proper' ? '专有词' : '同义词'}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium text-text-title">
                      {g.name}
                    </TableCell>
                    <TableCell>
                      <ChipList items={g.before} variant="before" />
                    </TableCell>
                    <TableCell>
                      <ChipList items={g.after} variant="after" />
                    </TableCell>
                  </TableRow>
                );
              })}
              {diff.similar_questions.map((sq) => {
                const key = `sq:${sq.chunk_id}`;
                return (
                  <TableRow key={key}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(key)}
                        onCheckedChange={(v) => toggle(key, v === true)}
                        aria-label={`选择相似问 ${sq.question || sq.chunk_id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge>相似问</Badge>
                    </TableCell>
                    <TableCell className="font-medium text-text-title">
                      {sq.question || sq.chunk_id}
                    </TableCell>
                    <TableCell>
                      <ChipList items={sq.before} variant="before" />
                    </TableCell>
                    <TableCell>
                      <ChipList items={sq.after} variant="after" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {diff && (
        <TestCompareDialog
          open={testOpen}
          onOpenChange={setTestOpen}
          datasetId={datasetId}
          changeSetId={diff.change_set_id}
          scope={scope}
        />
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="flex-1 rounded-lg border border-border-base bg-background-content p-4">
      <div className="text-sm text-text-secondary">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-text-primary">
        {value}
        {unit && (
          <span className="ml-1 text-sm font-normal text-text-secondary">
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

function ChipList({
  items,
  variant,
}: {
  items: string[];
  variant: 'before' | 'after';
}) {
  if (!items.length) return <span className="text-text-secondary">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((it) => (
        <span
          key={it}
          className={
            variant === 'after'
              ? 'rounded bg-accent-primary/10 px-1.5 py-0.5 text-xs text-accent-primary'
              : 'rounded bg-bg-card px-1.5 py-0.5 text-xs text-text-secondary'
          }
        >
          {it}
        </span>
      ))}
    </div>
  );
}
