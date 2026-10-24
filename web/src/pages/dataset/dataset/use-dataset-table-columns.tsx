import { FileIcon } from '@/components/icon-font';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useNavigatePage } from '@/hooks/logic-hooks/navigate-hooks';
import { UseRowSelectionType } from '@/hooks/logic-hooks/use-row-selection';
import { useSetDocumentStatus } from '@/hooks/use-document-request';
import { IDocumentInfo } from '@/interfaces/database/document';
import { cn } from '@/lib/utils';
import { formatDate } from '@/utils/date';
import { ColumnDef } from '@tanstack/table-core';
import { ArrowUpDown } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { MetadataType } from '../components/metedata/constant';
import { ShowManageMetadataModalProps } from '../components/metedata/interface';
import { DatasetActionCell } from './dataset-action-cell';
import { ParseDropdownButton, ParsingStatusCell } from './parsing-status-cell';
import { UseChangeDocumentParserShowType } from './use-change-document-parser';
import { UseRenameDocumentShowType } from './use-rename-document';

type UseDatasetTableColumnsType = UseChangeDocumentParserShowType &
  UseRenameDocumentShowType &
  Pick<UseRowSelectionType, 'setRowSelection'> & {
    showLog: (record: IDocumentInfo) => void;
    showManageMetadataModal: (config: ShowManageMetadataModalProps) => void;
  };

export function useDatasetTableColumns({
  showChangeParserModal,
  showRenameModal,
  showManageMetadataModal,
  showLog,
  setRowSelection,
}: UseDatasetTableColumnsType) {
  const { t } = useTranslation('translation', {
    keyPrefix: 'knowledgeDetails',
  });
  // const { dataSourceInfo } = useDataSourceInfo();
  const { navigateToChunkParsedResult } = useNavigatePage();
  const { setDocumentStatus } = useSetDocumentStatus();
  const { id: datasetId } = useParams();

  const columns: ColumnDef<IDocumentInfo>[] = useMemo(
    () => [
      {
        id: 'select',
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && 'indeterminate')
            }
            onCheckedChange={(value) =>
              table.toggleAllPageRowsSelected(!!value)
            }
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
          />
        ),
        enableSorting: false,
        enableHiding: false,
      },
      {
        accessorKey: 'name',
        header: ({ column }) => {
          return (
            <div className="flex items-center gap-1">
              {t('name')}

              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() =>
                  column.toggleSorting(column.getIsSorted() === 'asc')
                }
              >
                <ArrowUpDown />
              </Button>
            </div>
          );
        },
        meta: { cellClassName: 'max-w-[20vw]' },
        cell: ({ row }) => {
          const name: string = row.getValue('name');

          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className="flex items-center gap-2 cursor-pointer"
                  onClick={navigateToChunkParsedResult(
                    row.original.id,
                    row.original.dataset_id,
                  )}
                >
                  <FileIcon name={name}></FileIcon>
                  <span className={cn('truncate')}>{name}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{name}</p>
              </TooltipContent>
            </Tooltip>
          );
        },
      },
      {
        accessorKey: 'create_time',
        header: ({ column }) => {
          return (
            <div className="flex items-center gap-1">
              {t('uploadDate')}

              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() =>
                  column.toggleSorting(column.getIsSorted() === 'asc')
                }
              >
                <ArrowUpDown />
              </Button>
            </div>
          );
        },
        cell: ({ row }) => (
          <time
            className="lowercase"
            dateTime={new Date(row.getValue('create_time')).toISOString()}
          >
            {formatDate(row.getValue('create_time'))}
          </time>
        ),
      },
      {
        accessorKey: 'status',
        header: t('enabled'),
        cell: ({ row }) => {
          const id = row.original.id;
          return (
            <Switch
              checked={row.getValue('status') === '1'}
              onCheckedChange={(e) => {
                setDocumentStatus({
                  status: e,
                  documentId: id,
                  datasetId: datasetId!,
                });
              }}
            />
          );
        },
      },
      {
        accessorKey: 'chunk_count',
        header: t('chunkNumber'),
        cell: ({ row }) => (
          <div className="capitalize">{row.getValue('chunk_count')}</div>
        ),
      },
      {
        accessorKey: 'meta_fields',
        header: t('metadata.metadata'),
        cell: ({ row }) => {
          const metaFields =
            (row.getValue('meta_fields') as Record<string, any>) || {};
          const length = Object.entries(metaFields).filter(([, value]) => {
            if (value == null || value === '') return false;
            if (Array.isArray(value)) {
              return value.some((item) => item != null && item !== '');
            }
            return true;
          }).length;
          return (
            <Button
              variant="static"
              size="auto"
              onClick={() => {
                showManageMetadataModal({
                  isEditField: false,
                  isCanAdd: true,
                  isAddValue: true,
                  type: MetadataType.UpdateSingle,
                  record: row.original,
                  title: (
                    <div className="flex flex-col gap-2 w-full">
                      <div className="text-base font-normal">
                        {t('metadata.editMetadata')}
                      </div>
                    </div>
                  ),
                  secondTitle: (
                    <div className="w-full flex gap-1 text-sm text-text-secondary">
                      <FileIcon name={row.original.name}></FileIcon>
                      <div className="truncate">{row.original.name}</div>
                    </div>
                  ),
                  isDeleteSingleValue: true,
                  documentIds: [row.original.id],
                });
              }}
            >
              {length + ' fields'}
            </Button>
          );
        },
      },
      {
        accessorKey: 'run',
        header: t('Parse'),
        cell: ({ row }) => {
          return (
            <ParseDropdownButton
              record={row.original}
              showChangeParserModal={showChangeParserModal}
            />
          );
        },
      },
      {
        id: 'actions',
        header: t('action'),
        enableHiding: false,
        // 表格是 w-full 的自动布局，剩余宽度会按比例摊给所有列。不放任这一列
        // 自由伸缩，它就会被撑到内容宽度的好几倍——右边看起来空一大块，
        // 「操作」表头也会和自己的按钮对不上。w-[1%] + nowrap 是自动布局下
        // 让列收缩到内容宽度的标准写法（浏览器按最小内容宽度计算）。
        //
        // 解析/状态按钮（原先单独占一个没有表头的 run-status 列）也合并到这里：
        // 它们常驻可见，而「操作」表头在另一列，导致标签被夹在两个按钮之间、
        // 看不出归属。现在一行里所有行内操作都归「操作」这一列。
        meta: {
          headerClassName: 'w-[1%] whitespace-nowrap',
          cellClassName: 'w-[1%] whitespace-nowrap',
        },
        cell: ({ row }) => {
          const record = row.original;

          return (
            <div className="flex items-center gap-2">
              <ParsingStatusCell
                record={record}
                showChangeParserModal={showChangeParserModal}
                showLog={showLog}
              />
              <DatasetActionCell
                record={record}
                showRenameModal={showRenameModal}
                setRowSelection={setRowSelection}
              />
            </div>
          );
        },
      },
    ],
    [
      t,
      navigateToChunkParsedResult,
      setDocumentStatus,
      datasetId,
      showChangeParserModal,
      showRenameModal,
      showManageMetadataModal,
      showLog,
      setRowSelection,
    ],
  );

  return columns;
}
