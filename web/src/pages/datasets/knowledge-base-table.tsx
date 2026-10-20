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
import { RAGFlowPagination } from '@/components/ui/ragflow-pagination';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { IDataset, IDatasetReference } from '@/interfaces/database/dataset';
import { pick } from 'lodash';
import { useMemo } from 'react';
import { useRenameDataset } from './use-rename-dataset';
import { useKnowledgeBaseColumns } from './use-knowledge-base-columns';

export type KnowledgeBaseTableProps = {
  data: IDataset[];
  pagination: {
    current: number;
    pageSize: number;
    total: number;
  };
  setPagination: (params: { page: number; pageSize: number }) => void;
  showDatasetRenameModal: ReturnType<typeof useRenameDataset>['showDatasetRenameModal'];
  onDisableBlocked: (dataset: IDataset, references: IDatasetReference[]) => void;
};

export function KnowledgeBaseTable({
  data,
  pagination,
  setPagination,
  showDatasetRenameModal,
  onDisableBlocked,
}: KnowledgeBaseTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});

  const columns = useKnowledgeBaseColumns({
    pagination: pick(pagination, 'current', 'pageSize'),
    showDatasetRenameModal,
    onDisableBlocked,
  });

  const currentPagination = useMemo(
    () => ({
      pageIndex: (pagination.current || 1) - 1,
      pageSize: pagination.pageSize || 10,
    }),
    [pagination],
  );

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    manualPagination: true,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      pagination: currentPagination,
    },
    rowCount: pagination.total ?? 0,
  });

  return (
    <div className="flex flex-col gap-4">
      <Table rootClassName="max-h-[calc(100vh-280px)]">
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody className="relative">
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} data-testid="knowledge-base-row">
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cell.column.columnDef.meta?.cellClassName}
                  >
                    {flexRender(
                      cell.column.columnDef.cell,
                      cell.getContext(),
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                <Empty type={EmptyType.Data} />
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <div className="flex items-center justify-end px-5 pb-5">
        <RAGFlowPagination
          {...pick(pagination, 'current', 'pageSize')}
          total={pagination.total}
          onChange={(page, pageSize) => {
            setPagination({ page, pageSize });
          }}
        />
      </div>
    </div>
  );
}
