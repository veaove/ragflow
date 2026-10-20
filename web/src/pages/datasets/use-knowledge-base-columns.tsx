import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogNode,
} from '@/components/confirm-delete-dialog';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useNavigatePage } from '@/hooks/logic-hooks/navigate-hooks';
import {
  useDeleteKnowledge,
  useUpdateKnowledge,
  fetchDatasetReferences,
} from '@/hooks/use-knowledge-request';
import {
  IDataset,
  IDatasetReference,
} from '@/interfaces/database/dataset';
import { cn } from '@/lib/utils';
import { formatDate } from '@/utils/date';
import { ColumnDef } from '@tanstack/react-table';
import { Pencil, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRenameDataset } from './use-rename-dataset';

type PaginationInfo = {
  current: number;
  pageSize: number;
};

type UseKnowledgeBaseColumnsProps = {
  pagination: PaginationInfo;
  /**
   * Called when the dataset cannot be disabled because apps still bind it. The
   * caller owns the dialog: the column definition cannot render one.
   */
  onDisableBlocked: (dataset: IDataset, references: IDatasetReference[]) => void;
} & Pick<ReturnType<typeof useRenameDataset>, 'showDatasetRenameModal'>;

export function useKnowledgeBaseColumns({
  pagination,
  showDatasetRenameModal,
  onDisableBlocked,
}: UseKnowledgeBaseColumnsProps) {
  const { t } = useTranslation();
  const { navigateToDataset } = useNavigatePage();
  const { saveKnowledgeConfiguration } = useUpdateKnowledge(true);
  const { deleteKnowledge } = useDeleteKnowledge();
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // `enabled` is the switch; `status` is the backend row-lifecycle marker and
  // must not drive the UI. Datasets from endpoints that predate the field are
  // treated as enabled, matching the column default.
  const isEnabled = (dataset: IDataset) => dataset.enabled !== false;

  const columns: ColumnDef<IDataset>[] = useMemo(
    () => [
      {
        id: 'index',
        header: '序号',
        cell: ({ row }) => {
          const index =
            (pagination.current - 1) * pagination.pageSize + row.index + 1;
          return <span className="text-text-secondary">{index}</span>;
        },
      },
      {
        accessorKey: 'name',
        header: '知识库名称',
        cell: ({ row }) => {
          const dataset = row.original;
          const name = dataset.name || '-';

          return (
            <div className="flex items-center gap-3">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="max-w-[200px] truncate text-left text-accent-primary hover:underline"
                    onClick={navigateToDataset(dataset.id)}
                  >
                    {name}
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{name}</p>
                </TooltipContent>
              </Tooltip>
              <button
                type="button"
                className="inline-flex items-center gap-0.5 text-xs text-accent-primary hover:underline"
                onClick={navigateToDataset(dataset.id)}
              >
                查看 <span className="text-xs">→</span>
              </button>
            </div>
          );
        },
      },
      {
        accessorKey: 'description',
        header: '知识库描述',
        cell: ({ row }) => {
          const description = row.getValue('description') as string;
          return (
            <span className="text-text-secondary">
              {description || '--'}
            </span>
          );
        },
      },
      {
        accessorKey: 'chunk_count',
        header: '知识点数量',
        cell: ({ row }) => <span>{row.getValue('chunk_count') ?? 0}</span>,
      },
      {
        accessorKey: 'enabled',
        header: t('knowledgeDetails.status'),
        cell: ({ row }) => {
          const enabled = isEnabled(row.original);
          return (
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'inline-block size-1.5 rounded-full',
                  enabled ? 'bg-accent-primary' : 'bg-text-disabled',
                )}
              />
              <span className={cn(enabled ? 'text-text-primary' : 'text-text-secondary')}>
                {enabled
                  ? t('knowledgeDetails.enabled')
                  : t('knowledgeDetails.disabled')}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: 'update_date',
        header: '更新时间',
        cell: ({ row }) => {
          // create_date/update_date are the formatted columns; fall back to the
          // numeric timestamps for list shapes that only carry those.
          const value =
            row.original.update_date ?? row.original.update_time ?? '';
          return (
            <span className="text-text-secondary">
              {value ? formatDate(value) : '--'}
            </span>
          );
        },
      },
      {
        accessorKey: 'create_date',
        header: '创建时间',
        cell: ({ row }) => {
          const value =
            row.original.create_date ?? row.original.create_time ?? '';
          return (
            <span className="text-text-secondary">
              {value ? formatDate(value) : '--'}
            </span>
          );
        },
      },
      {
        id: 'actions',
        header: '操作',
        cell: ({ row }) => {
          const dataset = row.original;
          const enabled = isEnabled(dataset);
          const toggling = togglingId === dataset.id;

          const handleEdit = (e: React.MouseEvent) => {
            e.stopPropagation();
            showDatasetRenameModal(dataset);
          };

          const handleToggle = async (checked: boolean) => {
            setTogglingId(dataset.id);
            try {
              if (!checked) {
                // A dataset that something still binds cannot be disabled: the
                // binding would silently lose its retrieval source. Look the
                // bindings up first so the user is told exactly where to unbind
                // instead of getting a bare failure.
                const references = await fetchDatasetReferences(dataset.id);
                if (references.length > 0) {
                  onDisableBlocked(dataset, references);
                  return;
                }
              }
              await saveKnowledgeConfiguration({
                kb_id: dataset.id,
                enabled: checked,
              });
            } finally {
              setTogglingId(null);
            }
          };

          const handleDelete = () => {
            deleteKnowledge(dataset.id);
          };

          return (
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-md p-1 text-text-secondary transition-colors hover:bg-bg-card hover:text-text-primary"
                onClick={handleEdit}
                title={t('common.rename')}
              >
                <Pencil className="size-4" />
              </button>

              <Switch
                checked={enabled}
                disabled={toggling}
                onCheckedChange={handleToggle}
                className="data-[state=checked]:bg-accent-primary"
              />

              <ConfirmDeleteDialog
                onOk={handleDelete}
                title={t('deleteModal.delDataset')}
                content={{
                  node: (
                    <ConfirmDeleteDialogNode
                      avatar={{ avatar: dataset.avatar, name: dataset.name }}
                      name={dataset.name}
                    />
                  ),
                }}
              >
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-md p-1 text-text-secondary transition-colors hover:bg-bg-card hover:text-state-error"
                  title={t('common.delete')}
                >
                  <Trash2 className="size-4" />
                </button>
              </ConfirmDeleteDialog>
            </div>
          );
        },
      },
    ],
    [
      t,
      pagination,
      navigateToDataset,
      showDatasetRenameModal,
      saveKnowledgeConfiguration,
      deleteKnowledge,
      onDisableBlocked,
      togglingId,
    ],
  );

  return columns;
}
