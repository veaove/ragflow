import FileStatusBadge from '@/components/file-status-badge';
import { RAGFlowAvatar } from '@/components/ragflow-avatar';
import { RunningStatusMap } from '@/constants/knowledge';
import { RunningStatus } from '@/pages/dataset/dataset/constant';
import { formatDate } from '@/utils/date';
import { ColumnDef } from '@tanstack/react-table';
import { TFunction } from 'i18next';
import { IDataSourceLog } from './interface';
import { getSummary } from './log-summary';

// The data source sync log table is shared by the data source detail page and
// the dataset logs page. The dataset page already scopes every row to one
// knowledge base, so it renders the table without the dataset column.
//
// `translate` is passed in rather than imported from the i18next singleton:
// the singleton's `t` is resolved once at module-eval time, so switching the
// UI language would leave these headers in the previous language.
export const getDataSourceLogsTableColumns = ({
  now,
  translate,
  showDatasetColumn = true,
  handleToDataSetDetail,
}: {
  now: number;
  translate: TFunction;
  showDatasetColumn?: boolean;
  handleToDataSetDetail?: (id: string) => void;
}): ColumnDef<IDataSourceLog>[] => {
  const t = translate;
  const columns: ColumnDef<IDataSourceLog>[] = [
    {
      accessorKey: 'update_date',
      header: t('setting.timeStarted'),
      meta: { headerClassName: 'w-44' },
      cell: ({ row }) => (
        <div className="flex items-center gap-2 text-text-primary">
          {row.original.update_date
            ? formatDate(row.original.update_date)
            : '-'}
        </div>
      ),
    },
    {
      accessorKey: 'status',
      header: t('knowledgeDetails.status'),
      meta: { headerClassName: 'w-28' },
      cell: ({ row }) => (
        <FileStatusBadge
          status={row.original.status as RunningStatus}
          name={RunningStatusMap[row.original.status as RunningStatus]}
          className="!w-20"
        />
      ),
    },
  ];

  if (showDatasetColumn) {
    columns.push({
      accessorKey: 'kb_name',
      header: t('knowledgeDetails.dataset'),
      meta: { headerClassName: 'w-1/4' },
      cell: ({ row }) => (
        <div
          className="flex items-center gap-2 text-text-primary cursor-pointer"
          onClick={() => {
            handleToDataSetDetail?.(row.original.kb_id);
          }}
        >
          <RAGFlowAvatar
            avatar={row.original.avatar}
            name={row.original.kb_name}
            className="size-4"
          />
          <span className="truncate">{row.original.kb_name}</span>
        </div>
      ),
    });
  }

  columns.push(
    {
      accessorKey: 'task_type',
      header: t('setting.taskType'),
      meta: { headerClassName: 'w-28' },
      cell: ({ row }) => {
        const taskType = row.original.task_type;
        if (!taskType) return t('setting.taskTypeSync');
        // Only the two known task types are translated; an unknown value from
        // a newer backend must render verbatim rather than disappear.
        const key = `setting.taskType${
          taskType.charAt(0).toUpperCase() + taskType.slice(1)
        }`;
        const translated = t(key, { defaultValue: '' });
        return translated || taskType;
      },
    },
    {
      id: 'summary',
      header: t('setting.summary'),
      cell: ({ row }) => (
        <div className="max-w-[32rem] whitespace-normal break-words text-text-primary">
          {getSummary(row.original, now, t)}
        </div>
      ),
    },
  );

  return columns;
};
