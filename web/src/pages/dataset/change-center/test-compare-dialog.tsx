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

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  type IChangeSetDiff,
  getChangeSetDiff,
} from '@/services/change-set-service';
import kbService from '@/services/knowledge-service';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface HitItem {
  id: string;
  content: string;
  document_keyword?: string;
  similarity: number;
}

/**
 * TestCompareDialog 是测试对比弹窗：展示变更集 diff，并对测试问题跑一次
 * 「原配置」检索作为基准，标注发布后哪些相似问/同义词将生效。
 *
 * 说明：完整「新配置」检索需重建受影响 chunk 的 BM25 索引（增量测试沙箱），
 * 本阶段采用降级方案（PRD 4.2 允许）：展示 diff + 原配置基准。
 */
export function TestCompareDialog({
  open,
  onOpenChange,
  datasetId,
  changeSetId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  datasetId: string;
  changeSetId: string;
}) {
  const [diff, setDiff] = useState<IChangeSetDiff | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<HitItem[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (open && changeSetId) {
      getChangeSetDiff(datasetId, changeSetId)
        .then((res) => setDiff(res?.data?.data ?? null))
        .catch(() => toast.error('加载变更 diff 失败'));
    }
  }, [open, datasetId, changeSetId]);

  const addedSimilar = useMemo(() => {
    if (!diff) return [];
    return diff.similar_questions.flatMap((sq) =>
      sq.after.filter((a) => !sq.before.includes(a)),
    );
  }, [diff]);

  const addedSynonym = useMemo(() => {
    if (!diff) return [];
    return diff.synonyms.flatMap((g) =>
      g.after.filter((a) => !g.before.includes(a)),
    );
  }, [diff]);

  const runTest = async () => {
    const q = query.trim();
    if (!q) {
      toast.error('请输入测试问题');
      return;
    }
    setRunning(true);
    try {
      const res = await kbService.retrievalTest({
        dataset_id: datasetId,
        question: q,
        page: 1,
        page_size: 5,
      });
      const chunks = res?.data?.data?.chunks ?? [];
      setHits(
        chunks.map((c: any) => ({
          id: c.id,
          content: c.content,
          document_keyword: c.document_keyword,
          similarity: c.similarity,
        })),
      );
    } catch {
      toast.error('检索失败');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>测试对比 · 原配置 vs 新配置</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* 变更摘要 */}
          <div className="rounded bg-bg-card p-3 text-sm">
            <div className="mb-2 font-medium text-text-title">待生效变更摘要</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-text-secondary">
              <span>相似问新增 {addedSimilar.length} 条</span>
              <span>同义词/专有词新增 {addedSynonym.length} 条</span>
            </div>
            {addedSynonym.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {addedSynonym.map((w) => (
                  <span
                    key={w}
                    className="rounded bg-accent-primary/10 px-1.5 py-0.5 text-xs text-accent-primary"
                  >
                    {w}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 测试问题输入 */}
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="输入一个真实用户问题，如：50ETF 能买吗"
              onKeyDown={(e) => e.key === 'Enter' && runTest()}
            />
            <Button size="sm" onClick={runTest} disabled={running}>
              {running ? '检索中…' : '测试'}
            </Button>
          </div>

          {/* 原配置检索结果 */}
          {hits.length > 0 && (
            <div>
              <div className="mb-2 text-sm font-medium text-text-title">
                原配置（已生效）检索结果
              </div>
              <div className="flex flex-col gap-2">
                {hits.map((h, i) => (
                  <div
                    key={h.id}
                    className="rounded border border-border-base p-3"
                  >
                    <div className="flex items-center gap-2 text-xs text-text-secondary">
                      <span className="font-semibold text-text-title">#{i + 1}</span>
                      <span>{h.document_keyword || '-'}</span>
                      <span className="ml-auto font-mono">
                        {h.similarity?.toFixed(3)}
                      </span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-sm">{h.content}</div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-text-secondary">
                ⚠ 本阶段为降级对比：展示「原配置」检索基准。发布后，上述新增相似问/同义词将参与检索，
                可能改变排序并召回新结果。完整沙箱对比需后续升级。
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
