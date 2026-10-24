import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  IAgentRunNode,
  useFetchRunDetail,
  useFetchRunNodes,
} from '@/hooks/use-run-request';
import { useTranslation } from 'react-i18next';

/** 与运行日志列表保持同一套状态配色。 */
function statusTone(value: string) {
  if (value === 'succeeded') return 'text-accent-primary';
  if (value === 'failed') return 'text-red-600';
  return 'text-text-secondary';
}

/** 节点状态比运行状态多（waiting/skipped/retrying），缺文案时回退原始值。 */

function JsonBlock({ value }: { value?: Record<string, unknown> }) {
  if (!value || Object.keys(value).length === 0) return null;
  return (
    <pre className="max-h-56 overflow-auto rounded-md bg-background-second p-3 text-xs leading-relaxed text-text-secondary">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/**
 * 运行详情：完整字段 + 输入输出 + 节点执行记录。
 *
 * 列表接口只回传 run 的基础字段，inputs/outputs 和节点明细要按 run_id 另取，
 * 所以这里开两个查询，按需触发（runId 为空时不发请求）。
 */
export function RunDetailDialog({
  runId,
  onClose,
}: {
  runId?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { detail, loading } = useFetchRunDetail(runId);
  const { nodes, loading: nodesLoading } = useFetchRunNodes(runId);

  const summary: { label: string; value: string; tone?: string }[] = [
    {
      label: t('studio.colApp'),
      value: detail?.canvas_title || detail?.canvas_id || '-',
    },
    {
      label: t('studio.colStatus'),
      value: detail
        ? t(`studio.runStatus.${detail.status}`, {
            defaultValue: detail.status,
          })
        : '-',
      tone: detail ? statusTone(detail.status) : undefined,
    },
    {
      label: t('studio.colTrigger'),
      value: detail ? t(`studio.runTrigger.${detail.trigger_type}`) : '-',
    },
    {
      label: t('studio.colDuration'),
      value: detail ? `${detail.duration_ms} ms` : '-',
    },
    {
      label: t('studio.colTokens'),
      value: detail
        ? `${detail.prompt_tokens + detail.completion_tokens}`
        : '-',
    },
    {
      label: t('studio.colStartedAt'),
      value: detail ? new Date(detail.create_time).toLocaleString() : '-',
    },
    { label: 'Run ID', value: detail?.id || runId || '-' },
  ];

  return (
    <Dialog open={!!runId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t('studio.runDetailTitle')}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          {loading && !detail ? (
            <div className="py-10 text-center text-sm text-text-disabled">…</div>
          ) : (
            <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-2 text-sm">
              {summary.map((row) => (
                <div key={row.label} className="contents">
                  <dt className="text-text-secondary">{row.label}</dt>
                  <dd
                    className={`break-all ${row.tone ?? 'text-text-primary'}`}
                  >
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {detail?.error_message && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">
              <div className="mb-1 font-medium">
                {t('studio.runDetailError')}
              </div>
              <div className="break-all">
                {detail.error_code ? `${detail.error_code}: ` : ''}
                {detail.error_message}
              </div>
            </div>
          )}

          {detail?.inputs && Object.keys(detail.inputs).length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-medium text-text-primary">
                {t('studio.runDetailInputs')}
              </h3>
              <JsonBlock value={detail.inputs} />
            </section>
          )}

          {detail?.outputs && Object.keys(detail.outputs).length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-medium text-text-primary">
                {t('studio.runDetailOutputs')}
              </h3>
              <JsonBlock value={detail.outputs} />
            </section>
          )}

          <section>
            <h3 className="mb-2 text-sm font-medium text-text-primary">
              {t('studio.runDetailNodeRecords')}
            </h3>
            {nodes.length === 0 ? (
              <div className="py-6 text-center text-xs text-text-disabled">
                {nodesLoading ? '…' : t('studio.runDetailEmpty')}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('studio.runDetailNode')}</TableHead>
                    <TableHead>{t('studio.runDetailNodeType')}</TableHead>
                    <TableHead>{t('studio.colStatus')}</TableHead>
                    <TableHead>{t('studio.colDuration')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nodes.map((node: IAgentRunNode) => (
                    <TableRow key={node.id}>
                      <TableCell className="font-mono text-xs">
                        {node.node_id}
                      </TableCell>
                      <TableCell className="text-xs">
                        {node.node_type}
                      </TableCell>
                      <TableCell
                        className={`text-xs ${statusTone(node.status)}`}
                      >
                        {t(`studio.runStatus.${node.status}`, {
                          defaultValue: node.status,
                        })}
                      </TableCell>
                      <TableCell className="text-xs">
                        {node.duration_ms} ms
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
