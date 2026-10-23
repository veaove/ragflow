import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import request from '@/utils/request';

type ActivityKind = 'document' | 'knowledgebase' | 'canvas' | 'qc_block';

interface IRecentActivity {
  kind: ActivityKind;
  title: string;
  /** UnixMilli（后端四张表统一），兼容秒级历史数据。 */
  time: number;
}

/** 来源标签：颜色按模块区分。 */
const SOURCE_STYLE: Record<ActivityKind, { label: string; className: string }> =
  {
    knowledgebase: {
      label: '知识库',
      className: 'bg-accent-primary/10 text-accent-primary',
    },
    document: {
      label: '知识库',
      className: 'bg-accent-primary/10 text-accent-primary',
    },
    canvas: {
      label: '应用',
      className: 'bg-violet-100 text-violet-600',
    },
    qc_block: {
      label: '质检',
      className: 'bg-orange-100 text-orange-600',
    },
  };

/** 相对时间：18 分钟前 / 今天 09:12 / 昨天 18:30 / 10-21 09:12 */
function formatRelative(ts: number) {
  if (!ts) return '-';
  const ms = ts > 1e12 ? ts : ts * 1000;
  const target = dayjs(ms);
  const now = dayjs();
  const diffMinutes = now.diff(target, 'minute');
  if (diffMinutes < 1) return '刚刚';
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  if (target.isSame(now, 'day')) return `今天 ${target.format('HH:mm')}`;
  if (target.isSame(now.subtract(1, 'day'), 'day')) {
    return `昨天 ${target.format('HH:mm')}`;
  }
  return target.format('MM-DD HH:mm');
}

/** 超过这个行数才自动滚动：内容装不满容器时滚动会显得莫名其妙。 */
const MIN_ROWS_TO_SCROLL = 7;
/** 每条停留秒数，决定滚动速度。 */
const SECONDS_PER_ROW = 3;

/**
 * 总览页的「最近动态」。
 *
 * 两个约束决定了实现方式：
 * 1. 面板高度跟着左侧卡片走（h-full），否则 8-20 条会把整页撑出滚动条，
 *    用户抱怨的「太长」正是这个。
 * 2. 装不下时**自动滚动播放**而不是给内部滚动条：这块是"扫一眼"的信息，
 *    自动轮播让用户不用主动操作就能看全，鼠标悬停时暂停便于细看。
 *
 * 无缝循环靠复制一份列表 + translateY(-50%) 实现，没有 JS 定时器，
 * 所以标签页切到后台时动画会自然停住，不烧 CPU。
 */
export function RecentActivities({ limit = 20 }: { limit?: number }) {
  const { t } = useTranslation();
  const { data, isPending } = useQuery({
    queryKey: ['overview', 'activities', limit],
    queryFn: async () => {
      const { data } = await request.get(
        `/api/v1/overview/activities?limit=${limit}`,
      );
      return (data as { data?: { activities?: IRecentActivity[] } })?.data
        ?.activities;
    },
    staleTime: 60 * 1000,
  });

  const rows = data ?? [];
  const shouldScroll = rows.length >= MIN_ROWS_TO_SCROLL;
  // 复制一份接在后面，动画滚到 -50% 时正好接上，视觉上没有跳变。
  const loopRows = shouldScroll ? [...rows, ...rows] : rows;

  const describe = (row: IRecentActivity) => {
    switch (row.kind) {
      case 'document':
        return t('overview.activity.document', { title: row.title });
      case 'knowledgebase':
        return t('overview.activity.knowledgebase', { title: row.title });
      case 'canvas':
        return t('overview.activity.canvas', { title: row.title });
      case 'qc_block':
        return t('overview.activity.qcBlock', { title: row.title });
      default:
        return row.title;
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-border-default bg-bg-base p-5">
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <h2 className="text-base font-medium text-text-primary">
          {t('overview.activity.title')}
        </h2>
        <span className="text-xs text-text-secondary">
          {t('overview.activity.count', { count: rows.length })}
        </span>
      </div>

      {/* 表头固定在滚动区之外，滚动时列名不会跟着跑掉。 */}
      <div className="grid shrink-0 grid-cols-[72px_minmax(0,1fr)_92px] gap-2 border-b border-border-light pb-2 text-xs text-text-secondary">
        <span>{t('overview.activity.source')}</span>
        <span>{t('overview.activity.action')}</span>
        <span className="text-right">{t('overview.activity.time')}</span>
      </div>

      {isPending ? (
        <div className="flex flex-1 items-center justify-center text-sm text-text-secondary">
          {t('overview.activity.loading')}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-text-secondary">
          {t('overview.activity.empty')}
        </div>
      ) : (
        // min-h-0 必须有：flex 子项默认 min-height:auto，不加这个
        // overflow-hidden 挡不住内容，面板又会被撑高。
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div
            className={shouldScroll ? 'activity-scroll' : undefined}
            style={
              shouldScroll
                ? { animationDuration: `${rows.length * SECONDS_PER_ROW}s` }
                : undefined
            }
          >
            {loopRows.map((row, index) => {
              const style = SOURCE_STYLE[row.kind] ?? {
                label: row.kind,
                className: 'bg-bg-card text-text-secondary',
              };
              return (
                <div
                  key={`${row.kind}:${row.time}:${index}`}
                  className="grid h-11 grid-cols-[72px_minmax(0,1fr)_92px] items-center gap-2 border-b border-border-light last:border-b-0"
                >
                  <span
                    className={`inline-flex w-fit items-center whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${style.className}`}
                  >
                    {style.label}
                  </span>
                  <span
                    className="truncate text-sm text-text-primary"
                    title={row.title}
                  >
                    {describe(row)}
                  </span>
                  <span className="whitespace-nowrap text-right text-xs text-text-secondary">
                    {formatRelative(row.time)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
