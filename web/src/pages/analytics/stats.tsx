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
  IAnalyticsAppRow,
  IAnalyticsStats,
  IAnalyticsTrendPoint,
} from '@/services/analytics-service';

type RangeKey = 'today' | '7d' | '30d';

const RANGES: { key: RangeKey; days: number; label: string }[] = [
  { key: 'today', days: 0, label: '今天' },
  { key: '7d', days: 6, label: '近 7 天' },
  { key: '30d', days: 29, label: '近 30 天' },
];

function rangeDates(days: number) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}

function pct(v: number | null | undefined) {
  if (v === null || v === undefined) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function deltaText(v: number | undefined, isRatio = false) {
  if (v === undefined || v === null) return null;
  const sign = v >= 0 ? '+' : '';
  const unit = isRatio ? 'pp' : '%';
  return `${sign}${isRatio ? (v * 100).toFixed(1) : (v * 100).toFixed(1)}${unit}`;
}

function MetricCard({
  label,
  value,
  delta,
  hint,
  deltaIsRatio,
}: {
  label: string;
  value: string;
  delta?: number;
  hint?: string;
  deltaIsRatio?: boolean;
}) {
  const text = deltaText(delta, deltaIsRatio);
  const positive = (delta ?? 0) >= 0;
  return (
    <div
      className="rounded-lg border border-border-default bg-bg-base px-3 py-3"
      title={hint}
    >
      <div className="text-xs text-text-disabled">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      {text && (
        <div
          className={`mt-1 text-xs ${
            positive ? 'text-state-success' : 'text-state-error'
          }`}
        >
          {text}
        </div>
      )}
    </div>
  );
}

/**
 * AnalyticsStatsPanel is the embeddable body of the report page. Like the
 * consultation panel it avoids page-level padding so the home page can host it
 * inside a tab without double spacing.
 */
export function AnalyticsStatsPanel({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  const [rangeKey, setRangeKey] = useState<RangeKey>('7d');
  const [stats, setStats] = useState<IAnalyticsStats | null>(null);
  const [trend, setTrend] = useState<IAnalyticsTrendPoint[]>([]);
  const [apps, setApps] = useState<IAnalyticsAppRow[]>([]);

  const range = useMemo(() => {
    const days = RANGES.find((r) => r.key === rangeKey)?.days ?? 6;
    return rangeDates(days);
  }, [rangeKey]);

  const reload = useCallback(async () => {
    const [statsRes, trendRes, appsRes] = await Promise.all([
      analyticsService.getStats(range),
      analyticsService.getTrend(range),
      analyticsService.getApps(range),
    ]);
    setStats(statsRes?.data?.data ?? null);
    setTrend(trendRes?.data?.data?.points ?? []);
    setApps(appsRes?.data?.data?.rows ?? []);
  }, [range]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const maxConsultations = Math.max(1, ...trend.map((p) => p.consultations));

  return (
    <div className={embedded ? 'flex h-full flex-col' : 'flex h-full flex-col p-5'}>
      <div className="mb-4 flex items-center gap-3">
        {!embedded && <h1 className="text-xl font-medium">{t('analytics.report')}</h1>}
        <span className="flex-1" />
        <div className="inline-flex overflow-hidden rounded-md border border-border-default">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRangeKey(r.key)}
              className={`h-8 px-3 text-sm ${
                rangeKey === r.key
                  ? 'bg-text-primary text-bg-base'
                  : 'bg-bg-base text-text-secondary'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-7 gap-2">
        <MetricCard
          label={t('analytics.metricConsultations')}
          value={String(stats?.metrics.consultations ?? 0)}
          delta={stats?.deltas.consultations}
          hint={t('analytics.metricConsultationsHint')}
        />
        <MetricCard
          label={t('analytics.metricCustomers')}
          value={String(stats?.metrics.customers ?? 0)}
          delta={stats?.deltas.customers}
          hint={t('analytics.metricCustomersHint')}
        />
        <MetricCard
          label={t('analytics.metricResponse')}
          value={
            stats
              ? `${(Math.max(stats.metrics.response_ms.chat, stats.metrics.response_ms.canvas) / 1000).toFixed(1)}s`
              : '—'
          }
          hint={t('analytics.metricResponseHint')}
        />
        <MetricCard
          label={t('analytics.metricGoodRate')}
          value={pct(stats?.metrics.good_rate)}
          delta={stats?.deltas.good_rate}
          deltaIsRatio
          hint={t('analytics.metricGoodRateHint')}
        />
        <MetricCard
          label={t('analytics.metricSuccessRate')}
          value={pct(stats?.metrics.success_rate)}
          delta={stats?.deltas.success_rate}
          deltaIsRatio
          hint={t('analytics.metricSuccessRateHint')}
        />
        <MetricCard
          label={t('analytics.metricRounds')}
          value={String(stats?.metrics.avg_rounds ?? 0)}
          hint={t('analytics.metricRoundsHint')}
        />
        <MetricCard
          label={t('analytics.metricTokens')}
          value={String(stats?.metrics.tokens ?? 0)}
          hint={t('analytics.metricTokensHint')}
        />
      </div>

      <div className="grid grid-cols-5 gap-3">
        <div className="col-span-3 rounded-lg border border-border-default bg-bg-base p-3">
          <div className="mb-3 text-sm font-medium">{t('analytics.trendTitle')}</div>
          <div className="flex h-40 items-end gap-1">
            {trend.map((p) => (
              <div key={p.date} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full rounded-t bg-text-accent opacity-70"
                  style={{
                    height: `${Math.max(2, (p.consultations / maxConsultations) * 130)}px`,
                  }}
                  title={`${p.date} · ${p.consultations}`}
                />
                <span className="text-[10px] text-text-disabled">
                  {p.date.slice(5)}
                </span>
              </div>
            ))}
            {trend.length === 0 && (
              <div className="w-full text-center text-sm text-text-disabled">
                {t('analytics.empty')}
              </div>
            )}
          </div>
        </div>

        <div className="col-span-2 rounded-lg border border-border-default bg-bg-base">
          <div className="border-b border-border-default px-3 py-2 text-sm font-medium">
            {t('analytics.appBreakdown')}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('analytics.app')}</TableHead>
                <TableHead className="w-16">{t('analytics.metricConsultations')}</TableHead>
                <TableHead className="w-16">{t('analytics.metricCustomers')}</TableHead>
                <TableHead className="w-20">{t('analytics.metricGoodRate')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apps.map((a) => (
                <TableRow key={a.app_id}>
                  <TableCell className="max-w-0 truncate">{a.app_name || a.app_id}</TableCell>
                  <TableCell>{a.consultations}</TableCell>
                  <TableCell>{a.customers}</TableCell>
                  <TableCell>{pct(a.good_rate)}</TableCell>
                </TableRow>
              ))}
              {apps.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-text-disabled">
                    {t('analytics.empty')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-border-default bg-bg-base p-3 text-xs leading-6 text-text-secondary">
        <div className="mb-1 text-sm font-medium text-text-primary">
          {t('analytics.caliberTitle')}
        </div>
        <div>· {t('analytics.caliberConsultations')}</div>
        <div>· {t('analytics.caliberCustomers')}</div>
        <div>· {t('analytics.caliberResponse')}</div>
        <div>· {t('analytics.caliberGoodRate')}</div>
        <div>· {t('analytics.caliberSuccessRate')}</div>
      </div>
    </div>
  );
}

export default function AnalyticsStatsPage() {
  return (
    <PageContainer>
      <AnalyticsStatsPanel />
    </PageContainer>
  );
}
