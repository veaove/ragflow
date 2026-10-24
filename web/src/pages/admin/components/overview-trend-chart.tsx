import { useId } from 'react';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Skeleton } from '@/components/ui/skeleton';
import { formatThousand } from '@/pages/overview/utils';

/**
 * 坐标轴取色：`--text-secondary` 是「R G B」三元组，必须包一层 rgb()，
 * 直接塞进 fill 会被判为非法值退回黑色，深色主题下就成黑底黑字。
 */
const AXIS_TICK = { fontSize: 12, fill: 'rgb(var(--text-secondary))' };

export type OverviewTrendPoint = { date: string; value: number };

/** X 轴标签只留「月-日」，30 个点才排得下。 */
const shortDate = (date: string) => date.slice(5);

/**
 * 运营概览里的单序列面积图。
 *
 * 刻度从 0 开始（management 场景看的是绝对量，截断纵轴会夸大波动）；
 * 曲线用 monotone 而非直线，避免把「当天没量」读成断崖。
 */
export function OverviewTrendChart({
  title,
  data,
  color,
  loading,
  emptyText,
}: {
  title: string;
  data: OverviewTrendPoint[];
  color: string;
  loading?: boolean;
  emptyText: string;
}) {
  /**
   * 渐变 id 用 useId 生成：标题是多语言文案，直接拼进 id 可能带空格或
   * 特殊字符，`url(#...)` 解析失败时面积图会退化成纯描边。
   */
  const gradientId = `overviewFill-${useId()}`;

  return (
    <section className="rounded-xl border border-border-default bg-bg-base p-5">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-medium text-text-primary">{title}</h2>
      </header>

      {loading ? (
        <Skeleton className="h-[236px] w-full" />
      ) : data.length === 0 ? (
        <div className="flex h-[236px] items-center justify-center text-sm text-text-disabled">
          {emptyText}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={236}>
          <AreaChart
            data={data}
            margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.24} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border-default)"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tick={AXIS_TICK}
              tickFormatter={shortDate}
              axisLine={false}
              tickLine={false}
              minTickGap={16}
            />
            <YAxis
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value: number) => formatThousand(value)}
              width={56}
              allowDecimals={false}
              domain={[0, (max: number) => Math.max(1, Math.ceil(max * 1.1))]}
            />
            <Tooltip
              formatter={(value: number) => [formatThousand(value), title]}
              contentStyle={{
                borderRadius: 8,
                fontSize: 12,
                background: 'var(--bg-base)',
                border: '1px solid var(--border-default)',
              }}
              labelStyle={{ color: 'rgb(var(--text-secondary))' }}
              itemStyle={{ color: 'rgb(var(--text-primary))' }}
              cursor={{ stroke: 'var(--border-default)' }}
            />

            <Area
              type="monotone"
              dataKey="value"
              name={title}
              stroke={color}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={!loading}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}

export default OverviewTrendChart;
