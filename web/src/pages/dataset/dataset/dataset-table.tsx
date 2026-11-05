'use client';

import {
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import * as React from 'react';

import { EmptyType } from '@/components/empty/constant';
import Empty from '@/components/empty/empty';
import { RenameDialog } from '@/components/rename-dialog';
import { ResourceOwnerProvider } from '@/components/resource-owner-cell';
import { IDocumentFolder } from '@/interfaces/database/document';
import { LucideFolder } from 'lucide-react';
import { RAGFlowPagination } from '@/components/ui/ragflow-pagination';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { UseRowSelectionType } from '@/hooks/logic-hooks/use-row-selection';
import { useFetchDocumentList } from '@/hooks/use-document-request';
import { t } from 'i18next';
import { pick } from 'lodash';
import { useMemo } from 'react';
import { ShowManageMetadataModalProps } from '../components/metedata/interface';
import ProcessLogModal from '../process-log-modal';
import { ChangeParserDialog } from './change-parser-dialog';
import { useShowLog } from './hooks';
import { FolderActionCell } from './folder-action-cell';
import { useChangeDocumentParser } from './use-change-document-parser';
import { useDatasetTableColumns } from './use-dataset-table-columns';
import { useRenameDocument } from './use-rename-document';

export type DatasetTableProps = Pick<
  ReturnType<typeof useFetchDocumentList>,
  'documents' | 'setPagination' | 'pagination' | 'loading'
> &
  Pick<UseRowSelectionType, 'rowSelection' | 'setRowSelection'> & {
    showManageMetadataModal: (config: ShowManageMetadataModalProps) => void;
    bulkOperateBarVisible?: boolean;
    /** 当前目录下的子目录，渲染在文件行之前。 */
    folders?: IDocumentFolder[];
    onEnterFolder?: (folderId: string) => void;
    onParseFolder?: (folder: IDocumentFolder) => void;
    onRenameFolder?: (folder: IDocumentFolder) => void;
    onMoveFolder?: (folder: IDocumentFolder) => void;
    onDeleteFolder?: (folder: IDocumentFolder) => void;
  };

export function DatasetTable({
  documents,
  pagination,
  setPagination,
  rowSelection,
  setRowSelection,
  showManageMetadataModal,
  bulkOperateBarVisible = false,
  folders = [],
  onEnterFolder,
  onParseFolder,
  onRenameFolder,
  onMoveFolder,
  onDeleteFolder,
}: DatasetTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});

  const {
    changeParserLoading,
    onChangeParserOk,
    changeParserVisible,
    hideChangeParserModal,
    showChangeParserModal,
    changeParserRecord,
  } = useChangeDocumentParser();

  const {
    renameLoading,
    onRenameOk,
    renameVisible,
    hideRenameModal,
    showRenameModal,
    initialName,
  } = useRenameDocument();

  const { showLog, logInfo, logVisible, hideLog } = useShowLog(documents);

  const columns = useDatasetTableColumns({
    showChangeParserModal,
    showRenameModal,
    showManageMetadataModal,
    showLog,
    setRowSelection,
  });

  const currentPagination = useMemo(() => {
    return {
      pageIndex: (pagination.current || 1) - 1,
      pageSize: pagination.pageSize || 10,
    };
  }, [pagination]);

  const table = useReactTable({
    data: documents,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => row.id, // Use document ID instead of row index
    manualPagination: true, //we're doing manual "server-side" pagination
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      pagination: currentPagination,
    },
    rowCount: pagination.total ?? 0,
  });

  return (
    // 整页文件的 owner id 一次查完，行内单元格从 context 取昵称/邮箱。
    <ResourceOwnerProvider userIds={documents.map((item) => item.created_by)}>
    <div className="w-full">
      <Table
        rootClassName={
          bulkOperateBarVisible
            ? 'max-h-[calc(100vh-320px)]'
            : 'max-h-[calc(100vh-280px)]'
        }
      >
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead
                    key={header.id}
                    className={header.column.columnDef.meta?.headerClassName}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody className="relative">
          {folders.map((folder) => (
            <TableRow key={folder.id} className="group">
              <TableCell />
              <TableCell>
                <div className="flex items-center gap-2">
                  <LucideFolder className="size-4 shrink-0 text-state-warning" />
                  <div className="min-w-0">
                    <button
                      type="button"
                      className="block max-w-[300px] truncate text-left font-medium hover:text-text-accent hover:underline"
                      title="进入文件夹"
                      onClick={() => onEnterFolder?.(folder.id)}
                    >
                      {folder.name}
                    </button>
                    <div className="text-[10.5px] text-text-secondary">
                      {folder.file_count} 个文件
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-text-secondary">
                {folder.create_time
                  ? new Date(folder.create_time).toLocaleString()
                  : '-'}
              </TableCell>
              {/* 启用 / 分块数 / 元数据 / 资源owner：文件夹没有这些属性，各占一格保持列对齐。 */}
              <TableCell className="text-text-secondary">—</TableCell>
              <TableCell className="text-text-secondary">—</TableCell>
              <TableCell className="text-text-secondary">—</TableCell>
              <TableCell className="text-text-secondary">—</TableCell>
              <TableCell>
                <button
                  type="button"
                  className="text-sm text-text-accent hover:underline"
                  title="解析文件夹"
                  onClick={() => onParseFolder?.(folder)}
                >
                  解析文件夹
                </button>
              </TableCell>
              <TableCell>
                <FolderActionCell
                  record={folder}
                  onRename={onRenameFolder}
                  onMove={onMoveFolder}
                  onDelete={onDeleteFolder}
                />
              </TableCell>
            </TableRow>
          ))}

          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-testid="document-row"
                data-doc-name={row.original.name}
                data-state={row.getIsSelected() && 'selected'}
                className="group"
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cell.column.columnDef.meta?.cellClassName}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            folders.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  <Empty type={EmptyType.Data} />
                </TableCell>
              </TableRow>
            )
          )}
        </TableBody>
      </Table>
      <div className="flex items-center justify-end  py-4 absolute bottom-3 right-8">
        <div className="space-x-2">
          <RAGFlowPagination
            {...pick(pagination, 'current', 'pageSize')}
            total={pagination.total}
            onChange={(page, pageSize) => {
              setPagination({ page, pageSize });
            }}
          ></RAGFlowPagination>
        </div>
      </div>
      {changeParserVisible && (
        <ChangeParserDialog
          record={changeParserRecord}
          visible={changeParserVisible}
          onOk={onChangeParserOk}
          hideModal={hideChangeParserModal}
          loading={changeParserLoading}
        />
      )}

      {renameVisible && (
        <RenameDialog
          visible={renameVisible}
          onOk={onRenameOk}
          loading={renameLoading}
          hideModal={hideRenameModal}
          initialName={initialName}
        ></RenameDialog>
      )}

      {logVisible && (
        <ProcessLogModal
          title={t('knowledgeDetails.fileLogs')}
          visible={logVisible}
          onCancel={() => hideLog()}
          logInfo={logInfo}
        />
      )}
    </div>
    </ResourceOwnerProvider>
  );
}
