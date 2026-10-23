import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import request from '@/utils/request';

type ActivityKind = 'document' | 'knowledgebase' | 'canvas' | 'qc_block';

interface IRecentActivity {
  kind: ActivityKind;
  title: string;
  /** UnixMilli（后端四张表统一），兼容秒级历史数据。 */
  time: number;
}

/** 来源标签：颜色按模块区分，和左侧来源分布的颜色语义保持一致。 */
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

/**
 * 总览页的「最近动态」。
 *
 * 数据由后端 `/overview/activities` 一次聚合四张表（文档上传 / 知识库创建 /
 * 应用更新 / 质检拦截），前端只负责把 kind 翻译成文案 —— 不在浏览器里 fan-out
 * 四个列表接口再合并，那会把整页数据都拉下来只为展示 8 行。
 */
export function RecentActivities({ limit = 8 }: { limit?: number }) {
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
    <div className="rounded-xl border border-border-default bg-bg-base p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-medium text-text-primary">
          {t('overview.activity.title')}
        </h2>
        <span className="text-xs text-text-secondary">
          {t('overview.activity.count', { count: rows.length })}
        </span>
      </div>

      {isPending ? (
        <div className="py-10 text-center text-sm text-text-secondary">
          {t('overview.activity.loading')}
        </div>
      ) : rows.length === 0 ? (
        <div className="py-10 text-center text-sm text-text-secondary">
          {t('overview.activity.empty')}
        </div>
      ) : (
        <Table rootClassName="rounded-none bg-transparent">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[88px]">
                {t('overview.activity.source')}
              </TableHead>
              <TableHead>{t('overview.activity.action')}</TableHead>
              <TableHead className="w-[110px] text-right">
                {t('overview.activity.time')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => {
              const style = SOURCE_STYLE[row.kind] ?? {
                label: row.kind,
                className: 'bg-bg-card text-text-secondary',
              };
              return (
                <TableRow key={`${row.kind}:${row.time}:${index}`}>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded px-2 py-0.5 text-xs ${style.className}`}
                    >
                      {style.label}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span
                      className="block max-w-[260px] truncate text-text-primary"
                      title={row.title}
                    >
                      {describe(row)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-xs text-text-secondary">
                    {formatRelative(row.time)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
