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

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageContainer } from '@/layouts/components/page-container';
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

/** 没有数据时统一显示破折号，不用 0 冒充真实值。 */
function pct(v: number | null | undefined) {
  if (v === null || v === undefined) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function seconds(ms: number | null | undefined) {
  if (ms === null || ms === undefined || ms <= 0) return '—';
  return `${(ms / 1000).toFixed(1)}s`;
}

function count(v: number | null | undefined) {
  if (v === null || v === undefined) return '—';
  return String(v);
}

function deltaText(v: number | undefined, isRatio = false) {
  if (v === undefined || v === null) return null;
  const sign = v >= 0 ? '+' : '';
  const value = (v * 100).toFixed(1);
  return `${sign}${value}${isRatio ? 'pp' : '%'}`;
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
  const good = (delta ?? 0) >= 0;

  return (
    <div
      className="rounded-lg border border-border-default px-3 py-3"
      title={hint}
    >
      <div className="flex items-center gap-1 text-xs text-text-secondary">
        <span className="truncate">{label}</span>
        {hint && (
          <span className="cursor-help text-text-disabled" aria-hidden>
            ⓘ
          </span>
        )}
      </div>
      <div className="mt-1.5 text-xl font-semibold text-text-primary">
        {value}
      </div>
      {text && (
        <div
          className={`mt-1 text-xs ${
            good ? 'text-state-success' : 'text-state-error'
          }`}
        >
          {text}
        </div>
      )}
    </div>
  );
}

/**
 * TrendChart draws the consultation volume bars and the positive-rate line on
 * one canvas.
 *
 * Hand-rolled SVG rather than a chart library: the shape is fixed (two series,
 * shared x axis) and this keeps a heavyweight dependency out of the bundle.
 * For very long ranges the bar width shrinks instead of the chart growing.
 */
function TrendChart({ points }: { points: IAnalyticsTrendPoint[] }) {
  const W = 720;
  const H = 250;
  const padL = 44;
  const padR = 44;
  const padT = 18;
  const padB = 34;

  const maxVol = Math.max(1, ...points.map((p) => p.consultations));
  const x = (i: number) =>
    points.length <= 1
      ? (W - padR + padL) / 2
      : padL + ((W - padL - padR) * i) / (points.length - 1);
  const yVol = (v: number) => H - padB - ((H - padT - padB) * v) / maxVol;
  const yRate = (r: number) => H - padB - ((H - padT - padB) * r) / 1;

  const barW = Math.max(
    6,
    Math.min(28, ((W - padL - padR) / Math.max(1, points.length)) * 0.5),
  );

  // 好评率为 null 表示当天没有评价，折线必须断开：连到 0 会被误读成
  // 「好评率暴跌至 0%」。至少两个点才成段。
  const rateSegments: string[][] = [];
  let segment: string[] = [];
  points.forEach((p, i) => {
    if (p.good_rate == null) {
      if (segment.length > 1) rateSegments.push(segment);
      segment = [];
    } else {
      segment.push(`${x(i)},${yRate(p.good_rate)}`);
    }
  });
  if (segment.length > 1) rateSegments.push(segment);

  // 最多显示 7 个日期标签，30 天时不会挤在一起。
  const labelStep = Math.max(1, Math.ceil(points.length / 7));
  const ticks = [0, 0.5, 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-[250px] w-full"
      role="img"
      aria-label="consultation trend"
    >
      {/* 横向网格 + 左轴刻度（咨询量） */}
      {ticks.map((ratio) => {
        const y = yVol(maxVol * ratio);
        return (
          <g key={`t-${ratio}`}>
            <line
              x1={padL}
              y1={y}
              x2={W - padR}
              y2={y}
              stroke="var(--border-default)"
              strokeDasharray="3 4"
            />
            <text
              x={padL - 8}
              y={y + 3}
              textAnchor="end"
              fill="var(--text-disabled)"
              fontSize="10"
            >
              {Math.round(maxVol * ratio)}
            </text>
          </g>
        );
      })}

      {/* 右轴刻度（好评率） */}
      {ticks.map((ratio) => (
        <text
          key={`r-${ratio}`}
          x={W - padR + 8}
          y={yVol(maxVol * ratio) + 3}
          textAnchor="start"
          fill="var(--text-disabled)"
          fontSize="10"
        >
          {Math.round(ratio * 100)}%
        </text>
      ))}

      {/* 咨询量柱 */}
      {points.map((p, i) => {
        const y = yVol(p.consultations);
        return (
          <rect
            key={`b-${p.date}`}
            x={x(i) - barW / 2}
            y={y}
            width={barW}
            height={Math.max(1, H - padB - y)}
            rx={3}
            fill="rgb(var(--accent-primary))"
            fillOpacity={0.22}
          >
            <title>{`${p.date} · 咨询 ${p.consultations} · 好评 ${pct(p.good_rate)}`}</title>
          </rect>
        );
      })}

      {/* 好评率折线：按无数据点断开 */}
      {rateSegments.map((seg, idx) => (
        <polyline
          key={`l-${idx}`}
          points={seg.join(' ')}
          fill="none"
          stroke="rgb(var(--accent-primary))"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      ))}
      {points.map((p, i) =>
        p.good_rate == null ? null : (
          <circle
            key={`d-${p.date}`}
            cx={x(i)}
            cy={yRate(p.good_rate)}
            r={3}
            fill="rgb(var(--accent-primary))"
          >
            <title>{`${p.date} · 好评率 ${pct(p.good_rate)}`}</title>
          </circle>
        ),
      )}

      {/* X 轴日期 */}
      {points.map((p, i) =>
        i % labelStep === 0 || i === points.length - 1 ? (
          <text
            key={`x-${p.date}`}
            x={x(i)}
            y={H - 12}
            textAnchor="middle"
            className="fill-text-disabled"
            fontSize="10"
          >
            {p.date.slice(5)}
          </text>
        ) : null,
      )}

      <line
        x1={padL}
        y1={H - padB}
        x2={W - padR}
        y2={H - padB}
        stroke="var(--border-default)"
      />
    </svg>
  );
}

/**
 * AnalyticsStatsPanel is the embeddable body of the report page. Like the
 * consultation panel it avoids page-level padding so the home page can host it
 * inside a tab without double spacing.
 */
export function AnalyticsStatsPanel({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const [rangeKey, setRangeKey] = useState<RangeKey>('7d');
  const [stats, setStats] = useState<IAnalyticsStats | null>(null);
  const [trend, setTrend] = useState<IAnalyticsTrendPoint[]>([]);
  const [apps, setApps] = useState<IAnalyticsAppRow[]>([]);
  const [loading, setLoading] = useState(false);

  const range = useMemo(() => {
    const days = RANGES.find((r) => r.key === rangeKey)?.days ?? 6;
    return rangeDates(days);
  }, [rangeKey]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, trendRes, appsRes] = await Promise.all([
        analyticsService.getStats(range),
        analyticsService.getTrend(range),
        analyticsService.getApps(range),
      ]);
      setStats(statsRes?.data?.data ?? null);
      setTrend(trendRes?.data?.data?.points ?? []);
      setApps(appsRes?.data?.data?.rows ?? []);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const metrics = stats?.metrics;
  // 两条链路的耗时口径不同（首包 vs 总耗时），有数据的那条优先，不混算。
  const responseValue = seconds(
    metrics?.response_ms.chat ?? metrics?.response_ms.canvas ?? null,
  );

  return (
    <div
      className={
        embedded ? 'flex flex-col gap-4' : 'flex flex-col gap-4 p-5'
      }
    >
      <div className="flex items-center gap-3">
        {!embedded && (
          <h1 className="text-xl font-medium text-text-primary">
            {t('analytics.report')}
          </h1>
        )}
        <span className="flex-1" />
        <div className="inline-flex overflow-hidden rounded-md border border-border-default">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRangeKey(r.key)}
              className={`h-8 px-3 text-sm transition-colors ${
                rangeKey === r.key
                  ? 'bg-accent-primary text-bg-base'
                  : 'bg-bg-base text-text-secondary hover:bg-bg-card'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        <MetricCard
          label={t('analytics.metricConsultations')}
          value={count(metrics?.consultations)}
          delta={stats?.deltas.consultations}
          hint={t('analytics.metricConsultationsHint')}
        />
        <MetricCard
          label={t('analytics.metricCustomers')}
          value={count(metrics?.customers)}
          delta={stats?.deltas.customers}
          hint={t('analytics.metricCustomersHint')}
        />
        <MetricCard
          label={t('analytics.metricResponse')}
          value={responseValue}
          hint={t('analytics.metricResponseHint')}
        />
        <MetricCard
          label={t('analytics.metricGoodRate')}
          value={pct(metrics?.good_rate)}
          delta={stats?.deltas.good_rate}
          deltaIsRatio
          hint={t('analytics.metricGoodRateHint')}
        />
        <MetricCard
          label={t('analytics.metricSuccessRate')}
          value={pct(metrics?.success_rate)}
          delta={stats?.deltas.success_rate}
          deltaIsRatio
          hint={t('analytics.metricSuccessRateHint')}
        />
        <MetricCard
          label={t('analytics.metricRounds')}
          value={
            metrics?.avg_rounds && metrics.avg_rounds > 0
              ? metrics.avg_rounds.toFixed(1)
              : '—'
          }
          hint={t('analytics.metricRoundsHint')}
        />
        <MetricCard
          label={t('analytics.metricBadCount')}
          value={count(metrics?.bad_count)}
          hint={t('analytics.metricBadCountHint')}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-5">
        <div className="rounded-lg border border-border-default bg-bg-base p-4 xl:col-span-3">
          <div className="mb-2 flex items-center gap-3">
            <span className="text-sm font-medium text-text-primary">
              {t('analytics.trendTitle')}
            </span>
            <span className="ml-auto flex items-center gap-3 text-xs text-text-secondary">
              <span className="flex items-center gap-1">
                <span className="inline-block size-2.5 rounded-sm bg-accent-primary/40" />
                {t('analytics.metricConsultations')}
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-0.5 w-3 bg-accent-primary" />
                {t('analytics.metricGoodRate')}
              </span>
            </span>
          </div>
          {trend.length === 0 ? (
            <div className="flex h-[250px] items-center justify-center text-sm text-text-disabled">
              {loading ? '…' : t('analytics.empty')}
            </div>
          ) : (
            <TrendChart points={trend} />
          )}
        </div>

        <div className="rounded-lg border border-border-default bg-bg-base xl:col-span-2">
          <div className="border-b border-border-default px-4 py-2.5 text-sm font-medium text-text-primary">
            {t('analytics.appBreakdown')}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">{t('analytics.app')}</TableHead>
                <TableHead className="w-16 text-right">
                  {t('analytics.metricConsultations')}
                </TableHead>
                <TableHead className="w-16 text-right">
                  {t('analytics.metricCustomers')}
                </TableHead>
                <TableHead className="w-16 text-right">
                  {t('analytics.metricResponse')}
                </TableHead>
                <TableHead className="w-20 pr-4 text-right">
                  {t('analytics.metricGoodRate')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apps.map((a) => (
                <TableRow key={a.app_id}>
                  <TableCell className="max-w-0 truncate pl-4 text-text-primary">
                    {a.app_name || a.app_id}
                  </TableCell>
                  <TableCell className="text-right text-text-primary">
                    {a.consultations}
                  </TableCell>
                  <TableCell className="text-right text-text-secondary">
                    {a.customers}
                  </TableCell>
                  <TableCell className="text-right text-text-secondary">
                    {seconds(a.response_ms)}
                  </TableCell>
                  <TableCell className="pr-4 text-right text-text-secondary">
                    {pct(a.good_rate)}
                  </TableCell>
                </TableRow>
              ))}
              {apps.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-8 text-center text-sm text-text-disabled"
                  >
                    {t('analytics.empty')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="rounded-lg border border-border-default bg-bg-base p-4 text-xs leading-6 text-text-secondary">
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
