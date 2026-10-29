import { EmptyAppCard } from '@/components/empty/empty';
import { EmptyCardType } from '@/components/empty/constant';
import { Button } from '@/components/ui/button';
import { RAGFlowPagination } from '@/components/ui/ragflow-pagination';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import {
  LIST_MAX_DISPLAYED_PAGES,
  LIST_PAGE_SIZE_OPTIONS,
} from '@/constants/list-pagination';
import {
  RUN_SORT_OPTIONS,
  RUN_STATUS_OPTIONS,
  RUN_TRIGGER_OPTIONS,
  RunSortKey,
  useAgentTitleMap,
  useFetchRuns,
} from '@/hooks/use-run-request';
import { useDebounce } from 'ahooks';
import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { RunDetailDialog } from './run-detail-dialog';

const PAGE_SIZE = 12;

/**
 * 运行日志（产品文档 3.4）。
 *
 * 列出所有应用的运行记录，筛选项与排序项与两个列表页同源：
 *   筛选：搜索（run_id / 应用）· 应用 · 触发方式 · 状态
 *   排序：最近开始 / 耗时最长 / 耗时最短 / Token 最多
 *
 * 筛选与排序都落在 URL query 上，刷新与分享链接都能还原视图。
 */
export default function StudioRunsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const keywords = searchParams.get('keywords') ?? '';
  const status = searchParams.get('status') ?? '';
  const triggerType = searchParams.get('trigger_type') ?? '';
  const canvasId = searchParams.get('canvas_id') ?? '';
  const sort = (searchParams.get('sort') as RunSortKey) || 'created_desc';
  const page = Number(searchParams.get('page')) || 1;
  // The size changer writes `page_size`, so it has to be read back — using the
  // PAGE_SIZE default here made the selector look functional while every
  // request still asked for 12 rows.
  const pageSize = Number(searchParams.get('page_size')) || PAGE_SIZE;

  const [searchInput, setSearchInput] = useState(keywords);
  // 点行查看详情：存 run id，空值即关闭弹窗。
  const [selectedRunId, setSelectedRunId] = useState<string>();
  // 后端 canvas_title 未就绪时用它把 canvas_id 换成应用名。
  const agentTitleMap = useAgentTitleMap();
  const debouncedKeywords = useDebounce(searchInput, { wait: 400 });

  const update = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams);
    mutate(params);
    // 改任一筛选/排序都回到第 1 页。
    params.delete('page');
    setSearchParams(params);
  };

  const { runs, total, loading } = useFetchRuns({
    keywords: debouncedKeywords,
    canvasId,
    status,
    triggerType,
    sort,
    page,
    pageSize,
  });

  const hasFilter = !!(keywords || status || triggerType || canvasId);

  const resetFilters = () => {
    const params = new URLSearchParams(searchParams);
    ['keywords', 'status', 'trigger_type', 'canvas_id', 'page'].forEach((k) =>
      params.delete(k),
    );
    setSearchParams(params);
    setSearchInput('');
  };

  const statusBadge = useMemo(
    () => (value: string) => {
      if (value === 'succeeded') return 'text-accent-primary';
      if (value === 'failed') return 'text-red-600';
      return 'text-text-secondary';
    },
    [],
  );

  return (
    <section className="p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium text-text-primary">
            {t('studio.runLog')}
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            {t('studio.runLogSubtitle')}
          </p>
        </div>
      </header>

      {/* 工具栏：搜索 + 触发方式 + 状态 + 排序 + 重置 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Input
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              update((p) => {
                if (e.target.value) p.set('keywords', e.target.value);
                else p.delete('keywords');
              });
            }}
            placeholder={t('studio.runSearchPlaceholder')}
            data-testid="run-search"
            className="pr-8"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                update((p) => p.delete('keywords'));
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
              aria-label={t('common.clear')}
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <Select
          value={triggerType || 'all'}
          onValueChange={(v) =>
            update((p) => {
              if (v === 'all') p.delete('trigger_type');
              else p.set('trigger_type', v);
            })
          }
        >
          <SelectTrigger className="w-fit" data-testid="run-trigger-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('studio.runTriggerAll')}</SelectItem>
            {RUN_TRIGGER_OPTIONS.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {t(`studio.runTrigger.${opt}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={status || 'all'}
          onValueChange={(v) =>
            update((p) => {
              if (v === 'all') p.delete('status');
              else p.set('status', v);
            })
          }
        >
          <SelectTrigger className="w-fit" data-testid="run-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('studio.statusAll')}</SelectItem>
            {RUN_STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {t(`studio.runStatus.${opt}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={sort}
          onValueChange={(v) => update((p) => p.set('sort', v))}
        >
          <SelectTrigger className="w-fit" data-testid="run-sort-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RUN_SORT_OPTIONS.map((opt) => (
              <SelectItem key={opt.key} value={opt.key}>
                {t(opt.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={resetFilters}
            data-testid="run-reset-filter"
          >
            {t('studio.resetFilters')}
          </Button>
        )}
      </div>

      {runs.length === 0 && !loading ? (
        <EmptyAppCard type={EmptyCardType.Agent} onClick={() => undefined} />
      ) : (
        <div className="rounded-lg border border-border-default">
          <Table scroll="page">
            <TableHeader>
              <TableRow>
                <TableHead>{t('studio.colRunId')}</TableHead>
                <TableHead>{t('studio.colApp')}</TableHead>
                <TableHead>{t('studio.colTrigger')}</TableHead>
                <TableHead>{t('studio.colStatus')}</TableHead>
                <TableHead>{t('studio.colDuration')}</TableHead>
                <TableHead>{t('studio.colTokens')}</TableHead>
                <TableHead>{t('studio.colStartedAt')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow
                  key={run.id}
                  data-testid="run-table-row"
                  className="cursor-pointer hover:bg-background-second"
                  onClick={() => setSelectedRunId(run.id)}
                >
                  <TableCell className="font-mono text-xs">{run.id}</TableCell>
                  <TableCell className="text-xs">
                    {run.canvas_title ||
                      agentTitleMap[run.canvas_id] ||
                      run.canvas_id}
                  </TableCell>
                  <TableCell className="text-xs">
                    {t(`studio.runTrigger.${run.trigger_type}`)}
                  </TableCell>
                  <TableCell className={`text-xs ${statusBadge(run.status)}`}>
                    {t(`studio.runStatus.${run.status}`)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {run.duration_ms} ms
                  </TableCell>
                  <TableCell className="text-xs">
                    {run.prompt_tokens + run.completion_tokens}
                  </TableCell>
                  <TableCell className="text-xs text-text-secondary">
                    {new Date(run.create_time).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {total > 0 && (
        <div className="mt-4 flex justify-end">
          <RAGFlowPagination
            current={page}
            pageSize={pageSize}
            total={total}
            pageSizeOptions={LIST_PAGE_SIZE_OPTIONS}
            maxDisplayedPages={LIST_MAX_DISPLAYED_PAGES}
            onChange={(nextPage: number, nextSize?: number) => {
              const params = new URLSearchParams(searchParams);
              params.set('page', nextPage.toString());
              if (nextSize) params.set('page_size', nextSize.toString());
              setSearchParams(params);
            }}
          />
        </div>
      )}
      <RunDetailDialog
        runId={selectedRunId}
        onClose={() => setSelectedRunId(undefined)}
      />
    </section>
  );
}
