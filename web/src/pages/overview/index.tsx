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
import { useQuery } from '@tanstack/react-query';
import request from '@/utils/request';
import { ConsultationsPanel } from '@/pages/analytics/consultations';
import { AnalyticsStatsPanel } from '@/pages/analytics/stats';
import {
  BarChart3,
  Bot,
  FileText,
  Folder,
  Layers,
  User,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useFetchTenantInfo } from '@/hooks/use-user-setting-request';
import { MetricCard } from './metric-card';
import { SourceDonutChart } from './source-donut-chart';
import { RecentActivities } from './recent-activities';
import { TrendAreaChart } from './trend-area-chart';
import { TREND_DAYS } from './constants';
import { useOverviewQueries } from './hook';
import {
  buildDualTrend,
  buildSourceDistribution,
  calcDelta,
  formatThousand,
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
  const { data: tenantInfo } = useFetchTenantInfo();
  const tenantId = tenantInfo?.tenant_id as string | undefined;
  const [datasetsQ, agentQ, statsQ, suffixQ, activityQ, departmentsQ] =
    useOverviewQueries(TREND_DAYS, tenantId);

  // `?? []` 每次渲染都会新建数组：不固定住的话，依赖它的两个 useMemo
  // 会每帧重算，oxlint 的 exhaustive-deps 也会一直报警。
  const datasets = useMemo(() => datasetsQ.data ?? [], [datasetsQ.data]);
  const stats = statsQ.data;
  const activity = activityQ.data ?? null;
  const departments = departmentsQ.data ?? null;
  const agentSummary = agentQ.data ?? null;

  const agentCallsRecent = useMemo(
    () => splitRecentAndPrevious(stats?.agent_calls),
    [stats?.agent_calls],
  );

  /**
   * 交互满意度改为展示「点赞数 / 点踩数」。
   *
   * 之前是 thumb_up / pv（API 调用），而网页端聊天不计入 pv，
   * 所以只要用户在用网页对话，这个卡片就永远是「—」。
   * 现在直接统计网页对话消息上的真实反馈。
   */
  const feedbackQ = useQuery({
    queryKey: ['feedbackStats'],
    queryFn: async () => {
      const { data } = await request.get('/api/v1/system/feedback-stats');
      return data?.data as { up: number; down: number } | undefined;
    },
  });
  const satisfaction = feedbackQ.data ?? null;

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
        // 统计智能体调用（agent_run）。原来的 pv 来自 api_4_conversation
        // （API Key 调用），网页端用智能体完全不计入，一直显示 0。
        seriesSum(stats?.agent_calls),
        Bot,
        calcDelta(agentCallsRecent.recent, agentCallsRecent.previous),
        t('unit.times'),
      ),
    ];
  }, [datasets, stats?.agent_calls, agentCallsRecent, t]);

  /**
   * 第二排：组织与配置规模（成员 / 部门 / 知识库 / 智能体）。
   *
   * 这四张卡没有「上一周期」的可比口径，底部副文案固定用当前值的派生说明，
   * 而不是涨跌幅——否则会长期停在「较上周期无对比数据」。
   *
   * 顺手把一直拉了却没用上的 agent 数量接到「智能体数」上。
   */
  const scaleCards = useMemo(() => {
    const build = (
      key: string,
      label: string,
      value: number | null,
      icon: LucideIcon,
      tone: IOverviewMetric['tone'],
      hint: string,
      loading: boolean,
    ): { metric: IOverviewMetric; loading: boolean } => ({
      metric: { key, label, value, icon, delta: null, hint, tone },
      loading,
    });

    const documentTotal = sumDatasetField(datasets, 'document_count');

    return [
      build(
        'members',
        t('metric.members'),
        activity?.total_users ?? null,
        User,
        'blue',
        activity
          ? t('hint.membersActive', {
              days: TREND_DAYS,
              count: activity.active_users,
            })
          : '',
        activityQ.isPending,
      ),
      build(
        'departments',
        t('metric.departments'),
        departments?.total ?? null,
        Users,
        'green',
        departments
          ? t('hint.subDepartments', { count: departments.children })
          : '',
        // 拿不到 tenantId 时该查询是 enabled:false，isPending 会一直是 true，
        // 直接用会让卡片永远停在骨架屏，所以这里显式要求有 tenantId。
        !!tenantId && departmentsQ.isPending,
      ),
      build(
        'knowledgebases',
        t('metric.knowledgeBases'),
        datasets.length,
        Folder,
        'purple',
        t('hint.totalDocuments', { total: formatThousand(documentTotal) }),
        datasetsQ.isPending,
      ),
      build(
        'agents',
        t('metric.agents'),
        agentSummary?.total ?? null,
        Workflow,
        'orange',
        agentSummary
          ? t('hint.agentsThisMonth', { count: agentSummary.thisMonth })
          : '',
        agentQ.isPending,
      ),
    ];
  }, [
    activity,
    departments,
    datasets,
    agentSummary,
    agentQ.isPending,
    activityQ.isPending,
    departmentsQ.isPending,
    datasetsQ.isPending,
    tenantId,
    t,
  ]);

  /**
   * 趋势图改成双曲线对比：
   *   api = API Key 发起的调用（api_4_conversation）
   *   web = 网页端知识库 / 对话里的手工检索（conversation_message 用户提问）
   * 两条链路互不相通，之前只画 api 那条，纯网页用户看到的永远是一条空线。
   */
  const trend = useMemo(
    () => buildDualTrend(stats?.pv, stats?.web_search),
    [stats?.pv, stats?.web_search],
  );
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

            {/* 组织与配置规模：成员 / 部门 / 知识库 / 智能体。
            与上一排同样是四列，断点保持一致，两排卡片左右边界对齐。 */}
            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {scaleCards.map(({ metric, loading }) => (
                <MetricCard
                  key={metric.key}
                  metric={metric}
                  loading={loading}
                />
              ))}
            </section>

            {/* 满意度 / 用户活跃度 / Token 消耗
            三列从 xl 起生效，与上方 4 张 KPI 卡片的 xl 断点对齐：
            侧边栏占 256px，更早拆三列会把每张卡片压到 200px 左右。 */}
            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <div className="flex items-center justify-between rounded-xl border border-border-default bg-bg-base px-5 py-4">
                <div>
                  <p className="text-sm text-text-secondary">
                    {t('metric.satisfaction')}
                  </p>
                  <p className="mt-1.5 flex items-baseline gap-1 text-2xl font-semibold text-text-primary">
                    {!satisfaction ||
                    (satisfaction.up === 0 && satisfaction.down === 0)
                      ? '—'
                      : `${satisfaction.up} / ${satisfaction.down}`}
                  </p>
                </div>
                <span className="text-xs text-text-disabled">
                  {t('satisfactionHint')}
                </span>
              </div>

              {/* 用户活跃度：斜杠左侧是活跃用户数，右侧是租户总用户数。
              右侧提示文字正好按同样顺序解释这两个数，读起来不用猜。 */}
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border-default bg-bg-base px-5 py-4">
                <div className="min-w-0">
                  <p className="text-sm text-text-secondary">
                    {t('metric.userActivity')}
                  </p>
                  <p className="mt-1.5 flex items-baseline gap-1 text-2xl font-semibold text-text-primary">
                    {activity && activity.total_users > 0 ? (
                      <>
                        {`${activity.active_users} / ${activity.total_users}`}
                        <span className="text-sm font-normal text-text-secondary">
                          {t('unit.user')}
                        </span>
                      </>
                    ) : (
                      '—'
                    )}
                  </p>
                </div>
                <span className="text-right text-xs text-text-disabled">
                  {t('userActivityHint', { days: TREND_DAYS })}
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
                  {t('tokensHint')}
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
                  apiLabel={t('chart.trendApi')}
                  webLabel={t('chart.trendWeb')}
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
