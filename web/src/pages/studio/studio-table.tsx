import { EmptyAppCard } from '@/components/empty/empty';
import { EmptyCardType } from '@/components/empty/constant';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import {
  ChevronDown,
  Compass,
  History,
  ListChecks,
  Logs,
  Play,
  Send,
  Trash2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Routes } from '@/routes';
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog';
import { useDeleteAgent } from '@/hooks/use-agent-request';
import { IFlow } from '@/interfaces/database/agent';
import { CanvasCategoryToFlowType, FlowType } from '../agents/constant';

/**
 * 工作室表格视图。列与卡片视图一一对应（产品文档 3.4 原则：能看到的列
 * 就要能筛，筛选能力在列表页统一提供），因此这里只负责把同一份数据
 * 排成表格，不做任何独立过滤。
 *
 * 列：名称 · 类型 · 状态 · 版本 · 最近运行 · 更新时间 · 操作
 */
export function StudioTable({
  apps,
  loading,
  onOpen,
  onCreate,
}: {
  apps: IFlow[];
  loading?: boolean;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { deleteAgent } = useDeleteAgent();

  // 列表页直接触达应用级操作，避免每次都先进画布再找按钮。
  //
  // 能脱离画布独立完成的两项直接跳独立页：
  //   探索 → /agent/:id/explore，运行日志 → /agent-log-page/:id
  // 依赖画布 store 的三项（运行 / 历史版本 / 检查清单）走「跳过去 + 自动触发」：
  // 画布读取 ?action= 后在图加载完成时执行一次，然后清掉参数，
  // 所以用户只需在列表点一下，不用再在画布上找按钮。
  const openCanvas = (
    id: string,
    action?: 'run' | 'versions' | 'checklist' | 'publish',
  ) => {
    const query = action ? `?action=${action}` : '';
    navigate(`${Routes.Agent}/${id}${query}`);
  };

  if (!loading && apps.length === 0) {
    return <EmptyAppCard type={EmptyCardType.Agent} onClick={onCreate} />;
  }

  const typeLabel = (canvasCategory?: string) => {
    const flowType = CanvasCategoryToFlowType[canvasCategory ?? ''];
    if (flowType === FlowType.Workflow) return t('flow.taskFlow');
    if (flowType === FlowType.Chatflow) return t('flow.chatflow');
    return canvasCategory || '-';
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-border-default">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('common.name')}</TableHead>
            <TableHead>{t('studio.colType')}</TableHead>
            <TableHead>{t('studio.colStatus')}</TableHead>
            <TableHead>{t('studio.colVersion')}</TableHead>
            <TableHead>{t('studio.colLastRun')}</TableHead>
            <TableHead>{t('studio.colUpdated')}</TableHead>
            <TableHead className="text-right">{t('common.action')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {apps.map((app) => (
            <TableRow key={app.id} data-testid="studio-table-row">
              <TableCell className="font-medium">
                <button
                  type="button"
                  className="text-left hover:text-accent-primary hover:underline"
                  onClick={() => onOpen(app.id)}
                >
                  {app.title}
                </button>
              </TableCell>
              <TableCell>{typeLabel(app.canvas_category)}</TableCell>
              <TableCell>
                <span
                  className={
                    app.release
                      ? 'text-accent-primary'
                      : 'text-text-secondary'
                  }
                >
                  {app.release ? t('studio.statusPublished') : t('studio.statusDraft')}
                </span>
              </TableCell>
              <TableCell className="text-text-secondary">
                {app.latest_version_seq
                  ? t('studio.versionN', { n: app.latest_version_seq })
                  : t('common.none')}
              </TableCell>
              <TableCell className="text-text-secondary">
                {app.last_run_time
                  ? new Date(app.last_run_time).toLocaleString()
                  : t('common.none')}
              </TableCell>
              <TableCell className="text-text-secondary">
                {app.update_date ||
                  (app.update_time
                    ? new Date(app.update_time).toLocaleString()
                    : t('common.none'))}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className="text-sm text-accent-primary"
                    onClick={() => onOpen(app.id)}
                    data-testid="studio-table-edit"
                  >
                    {t('common.edit')}
                  </button>
                  {/* 应用级操作下沉到列表：这些按钮本来只在画布顶部有，
                      每测一次都要先进画布再找位置，批量巡检时很费事。 */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex items-center gap-0.5 text-sm text-accent-primary"
                        data-testid="studio-table-more"
                      >
                        更多
                        <ChevronDown className="size-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onClick={() => openCanvas(app.id, 'run')}>
                        <Play className="size-3.5" />
                        {t('flow.run')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          navigate(`${Routes.Agent}/${app.id}/explore`)
                        }
                      >
                        <Compass className="size-3.5" />
                        {t('explore.title')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => openCanvas(app.id, 'checklist')}
                      >
                        <ListChecks className="size-3.5" />
                        {t('flow.checklist')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => openCanvas(app.id, 'versions')}
                      >
                        <History className="size-3.5" />
                        {t('flow.historyVersion')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => openCanvas(app.id, 'publish')}
                      >
                        <Send className="size-3.5" />
                        {t('flow.release')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          navigate(`${Routes.AgentLogPage}/${app.id}`)
                        }
                      >
                        <Logs className="size-3.5" />
                        {t('flow.log')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {/* 删除与卡片视图的能力对齐：表格能看到应用，就要能删掉它，
                      否则用户只能切回卡片视图才能删（产品文档 3.4 同源原则）。 */}
                  <ConfirmDeleteDialog
                    onOk={() => deleteAgent(app.id)}
                    title={t('deleteModal.delAgent')}
                  >
                    <button
                      type="button"
                      className="flex items-center gap-1 text-sm text-state-error"
                      data-testid="studio-table-delete"
                    >
                      <Trash2 className="size-3.5" />
                      {t('common.delete')}
                    </button>
                  </ConfirmDeleteDialog>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
