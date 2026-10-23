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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs-underlined';
import { PageContainer } from '@/layouts/components/page-container';
import { ConsultationsPanel } from '@/pages/analytics/consultations';
import { AnalyticsStatsPanel } from '@/pages/analytics/stats';
import {
  BarChart3,
  Bot,
  FileText,
  Layers,
  type LucideIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MetricCard } from './metric-card';
import { SourceDonutChart } from './source-donut-chart';
import { RecentActivities } from './recent-activities';
import { TrendAreaChart } from './trend-area-chart';
import { TREND_DAYS } from './constants';
import { useOverviewQueries } from './hook';
import {
  buildSourceDistribution,
  buildTrend,
  calcDelta,
  seriesSum,
  splitRecentAndPrevious,
  sumDatasetField,
} from './utils';
import type { IOverviewMetric } from './interface';

// Tab triggers sit outside the `overview` key prefix, so they use the root
// translator while the sheet body keeps using the prefixed one.
const TAB_TRIGGER_CLASS =
  'h-10 flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-4 text-sm font-normal shadow-none data-[state=active]:border-text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none';

export default function Overview() {
  const { t } = useTranslation('translation', { keyPrefix: 'overview' });
  const { t: tRoot } = useTranslation();
  const [datasetsQ, agentQ, statsQ, suffixQ] = useOverviewQueries(TREND_DAYS);

  const datasets = datasetsQ.data ?? [];
  const stats = statsQ.data;

  const pvRecent = useMemo(() => splitRecentAndPrevious(stats?.pv), [stats?.pv]);
  const tokensRecent = useMemo(
    () => splitRecentAndPrevious(stats?.tokens),
    [stats?.tokens],
  );

  /** 点赞率作为「满意度」替代指标：系统未记录检索评测打分，只有交互反馈可用。 */
  const satisfaction = useMemo(() => {
    const likes = seriesSum(stats?.thumb_up);
    const calls = seriesSum(stats?.pv);
    if (calls <= 0) return null;
    return (likes / calls) * 100;
  }, [stats?.thumb_up, stats?.pv]);

  const metrics: IOverviewMetric[] = useMemo(() => {
    const build = (
      key: string,
      label: string,
      value: number,
      icon: LucideIcon,
      delta: number | null,
      unit?: string,
    ): IOverviewMetric => ({ key, label, value, icon, delta, unit });

    return [
      build(
        'datasets',
        t('metric.datasets'),
        datasets.length,
        Layers,
        null,
        t('unit.dataset'),
      ),
      build(
        'documents',
        t('metric.documents'),
        sumDatasetField(datasets, 'document_count'),
        FileText,
        null,
        t('unit.document'),
      ),
      build(
        'chunks',
        t('metric.chunks'),
        sumDatasetField(datasets, 'chunk_count'),
        BarChart3,
        null,
        t('unit.chunk'),
      ),
      build(
        'calls',
        t('metric.calls'),
        seriesSum(stats?.pv),
        Bot,
        calcDelta(pvRecent.recent, pvRecent.previous),
        t('unit.times'),
      ),
    ];
  }, [datasets, stats?.pv, pvRecent, t]);

  const trend = useMemo(() => buildTrend(stats?.pv), [stats?.pv]);
  const sourceDistribution = useMemo(
    () => buildSourceDistribution(suffixQ.data),
    [suffixQ.data],
  );

  const cardsLoading = datasetsQ.isPending || agentQ.isPending;
  const statsLoading = statsQ.isPending;

  return (
    <PageContainer>
      <Tabs defaultValue="overview" className="gap-6">
        <TabsList className="h-10 w-fit gap-1 rounded-none border-b border-border-default bg-transparent p-0">
          <TabsTrigger value="overview" className={TAB_TRIGGER_CLASS}>
            {tRoot('header.home')}
          </TabsTrigger>
          <TabsTrigger value="stats" className={TAB_TRIGGER_CLASS}>
            {tRoot('analytics.report')}
          </TabsTrigger>
          <TabsTrigger value="consultations" className={TAB_TRIGGER_CLASS}>
            {tRoot('analytics.consultationLog')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="flex flex-col gap-6">
        {/* 页头不再重复「系统总览 / 客服中心 · 知识库运营数据看板」：
            左侧菜单已经标出当前位置，副标题也不含任何可操作信息，
            占掉首屏一块高度却只重复一句品牌话术。 */}

        {/* 指标卡片 */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <MetricCard
              key={metric.key}
              metric={metric}
              loading={metric.key === 'calls' ? statsLoading : cardsLoading}
            />
          ))}
        </section>

        {/* 满意度 + Agent 数量 */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-xl border border-border-default bg-bg-base px-5 py-4">
            <div>
              <p className="text-sm text-text-secondary">
                {t('metric.satisfaction')}
              </p>
              <p className="mt-1.5 flex items-baseline gap-1 text-2xl font-semibold text-text-primary">
                {satisfaction === null ? '—' : satisfaction.toFixed(1)}
                {satisfaction !== null && (
                  <span className="text-sm font-normal text-text-secondary">
                    %
                  </span>
                )}
              </p>
            </div>
            <span className="text-xs text-text-disabled">
              {t('satisfactionHint')}
            </span>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border-default bg-bg-base px-5 py-4">
            <div>
              <p className="text-sm text-text-secondary">
                {t('metric.tokens')}
              </p>
              <p className="mt-1.5 flex items-baseline gap-1 text-2xl font-semibold text-text-primary">
                {seriesSum(stats?.tokens).toLocaleString('en-US')}
                <span className="text-sm font-normal text-text-secondary">
                  {t('unit.token')}
                </span>
              </p>
            </div>
            <span className="text-xs text-text-disabled">
              {calcDelta(tokensRecent.recent, tokensRecent.previous) === null
                ? t('satisfactionHint')
                : `${t('metric.agentCount')} ${agentQ.data ?? 0}`}
            </span>
          </div>
        </section>

        {/* 图表区 */}
        {/* 图表区定高：三列共用一个行高，最近动态在内部滚动播放，
            否则动态条数一多就把整页撑长，其他内容要滚半天才看得到。 */}
        <section className="grid grid-cols-1 gap-4 xl:h-[360px] xl:grid-cols-[minmax(0,300px)_minmax(0,1fr)_minmax(0,420px)]">
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border-default bg-bg-base p-5">
            <h2 className="mb-4 shrink-0 text-base font-medium text-text-primary">
              {t('chart.sourceTitle')}
            </h2>
            <SourceDonutChart
              data={sourceDistribution}
              totalLabel={t('chart.sourceTotal')}
              loading={suffixQ.isPending}
            />
          </div>

          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border-default bg-bg-base p-5">
            <h2 className="mb-4 shrink-0 text-base font-medium text-text-primary">
              {t('chart.trendTitle', { days: TREND_DAYS })}
            </h2>
            <TrendAreaChart
              data={trend}
              loading={statsLoading}
              emptyHint={t('chart.trendEmptyHint')}
            />
          </div>

          <RecentActivities />
        </section>
          </div>
        </TabsContent>

        <TabsContent value="stats">
          <AnalyticsStatsPanel embedded />
        </TabsContent>

        <TabsContent value="consultations">
          <ConsultationsPanel embedded />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
