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
  discardChangeSet,
  getChangeSetDiff,
  listChangeSets,
  publishChangeSet,
} from '@/services/change-set-service';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
 */
export default function ChangeCenter() {
  const { id: datasetId = '' } = useParams();
  const [changeSets, setChangeSets] = useState<IChangeSet[]>([]);
  const [diff, setDiff] = useState<IChangeSetDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [testOpen, setTestOpen] = useState(false);

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
        setDiff(d?.data?.data ?? null);
      } else {
        setDiff(null);
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

  const doPublish = async () => {
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
      reload();
    } catch (e: any) {
      toast.error(e?.message || '发布失败');
    }
  };

  const doDiscard = async () => {
    if (!diff) return;
    if (!window.confirm('确认放弃全部变更？线上数据将保持原样。')) return;
    try {
      await discardChangeSet(datasetId, diff.change_set_id);
      toast.success('已放弃全部变更');
      reload();
    } catch {
      toast.error('放弃失败');
    }
  };

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
          <Button size="sm" variant="outline" onClick={doDiscard} disabled={!diff}>
            全部放弃
          </Button>
          <Button size="sm" variant="outline" onClick={() => setTestOpen(true)} disabled={!diff}>
            测试对比
          </Button>
          <Button size="sm" onClick={doPublish} disabled={!diff}>
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
          <StatCard label="涉及词表" value={`${diff.synonyms.length}`} unit="组" />
          <StatCard
            label="变更集状态"
            value={changeSets[0]?.status === 'tested' ? '已测试' : '待测试'}
            unit=""
          />
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
                <TableHead className="h-10 w-24 text-text-title">变更类型</TableHead>
                <TableHead className="h-10 text-text-title">对象</TableHead>
                <TableHead className="h-10 text-text-title">变更前</TableHead>
                <TableHead className="h-10 text-text-title">变更后</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {diff.synonyms.map((g) => (
                <TableRow key={`syn-${g.group_id}`}>
                  <TableCell>
                    <Badge variant={g.group_type === 'proper' ? 'secondary' : 'default'}>
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
              ))}
              {diff.similar_questions.map((sq) => (
                <TableRow key={`sq-${sq.chunk_id}`}>
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
              ))}
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
        {unit && <span className="ml-1 text-sm font-normal text-text-secondary">{unit}</span>}
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
