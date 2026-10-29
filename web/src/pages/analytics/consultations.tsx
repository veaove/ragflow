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
import { useTranslation } from 'react-i18next';

import { PageContainer } from '@/layouts/components/page-container';

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
import {
  analyticsService,
  IConsultationDetail,
  IConsultationLogItem,
} from '@/services/analytics-service';

import { appTypeLabelKey } from './app-type';

const RATING_OPTIONS = [
  { value: '', label: '全部评价' },
  { value: 'good', label: '好评' },
  { value: 'bad', label: '差评' },
  { value: 'none', label: '未评价' },
];

const PAGE_SIZE = 20;

function todayMinus(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function formatTime(ms: number) {
  if (!ms) return '-';
  return new Date(ms).toLocaleString();
}

function RatingTag({ rating }: { rating: string }) {
  if (rating === 'good') {
    return (
      <span className="rounded bg-state-success-5 px-1.5 py-0.5 text-xs text-state-success">
        👍 好评
      </span>
    );
  }
  if (rating === 'bad') {
    return (
      <span className="rounded bg-state-error-5 px-1.5 py-0.5 text-xs text-state-error">
        👎 差评
      </span>
    );
  }
  return (
    <span className="rounded bg-bg-base px-1.5 py-0.5 text-xs text-text-disabled">
      未评价
    </span>
  );
}

/**
 * ConsultationsPanel is the embeddable body of the consultation log. It carries
 * no page-level padding or title so it can sit inside the home page tab strip
 * as well as inside its own standalone route.
 */
export function ConsultationsPanel({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const { t } = useTranslation();

  const [from, setFrom] = useState(todayMinus(6));
  const [to, setTo] = useState(todayMinus(0));
  const [rating, setRating] = useState('');
  const [keyword, setKeyword] = useState('');

  const [items, setItems] = useState<IConsultationLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);

  const [detail, setDetail] = useState<IConsultationDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const query = useMemo(
    () => ({
      from,
      to,
      rating: rating || undefined,
      keyword: keyword || undefined,
    }),
    [from, to, rating, keyword],
  );

  const reload = useCallback(
    async (nextPage: number) => {
      setLoading(true);
      try {
        const res = await analyticsService.listConsultations({
          ...query,
          page: nextPage,
          size: pageSize,
        });
        const payload = res?.data?.data ?? {};
        setItems(payload.items ?? []);
        setTotal(res?.data?.total ?? 0);
      } finally {
        setLoading(false);
      }
    },
    [query, pageSize],
  );

  // `reload` is rebuilt whenever the filters or the page size change, so this
  // one effect covers both "filters changed" and "picked a new page size": each
  // of them invalidates the current offset, hence the explicit reload(1).
  useEffect(() => {
    setPage(1);
    void reload(1);
  }, [reload]);

  const openDetail = useCallback(async (item: IConsultationLogItem) => {
    const res = await analyticsService.getConsultation(
      item.session_id,
      item.chain,
    );
    setDetail(res?.data?.data ?? null);
    setDetailOpen(true);
  }, []);

  const onExport = useCallback(() => {
    window.open(analyticsService.exportUrl(query), '_blank');
  }, [query]);

  return (
    <div
      className={embedded ? 'flex h-full flex-col' : 'flex h-full flex-col p-5'}
    >
      <div className="mb-4 flex items-center gap-3">
        {!embedded && (
          <>
            <h1 className="text-xl font-medium">
              {t('analytics.consultationLog')}
            </h1>
            <span className="text-sm text-text-disabled">
              {t('analytics.consultationLogHint')}
            </span>
          </>
        )}
        <span className="flex-1" />
        <Button variant="outline" onClick={onExport}>
          {t('analytics.export')}
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="w-40"
        />
        <span className="text-text-disabled">~</span>
        <Input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="w-40"
        />
        <select
          className="h-8 rounded-md border border-border-default bg-bg-base px-2 text-sm"
          value={rating}
          onChange={(e) => setRating(e.target.value)}
        >
          {RATING_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Input
          placeholder={t('analytics.keywordPlaceholder')}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="w-64"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border-default bg-bg-base">
        <Table scroll="page">
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">
                {t('analytics.customerId')}
              </TableHead>
              <TableHead className="w-36">{t('analytics.app')}</TableHead>
              <TableHead className="w-24">{t('analytics.appType')}</TableHead>
              <TableHead className="w-44">{t('analytics.time')}</TableHead>
              <TableHead className="w-20">{t('analytics.rounds')}</TableHead>
              <TableHead className="w-24">{t('analytics.rating')}</TableHead>
              <TableHead className="w-20">{t('analytics.response')}</TableHead>
              <TableHead>{t('analytics.firstQuestion')}</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((it) => (
              <TableRow key={`${it.chain}-${it.session_id}`}>
                <TableCell className="font-mono text-xs">
                  {it.customer_id || '-'}
                </TableCell>
                <TableCell>{it.app_name || '-'}</TableCell>
                <TableCell className="text-text-secondary">
                  {it.app_type ? t(appTypeLabelKey(it.app_type)) : '-'}
                </TableCell>
                <TableCell className="text-text-secondary">
                  {formatTime(it.start_time)}
                </TableCell>
                <TableCell className="text-text-secondary">
                  {it.rounds}
                </TableCell>
                <TableCell>
                  <RatingTag rating={it.rating} />
                </TableCell>
                <TableCell className="text-text-secondary">
                  {it.duration_ms > 0
                    ? `${(it.duration_ms / 1000).toFixed(1)}s`
                    : '—'}
                </TableCell>
                <TableCell className="max-w-0 truncate text-text-secondary">
                  {it.first_question || '-'}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-accent-primary"
                    onClick={() => openDetail(it)}
                  >
                    {t('analytics.detail')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!loading && items.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="py-10 text-center text-text-disabled"
                >
                  {t('analytics.empty')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-3 flex justify-end">
        <RAGFlowPagination
          current={page}
          pageSize={pageSize}
          total={total}
          onChange={(p, nextSize) => {
            if (nextSize && nextSize !== pageSize) {
              // The reset effect above reloads page 1 with the new size; calling
              // reload(p) here would fetch twice.
              setPageSize(nextSize);
            } else {
              setPage(p);
              void reload(p);
            }
          }}
        />
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t('analytics.sessionDetail')}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="max-h-[60vh] overflow-auto">
              <div className="mb-3 text-sm text-text-secondary">
                {t('analytics.customerId')}：{detail.customer_id || '-'} ·{' '}
                {detail.app_name || '-'} · {detail.rounds}{' '}
                {t('analytics.roundsUnit')}
              </div>
              <div className="flex flex-col gap-4">
                {detail.turns.map((turn) => (
                  <div
                    key={turn.position}
                    className={
                      turn.role === 'user'
                        ? 'self-end rounded-lg bg-text-primary px-3 py-2 text-sm text-bg-base'
                        : 'self-start rounded-lg border border-border-default px-3 py-2 text-sm'
                    }
                  >
                    <div className="mb-1 text-xs opacity-70">
                      {turn.role === 'user'
                        ? t('analytics.customer')
                        : t('analytics.ai')}
                      {turn.duration_ms > 0
                        ? ` · ${(turn.duration_ms / 1000).toFixed(1)}s`
                        : ''}
                    </div>
                    <div className="whitespace-pre-wrap">{turn.content}</div>
                    {turn.feedback && (
                      <div className="mt-2 rounded bg-state-warning-5 px-2 py-1 text-xs text-state-warning">
                        {turn.feedback}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function ConsultationsPage() {
  return (
    <PageContainer>
      <ConsultationsPanel />
    </PageContainer>
  );
}
