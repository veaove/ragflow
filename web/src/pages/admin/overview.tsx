import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  LucideActivity,
  LucideBuilding2,
  LucideFileText,
  LucideLibrary,
  LucideMessageSquare,
  LucideRefreshCw,
  LucideUsers,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { BRAND_BLUE } from '@/pages/overview/constants';
import type { IOverviewMetric } from '@/pages/overview/interface';
import { MetricCard } from '@/pages/overview/metric-card';
import { calcDelta } from '@/pages/overview/utils';
import { getOverview } from '@/services/admin-service';

import { OverviewTrendChart } from './components/overview-trend-chart';

/** 会话曲线用暖色，与租户曲线的品牌蓝拉开色相。 */
const CONVERSATION_COLOR = '#E8973B';

const OverviewKeys = {
  detail: () => ['admin/overview'] as const,
};

/**
 * 平台运营概览。
 *
 * 全部指标一次请求取回（GET /api/v1/admin/overview），口径见后端
 * `service_overview.go`。这里只做展示与环比计算，不再二次拼装数据。
 *
 * 卡片与趋势图复用租户端「总览」的 `MetricCard`：同一套视觉语言，
 * 避免管理端自己长出一套卡片样式。
 */
export default function AdminOverview() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching } = useQuery({
    queryKey: OverviewKeys.detail(),
    queryFn: async () => (await getOverview()).data.data,
    retry: false,
  });

  const metrics = useMemo<IOverviewMetric[]>(() => {
    const build = (
      key: string,
      label: string,
      icon: IOverviewMetric['icon'],
      metric?: AdminService.OverviewMetric,
    ): IOverviewMetric => ({
      key,
      label,
      icon,
      value: metric?.value ?? 0,
      // prev 为 0（新平台/新周期）时算不出环比，交给卡片显示「无对比数据」。
      delta: metric ? calcDelta(metric.value, metric.prev) : null,
    });

    return [
      build(
        'tenants',
        t('admin.overview.tenants'),
        LucideBuilding2,
        data?.tenants,
      ),
      build(
        'active_tenants',
        t('admin.overview.activeTenants'),
        LucideActivity,
        data?.active_tenants,
      ),
      build(
        'members',
        t('admin.overview.members'),
        LucideUsers,
        data?.members,
      ),
      build(
        'datasets',
        t('admin.overview.datasets'),
        LucideLibrary,
        data?.datasets,
      ),
      build(
        'documents',
        t('admin.overview.documents'),
        LucideFileText,
        data?.documents,
      ),
      build(
        'active_conversations',
        t('admin.overview.activeConversations'),
        LucideMessageSquare,
        data?.active_conversations,
      ),
    ];
  }, [data, t]);

  return (
    <div className="size-full min-w-0 overflow-auto px-5 py-4">
      <header className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-medium text-text-primary">
            {t('admin.overview.title')}
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            {t('admin.overview.subtitle')}
          </p>
        </div>

        <Button
          variant="outline"
          size="icon-lg"
          aria-label={t('admin.refresh')}
          data-testid="admin-overview-refresh"
          onClick={() =>
            queryClient.invalidateQueries({ queryKey: OverviewKeys.detail() })
          }
        >
          <LucideRefreshCw
            className={isFetching ? 'size-4 animate-spin' : 'size-4'}
          />
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {metrics.map((metric) => (
          <MetricCard key={metric.key} metric={metric} loading={isLoading} />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <OverviewTrendChart
          title={t('admin.overview.tenantTrend')}
          data={data?.tenant_trend ?? []}
          color={BRAND_BLUE}
          loading={isLoading}
          emptyText={t('admin.overview.emptyTrend')}
        />
        <OverviewTrendChart
          title={t('admin.overview.conversationTrend')}
          data={data?.conversation_trend ?? []}
          color={CONVERSATION_COLOR}
          loading={isLoading}
          emptyText={t('admin.overview.emptyTrend')}
        />
      </div>
    </div>
  );
}
