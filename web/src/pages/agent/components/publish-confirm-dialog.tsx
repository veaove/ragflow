import { RAGFlowAvatar } from '@/components/ragflow-avatar';
import { Button, ButtonLoading } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { IFlow } from '@/interfaces/database/agent';
import { IDataset } from '@/interfaces/database/dataset';
import { formatDate } from '@/utils/date';
import { BookPlus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useIsPipeline } from '../hooks/use-is-pipeline';

interface PublishConfirmDialogProps {
  agentDetail: IFlow;
  loading: boolean;
  onPublish: (remark?: string) => void;
  // Returning true blocks the dialog from opening (e.g. unresolved canvas
  // checklist issues) — the caller is responsible for the user-facing notice.
  onBeforeOpen?: () => boolean;
  /** 从工作室列表跳进来时自动打开（?action=publish）。 */
  autoOpen?: boolean;
}

function AssociatedDataset({
  associatedDatasets,
}: {
  associatedDatasets: Pick<IDataset, 'id' | 'name' | 'avatar'>[];
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2 pl-10 pt-3">
      <div className="text-sm font-medium text-text-secondary">
        {t('flow.linkedDataset')}
      </div>
      {associatedDatasets.length > 0 ? (
        <div className="space-y-2 max-h-32 overflow-y-auto">
          {associatedDatasets.map((dataset) => (
            <div
              key={dataset.id}
              className="flex items-center gap-2 px-2 py-2 bg-bg-card rounded text-sm text-text-primary"
            >
              <RAGFlowAvatar
                avatar={dataset.avatar}
                name={dataset.name}
                className="size-4 text-xs"
              />
              <span className="truncate text-text-secondary">
                {dataset.name}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-text-disabled">{t('common.noData')}</div>
      )}
    </div>
  );
}

export function PublishConfirmDialog({
  agentDetail,
  loading,
  onPublish,
  onBeforeOpen,
  autoOpen = false,
}: PublishConfirmDialogProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [remark, setRemark] = useState('');

  // 从工作室列表点「发布」跳进来时，?action=publish 会让 autoOpen 为 true，
  // 这里直接把确认框打开，省掉用户在画布上再找一次按钮。
  useEffect(() => {
    if (autoOpen) {
      setOpen(true);
    }
  }, [autoOpen]);
  const isPipeline = useIsPipeline();

  const lastPublished = useMemo(() => {
    if (agentDetail?.last_publish_time) {
      return formatDate(agentDetail.last_publish_time);
    }
    return '';
  }, [agentDetail.last_publish_time]);

  // Get datasets associated with this pipeline from API response
  const associatedDatasets = useMemo(() => {
    return agentDetail?.datasets || [];
  }, [agentDetail?.datasets]);

  const handleConfirmPublish = useCallback(() => {
    onPublish(remark.trim() || undefined);
    setOpen(false);
  }, [onPublish, remark]);

  // A plain button instead of DialogTrigger: Radix opens the dialog on click
  // regardless of preventDefault, so the guard has to own `setOpen`.
  const handleTriggerClick = useCallback(() => {
    if (onBeforeOpen?.()) {
      return;
    }
    setOpen(true);
  }, [onBeforeOpen]);

  if (isPipeline) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <ButtonLoading
        variant={'secondary'}
        loading={loading}
        onClick={handleTriggerClick}
      >
        <BookPlus /> {t('flow.release')}
      </ButtonLoading>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('flow.confirmPublish')}</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          <div className="space-y-3">
            <div className="text-sm text-text-secondary">
              {t(
                `flow.${isPipeline ? 'publishIngestionPipeline' : 'publishAgent'}`,
              )}
            </div>

            <section className="bg-bg-input px-2.5 py-4 rounded border border-border-default">
              <div className="flex gap-2.5 items-center">
                <RAGFlowAvatar
                  avatar={agentDetail.avatar}
                  name={agentDetail.title}
                  className="size-8"
                />
                <span className="text-text-primary text-lg">
                  {agentDetail.title}
                </span>
              </div>

              {isPipeline && (
                <AssociatedDataset
                  associatedDatasets={associatedDatasets}
                ></AssociatedDataset>
              )}
            </section>

            <div className="flex flex-col gap-2">
              {lastPublished && (
                <div className="flex items-center text-sm text-text-secondary gap-2">
                  <span>{t('flow.lastPublished')}:</span>
                  <span>{lastPublished}</span>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <span className="text-sm text-text-secondary">
                  {t('flow.versionRemark')}
                </span>
                <Input
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  placeholder={t('flow.versionRemarkPh')}
                  maxLength={255}
                />
              </div>
            </div>
          </div>
        </DialogDescription>
        <DialogFooter className="gap-2 mt-4">
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleConfirmPublish}>{t('common.confirm')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
