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
import { Trash2 } from 'lucide-react';
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
  const { deleteAgent } = useDeleteAgent();

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
                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    className="text-sm text-accent-primary"
                    onClick={() => onOpen(app.id)}
                    data-testid="studio-table-edit"
                  >
                    {t('common.edit')}
                  </button>
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
