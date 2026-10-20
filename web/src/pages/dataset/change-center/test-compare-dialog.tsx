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
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Copy } from 'lucide-react';

import {
  type IChangeSetDiff,
  type IChangeSetScope,
  type ICompareDiffItem,
  type ICompareHit,
  type ICompareSide,
  type IRetrievalCompareResult,
  getChangeSetDiff,
  publishChangeSet,
  retrievalCompare,
} from '@/services/change-set-service';

import { Button } from '@/components/ui/button';
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const DEFAULT_TOP_K = 5;
const DEFAULT_THRESHOLD = 0.2;

/**
 * TestCompareDialog —— 变更集发布前的影子检索对比。
 *
 * 同一问题跑两遍：原配置（live）与原配置 + 变更集（candidate）。两侧共用
 * 完全相同的 TopK / 阈值 / 权重，差异只来自待生效的变更集，因此结果可比。
 *
 * 对比不重建索引：同义词走 query 扩写（精确），相似问走 chunk token 注入
 * （仅 rerank 路径可精确模拟）。能力边界由后端 capability 给出并在界面上
 * 明示——不假装精确，也不静默降级：任一侧检索失败时只报错，不退回「只看
 * 原配置」，那会让评估失真。
 */
export function TestCompareDialog({
  open,
  onOpenChange,
  datasetId,
  changeSetId,
  scope,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  datasetId: string;
  changeSetId: string;
  /** 有勾选时只对比选中项；undefined 表示对比整个变更集。 */
  scope?: IChangeSetScope;
}) {
  const [diff, setDiff] = useState<IChangeSetDiff | null>(null);
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(DEFAULT_TOP_K);
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [result, setResult] = useState<IRetrievalCompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(true);

  useEffect(() => {
    if (open && changeSetId) {
      getChangeSetDiff(datasetId, changeSetId)
        .then((res) => setDiff(res?.data?.data ?? null))
        .catch(() => toast.error('加载变更 diff 失败'));
    }
  }, [open, datasetId, changeSetId]);

  // Reset the result whenever a parameter changes: showing a comparison next to
  // parameters it was not produced with is worse than showing nothing.
  useEffect(() => {
    setResult(null);
    setError(null);
  }, [query, topK, threshold, scope]);

  // 待生效摘要只展示本次对比范围内的项，与后端按 scope 过滤的结果口径一致。
  const scopedDiff = useMemo(() => {
    if (!diff || !scope) return diff;
    return {
      change_set_id: diff.change_set_id,
      similar_questions: diff.similar_questions.filter((sq) =>
        scope.chunk_ids.includes(sq.chunk_id),
      ),
      synonyms: diff.synonyms.filter((g) =>
        scope.group_ids.includes(g.group_id),
      ),
    };
  }, [diff, scope]);

  const addedSimilar = useMemo(() => {
    if (!scopedDiff) return [];
    return scopedDiff.similar_questions.flatMap((sq) =>
      sq.after.filter((a) => !sq.before.includes(a)),
    );
  }, [scopedDiff]);

  const addedSynonym = useMemo(() => {
    if (!scopedDiff) return [];
    return scopedDiff.synonyms.flatMap((g) =>
      g.after.filter((a) => !g.before.includes(a)),
    );
  }, [scopedDiff]);

  // 同义词条数的「现在 → 发布后」对比。只报「+N 条」容易让人误以为
  // 已生效里也有这些词，把两侧总数摆出来才能看清差异到底在哪。
  const synonymCounts = useMemo(() => {
    if (!scopedDiff) return { live: 0, total: 0 };
    return scopedDiff.synonyms.reduce(
      (acc, g) => ({
        live: acc.live + g.before.length,
        total: acc.total + g.after.length,
      }),
      { live: 0, total: 0 },
    );
  }, [scopedDiff]);

  const scopeLabel = useMemo(() => {
    if (!diff) return '全部 0 项';
    if (!scope) {
      return `全部 ${diff.similar_questions.length + diff.synonyms.length} 项`;
    }
    const n = scope.chunk_ids.length + scope.group_ids.length;
    return `选中 ${n} 项（相似问 ${scope.chunk_ids.length} · 同义词 ${scope.group_ids.length}）`;
  }, [diff, scope]);

  const runCompare = useCallback(async () => {
    const q = query.trim();
    if (!q) {
      toast.error('请输入测试问题');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await retrievalCompare(datasetId, changeSetId, {
        dataset_ids: [datasetId],
        question: q,
        top_k: topK,
        similarity_threshold: threshold,
        page: 1,
        size: topK,
        ...(scope ? { scope } : {}),
      });
      if (res?.data?.code !== 0) {
        setError(res?.data?.message || '对比失败');
        return;
      }
      setResult(res.data.data as IRetrievalCompareResult);
    } catch (e: any) {
      // Keep the reason: the design requires showing it rather than a generic
      // failure, and explicitly forbids falling back to "baseline only".
      setError(e?.response?.data?.message || e?.message || '对比失败');
    } finally {
      setLoading(false);
    }
  }, [datasetId, changeSetId, query, topK, threshold, scope]);

  const summary = result?.diff?.summary;
  const capability = result?.capability;
  const isEmptyResult =
    !!summary &&
    summary.added_count === 0 &&
    summary.removed_count === 0 &&
    summary.reordered_count === 0 &&
    summary.score_changed_count === 0;

  const reportMarkdown = useMemo(() => {
    if (!result || !summary) return '';
    const lines: string[] = [];
    lines.push('## 变更集测试对比报告');
    lines.push('');
    lines.push(`- 测试问题：${query}`);
    lines.push(`- TopK：${topK} · 阈值：${threshold}`);
    lines.push(
      `- 命中：原配置 ${summary.baseline_count} · 新配置 ${summary.candidate_count}`,
    );
    lines.push(
      `- 新增 ${summary.added_count} · 丢失 ${summary.removed_count} · 交集位次变化 ${summary.reordered_count} · 交集平均分 ${summary.avg_delta_on_common >= 0 ? '+' : ''}${summary.avg_delta_on_common.toFixed(4)}`,
    );
    if (result.capability.unsolved_reasons.length > 0) {
      lines.push(
        `- 能力限制：${result.capability.unsolved_reasons.join(', ')}`,
      );
    }
    lines.push('');
    if (result.diff.added.length > 0) {
      lines.push('### 新增召回');
      result.diff.added.forEach((it) => {
        lines.push(
          `- #${it.rank} ${it.doc_keyword || it.chunk_id} · ${(it.similarity ?? 0).toFixed(3)}`,
        );
      });
      lines.push('');
    }
    if (result.diff.removed.length > 0) {
      lines.push('### 丢失召回');
      result.diff.removed.forEach((it) => {
        lines.push(
          `- 原名次 #${it.rank} ${it.doc_keyword || it.chunk_id} · ${(it.similarity ?? 0).toFixed(3)} · ${reasonLabel(it.reason)}`,
        );
      });
      lines.push('');
    }
    if (result.diff.reordered_common.length > 0) {
      lines.push('### 排序变化');
      result.diff.reordered_common.forEach((it) => {
        lines.push(
          `- ${it.doc_keyword || it.chunk_id} · #${it.before_rank} → #${it.after_rank} · Δ${fmtDelta(it.delta)}`,
        );
      });
      lines.push('');
    }
    lines.push('> 对比结果仅用于发布前评估，不影响线上检索。');
    return lines.join('\n');
  }, [result, summary, query, topK, threshold]);

  const copyReport = useCallback(async () => {
    if (!reportMarkdown) return;
    try {
      await navigator.clipboard.writeText(reportMarkdown);
      toast.success('报告已复制到剪贴板');
    } catch {
      toast.error('复制失败，请手动选择文本复制');
    }
  }, [reportMarkdown]);

  const handlePublish = useCallback(async () => {
    try {
      await publishChangeSet(datasetId, changeSetId, scope);
      toast.success(scope ? '已发布选中变更' : '变更集已发布');
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || '发布失败');
    }
  }, [datasetId, changeSetId, scope, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1100px]">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            测试对比 · 原配置 vs 新配置
            <span className="rounded bg-bg-card px-1.5 py-0.5 text-xs font-normal text-text-secondary">
              变更集 {changeSetId.slice(0, 8)}
            </span>
            {/* Fixed label for the comparison method: never imply precision
                the implementation does not have. */}
            <span
              className="rounded bg-accent-primary/10 px-1.5 py-0.5 text-xs font-normal text-accent-primary"
              title="同义词通过 query 扩写精确模拟；相似问通过注入 chunk token 模拟，仅 rerank 路径可精确模拟。不重建索引。"
            >
              影子检索 · 不重建索引
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* 待生效变更摘要 */}
          <div className="rounded bg-bg-card p-3 text-sm">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
              <span className="rounded bg-accent-primary/10 px-1.5 py-0.5 font-medium text-accent-primary">
                对比范围：{scopeLabel}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-text-secondary">
              <span>待生效：相似问 +{addedSimilar.length} 条</span>
              {addedSynonym.length > 0 && (
                <span data-testid="synonym-count-compare">
                  同义词：已生效 {synonymCounts.live} 条 → 发布后{' '}
                  {synonymCounts.total} 条（新增 {addedSynonym.length} 条）
                </span>
              )}
              {addedSynonym.length === 0 && <span>同义词/专有词 +0 条</span>}
            </div>
            {addedSynonym.length > 0 && (
              <div className="mt-1 text-xs text-text-secondary">
                以下词条<b className="text-text-primary">仅存在于变更集</b>
                ，发布后才会参与检索：
              </div>
            )}
            {addedSynonym.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {addedSynonym.slice(0, 20).map((w) => (
                  <span
                    key={w}
                    className="rounded bg-accent-primary/10 px-1.5 py-0.5 text-xs text-accent-primary"
                  >
                    {w}
                  </span>
                ))}
                {addedSynonym.length > 20 && (
                  <span className="text-xs text-text-secondary">
                    等 {addedSynonym.length} 条
                  </span>
                )}
              </div>
            )}
          </div>

          {/* 参数行：TopK 与阈值必须可见，对比结论完全依赖它们 */}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="输入一个真实用户问题，如：50ETF 能买吗"
              onKeyDown={(e) => e.key === 'Enter' && runCompare()}
              className="min-w-[240px] flex-1"
              data-testid="compare-question"
            />
            <label className="flex items-center gap-1 text-xs text-text-secondary">
              TopK
              <Input
                type="number"
                min={1}
                max={50}
                value={topK}
                onChange={(e) =>
                  setTopK(Number(e.target.value) || DEFAULT_TOP_K)
                }
                className="w-16"
              />
            </label>
            <label className="flex items-center gap-1 text-xs text-text-secondary">
              阈值
              <Input
                type="number"
                step="0.05"
                min={0}
                max={1}
                value={threshold}
                onChange={(e) =>
                  setThreshold(Number(e.target.value) || DEFAULT_THRESHOLD)
                }
                className="w-20"
              />
            </label>
            <Button
              size="sm"
              onClick={runCompare}
              disabled={loading}
              data-testid="compare-run"
            >
              {loading ? '对比中…' : '测试'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={copyReport}
              disabled={!result}
              data-testid="compare-copy"
            >
              <Copy className="size-3.5" />
              复制报告
            </Button>
          </div>

          {/* 能力提示条：诚实说明能模拟什么、不能模拟什么 */}
          {capability && (
            <div
              className={cn(
                'rounded border p-2 text-xs',
                capability.similar_q_simulated
                  ? 'border-border-default bg-bg-card text-text-secondary'
                  : 'border-amber-300 bg-amber-50 text-amber-800',
              )}
              data-testid="compare-capability"
            >
              {capability.similar_q_simulated ? (
                <span>
                  相似问影响已精确模拟（基于 rerank
                  分词通道）；同义词变更同样精确。
                </span>
              ) : (
                <span>
                  ⚠ 未配置 rerank 模型，<b>相似问变更无法模拟</b>
                  ；同义词变更仍可精确模拟。配置 rerank 后可获得完整对比。
                </span>
              )}
              {capability.affected_chunk_count > 0 && (
                <span className="ml-2">
                  本次为 {capability.affected_chunk_count} 个 chunk 新增相似问
                  {capability.skipped_similar_count > 0 &&
                    `；其中 ${capability.skipped_similar_count} 条与当前问题无词项重叠，已跳过`}
                  。
                </span>
              )}
            </div>
          )}

          {/* 本次变更给检索词新增了什么 —— 这是「为什么无差异」的直接答案 */}
          {result && (result.extra_query_terms?.length ?? 0) > 0 && (
            <div
              className="rounded border border-border-default bg-bg-card p-2 text-xs text-text-secondary"
              data-testid="extra-query-terms"
            >
              新配置的检索词比原配置多了：
              <span className="ml-1 inline-flex flex-wrap gap-1">
                {result.extra_query_terms!.map((term) => (
                  <span
                    key={term}
                    className="rounded bg-accent-primary/10 px-1.5 py-0.5 text-accent-primary"
                  >
                    {term}
                  </span>
                ))}
              </span>
              {isEmptyResult && (
                <div className="mt-1">
                  这些词在当前知识库的语料中未出现，因此不会产生新的召回 ——
                  字典已生效，是「没有可匹配的内容」，不是变更没生效。
                </div>
              )}
            </div>
          )}

          {/* 错误：只显示原因，不退回「只看原配置」 */}
          {error && (
            <div
              className="rounded border border-state-error bg-red-50 p-3 text-sm text-state-error"
              data-testid="compare-error"
            >
              <div className="font-medium">对比失败</div>
              <div className="mt-1">{error}</div>
              <div className="mt-1 text-xs">
                对比结果不可用时不做降级展示——请修正后重试（如降低 TopK
                或调整阈值）。
              </div>
            </div>
          )}

          {/* 六张指标卡：先给结论，再看明细 */}
          {summary && (
            <div
              className="grid grid-cols-2 gap-2 md:grid-cols-6"
              data-testid="compare-metrics"
            >
              <MetricCard label="原配置命中" value={summary.baseline_count} />
              <MetricCard label="新配置命中" value={summary.candidate_count} />
              <MetricCard
                label="新增召回"
                value={`+${summary.added_count}`}
                tone={summary.added_count > 0 ? 'good' : 'neutral'}
              />
              <MetricCard
                label="丢失召回"
                value={`-${summary.removed_count}`}
                tone={summary.removed_count > 0 ? 'bad' : 'neutral'}
              />
              <MetricCard
                label="交集位次变化"
                value={summary.reordered_count}
                hint={
                  summary.displaced_count > 0
                    ? `另有 ${summary.displaced_count} 条结构性位移`
                    : undefined
                }
              />
              <MetricCard
                label="交集平均分"
                value={`${summary.avg_delta_on_common >= 0 ? '+' : ''}${summary.avg_delta_on_common.toFixed(3)}`}
                tone={
                  summary.avg_delta_on_common > 0
                    ? 'good'
                    : summary.avg_delta_on_common < 0
                      ? 'bad'
                      : 'neutral'
                }
                hint={`交集 ${summary.common_count} 条`}
              />
            </div>
          )}

          {/* 全零：明确告知无影响，避免用户以为自己漏看 */}
          {isEmptyResult && (
            <div
              className="rounded border border-border-default bg-bg-card p-3 text-sm text-text-secondary"
              data-testid="compare-no-effect"
            >
              新配置对本问题
              <b className="text-text-primary">无影响</b>
              ：召回集合、排序与得分均未变化。
            </div>
          )}

          {/* 双栏同序结果 */}
          {result && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <CompareColumn
                title="原配置 · 已生效"
                side={result.baseline}
                testId="compare-baseline"
              />
              <CompareColumn
                title="新配置 · 生效配置 + 变更集"
                side={result.candidate}
                removed={result.diff.removed}
                testId="compare-candidate"
              />
            </div>
          )}

          {/* 差异明细：默认展开，可收起 */}
          {result && (
            <div className="rounded border border-border-default">
              <button
                type="button"
                className="flex w-full items-center gap-1 px-3 py-2 text-left text-sm font-medium"
                onClick={() => setDetailOpen((v) => !v)}
                data-testid="compare-detail-toggle"
              >
                {detailOpen ? (
                  <ChevronDown className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
                差异分析明细
                <span className="ml-2 text-xs font-normal text-text-secondary">
                  新增 {summary?.added_count ?? 0} · 丢失{' '}
                  {summary?.removed_count ?? 0} · 排序变化{' '}
                  {summary?.reordered_count ?? 0} · 得分变化{' '}
                  {summary?.score_changed_count ?? 0}
                </span>
              </button>
              {detailOpen && (
                <div className="border-t border-border-default px-3 py-2 text-sm">
                  {isEmptyResult && (
                    <div className="text-text-secondary">无差异</div>
                  )}
                  <DiffSection
                    label="新增召回"
                    items={result.diff.added}
                    render={(it) =>
                      `#${it.rank} ${it.doc_keyword || it.chunk_id} · ${(it.similarity ?? 0).toFixed(3)}`
                    }
                  />
                  <DiffSection
                    label="丢失召回"
                    items={result.diff.removed}
                    render={(it) =>
                      `原名次 #${it.rank} ${it.doc_keyword || it.chunk_id} · ${(it.similarity ?? 0).toFixed(3)} · ${reasonLabel(it.reason)}`
                    }
                  />
                  <DiffSection
                    label="排序变化"
                    items={result.diff.reordered_common}
                    render={(it) =>
                      `${it.doc_keyword || it.chunk_id} · #${it.before_rank} → #${it.after_rank} · Δ${fmtDelta(it.delta)}`
                    }
                  />
                  <DiffSection
                    label="仅得分变化"
                    items={result.diff.score_changed.filter(
                      (it) => it.before_rank === it.after_rank,
                    )}
                    render={(it) =>
                      `#${it.after_rank} ${it.doc_keyword || it.chunk_id} · ${(it.before_score ?? 0).toFixed(3)} → ${(it.after_score ?? 0).toFixed(3)} · Δ${fmtDelta(it.delta)}`
                    }
                  />
                </div>
              )}
            </div>
          )}

          {!result && !error && !loading && (
            <div className="rounded border border-dashed border-border-default p-6 text-center text-sm text-text-secondary">
              输入问题后点「测试」，将同时跑原配置与新配置并对比差异。
            </div>
          )}

          {loading && (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-10 animate-pulse rounded bg-bg-card"
                />
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-text-secondary">
            对比结果仅用于发布前评估，不影响线上检索
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
            <ConfirmDeleteDialog
              onOk={handlePublish}
              title={
                scope
                  ? '发布选中的变更将立即生效并影响线上检索，未选中的项将保留在待生效区。确定发布？'
                  : '发布后变更将立即生效并影响线上检索，确定发布该变更集？'
              }
            >
              <Button data-testid="compare-publish">
                {scope ? '发布选中变更' : '发布变更集'}
              </Button>
            </ConfirmDeleteDialog>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MetricCard({
  label,
  value,
  tone = 'neutral',
  hint,
}: {
  label: string;
  value: string | number;
  tone?: 'good' | 'bad' | 'neutral';
  hint?: string;
}) {
  return (
    <div className="rounded border border-border-default px-2 py-2">
      <div className="text-xs text-text-secondary">{label}</div>
      <div
        className={cn(
          'mt-1 text-lg font-semibold',
          tone === 'good' && 'text-state-success',
          tone === 'bad' && 'text-state-error',
          tone === 'neutral' && 'text-text-primary',
        )}
      >
        {value}
      </div>
      {hint && <div className="text-[10px] text-text-secondary">{hint}</div>}
    </div>
  );
}

function CompareColumn({
  title,
  side,
  removed,
  testId,
}: {
  title: string;
  side: ICompareSide;
  /** Baseline-only chunks, rendered as dashed placeholders at the end. */
  removed?: ICompareDiffItem[];
  testId: string;
}) {
  return (
    <div className="rounded border border-border-default" data-testid={testId}>
      <div className="flex items-center justify-between border-b border-border-default px-3 py-2 text-xs text-text-secondary">
        <span className="font-medium text-text-primary">{title}</span>
        <span>
          {side.hits.length} 条 · {side.took_ms}ms
        </span>
      </div>
      <div className="max-h-[260px] overflow-auto p-2">
        {side.hits.length === 0 && (
          <div className="p-2 text-xs text-text-secondary">无命中</div>
        )}
        {side.hits.map((h) => (
          <HitRow key={h.chunk_id} hit={h} />
        ))}
        {removed && removed.length > 0 && (
          <>
            <div className="mt-2 px-2 text-[10px] text-text-secondary">
              未进入 Top-K（原名次保留）
            </div>
            {removed.map((it) => (
              <div
                key={it.chunk_id}
                className="mt-1 rounded border border-dashed border-border-default p-2 opacity-60"
              >
                <div className="flex items-center gap-2 text-xs text-text-secondary">
                  <span className="font-mono">#{it.rank}</span>
                  <span className="truncate">
                    {it.doc_keyword || it.chunk_id}
                  </span>
                  <span className="ml-auto font-mono">
                    {(it.similarity ?? 0).toFixed(3)}
                  </span>
                </div>
                <div className="mt-1 line-clamp-1 text-xs text-text-secondary">
                  {reasonLabel(it.reason)}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function HitRow({ hit }: { hit: ICompareHit }) {
  return (
    <div className="mb-1 rounded border border-border-default p-2">
      <div className="flex items-center gap-2 text-xs text-text-secondary">
        <span className="font-mono font-semibold text-text-primary">
          #{hit.rank}
        </span>
        <span className="truncate">{hit.doc_keyword || hit.chunk_id}</span>
        <span className="ml-auto font-mono">{hit.similarity.toFixed(3)}</span>
      </div>
      {hit.content && (
        <div className="mt-1 line-clamp-2 text-xs">{hit.content}</div>
      )}
    </div>
  );
}

function DiffSection({
  label,
  items,
  render,
}: {
  label: string;
  items: ICompareDiffItem[];
  render: (it: ICompareDiffItem) => string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="text-xs font-medium text-text-primary">{label}</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-text-secondary">
        {items.map((it) => (
          <li key={`${label}-${it.chunk_id}-${it.after_rank ?? it.rank ?? 0}`}>
            {render(it)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function reasonLabel(reason?: string) {
  switch (reason) {
    case 'pushed_out_of_topk':
      return '被挤出 TopK';
    case 'not_recalled':
      return '未被召回';
    default:
      return '';
  }
}

function fmtDelta(delta?: number) {
  if (delta === undefined || delta === null) return '';
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(4)}`;
}
