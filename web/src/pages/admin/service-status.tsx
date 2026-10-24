import { useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';

import {
  LucideClipboardList,
  LucideDot,
  LucideFilter,
  LucideRefreshCw,
  LucideSettings2,
} from 'lucide-react';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { TableEmpty } from '@/components/table-skeleton';
import { Badge, BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SearchInput } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { RAGFlowPagination } from '@/components/ui/ragflow-pagination';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { listServices, showServiceDetails } from '@/services/admin-service';

import {
  EMPTY_DATA,
  createColumnFilterFn,
  createFuzzySearchFn,
  getSortIcon,
} from './utils';

import JsonView from 'react18-json-view';
import 'react18-json-view/src/style.css';

import ServiceDetail from './service-detail';
import TaskExecutorDetail from './task-executor-detail';

const columnHelper = createColumnHelper<AdminService.ListServicesItem>();
const globalFilterFn = createFuzzySearchFn<AdminService.ListServicesItem>([
  'name',
  'service_type',
]);

const SERVICE_TYPE_FILTER_OPTIONS = [
  { value: 'ragflow_server', label: 'ragflow_server' },
  { value: 'meta_data', label: 'meta_data' },
  { value: 'file_store', label: 'file_store' },
  { value: 'retrieval', label: 'retrieval' },
  { value: 'message_queue', label: 'message_queue' },
];

/** 除服务名外都是短字段，按内容宽度收缩，剩余宽度全留给「服务名」。 */
const NARROW_COLUMN = (headerClassName: string) => ({
  headerClassName: `${headerClassName} whitespace-nowrap`,
  cellClassName: 'whitespace-nowrap',
});

const AdminServiceKeys = {
  list: () => ['admin/listServices'] as const,
  detail: (id: number | string | undefined) =>
    ['admin/serviceDetails', id] as const,
};

function AdminServiceStatus() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [extraInfoModalOpen, setExtraInfoModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [itemToMakeAction, setItemToMakeAction] =
    useState<AdminService.ListServicesItem | null>(null);

  const { data: servicesList, isFetching } = useQuery({
    queryKey: AdminServiceKeys.list(),
    queryFn: listServices,
    retry: false,
  });

  const { data: serviceDetails, error: serviceDetailsError } = useQuery({
    queryKey: AdminServiceKeys.detail(itemToMakeAction?.id),
    queryFn: () => showServiceDetails(itemToMakeAction!.id),
    enabled: !!(itemToMakeAction && detailModalOpen),
    retry: false,
  });

  const columnDefs = useMemo(
    () => [
      columnHelper.accessor('name', {
        header: t('admin.name'),
        meta: { headerClassName: 'w-[24%]' },
        cell: ({ cell }) => (
          <span className="font-medium text-text-primary">
            {cell.getValue()}
          </span>
        ),
      }),
      columnHelper.accessor('service_type', {
        header: t('admin.serviceType'),
        filterFn: createColumnFilterFn(
          (row, id, filterValue) => row.getValue(id) === filterValue,
          {
            autoRemove: (v) => !v,
            resolveFilterValue: (v) => v || null,
          },
        ),
        enableSorting: false,
        meta: NARROW_COLUMN('w-[20%]'),
      }),
      columnHelper.accessor('host', {
        header: t('admin.host'),
        cell: ({ cell }) => (
          <Badge variant="secondary">
            <i>{cell.getValue()}</i>
          </Badge>
        ),
        meta: NARROW_COLUMN('w-[18%]'),
      }),
      columnHelper.accessor('port', {
        header: t('admin.port'),
        cell: ({ cell }) => (
          <Badge variant="secondary">
            <i>{cell.getValue()}</i>
          </Badge>
        ),
        meta: NARROW_COLUMN('w-[10%]'),
      }),
      columnHelper.accessor('status', {
        header: t('admin.status'),
        cell: ({ cell }) => (
          <Badge
            variant={
              {
                alive: 'success',
                timeout: 'destructive',
                fail: 'grey',
              }[cell.getValue()] as BadgeProps['variant']
            }
            className="pl-[.5em] capitalize"
          >
            <LucideDot className="size-[1em] stroke-[8] mr-1" />
            {t(`admin.${cell.getValue()}`)}
          </Badge>
        ),
        enableSorting: false,
        meta: NARROW_COLUMN('w-[14%]'),
      }),
      columnHelper.display({
        id: 'actions',
        header: t('admin.actions'),
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="text-text-secondary"
              aria-label={t('admin.viewExtraInfo')}
              onClick={() => {
                setItemToMakeAction(row.original);
                setExtraInfoModalOpen(true);
              }}
            >
              <LucideSettings2 className="size-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="text-text-secondary"
              aria-label={t('admin.viewDetail')}
              onClick={() => {
                setItemToMakeAction(row.original);
                setDetailModalOpen(true);
              }}
            >
              <LucideClipboardList className="size-4" />
            </Button>
          </div>
        ),
        meta: NARROW_COLUMN('w-[10%]'),
      }),
    ],
    [t],
  );

  const table = useReactTable({
    data: servicesList ?? EMPTY_DATA,
    columns: columnDefs,

    globalFilterFn,

    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),

    enableSorting: false,
  });

  useEffect(() => {
    if (detailModalOpen && serviceDetailsError) {
      setDetailModalOpen(false);
    }
  }, [detailModalOpen, serviceDetailsError]);

  const filteredTotal = table.getFilteredRowModel().rows.length;
  const serviceTypeFilter = table
    .getColumn('service_type')
    ?.getFilterValue() as string;

  return (
    <>
      <div className="size-full min-w-0 overflow-auto px-5 py-4">
        <header className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-medium text-text-primary">
              {t('admin.serviceStatus')}
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              {t('admin.serviceStatusHint')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <SearchInput
              className="w-60"
              placeholder={t('admin.searchServicePlaceholder')}
              value={table.getState().globalFilter ?? ''}
              onChange={(e) => table.setGlobalFilter(e.target.value)}
            />

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="h-10 gap-2 px-3"
                  data-testid="admin-service-type-filter"
                >
                  <LucideFilter className="size-4" />
                  <span className="hidden max-w-40 truncate sm:inline">
                    {serviceTypeFilter || t('admin.allServiceTypes')}
                  </span>
                </Button>
              </PopoverTrigger>

              <PopoverContent align="end">
                <div className="p-2 space-y-6">
                  <section>
                    <div className="mb-3 font-bold">
                      {t('admin.serviceType')}
                    </div>

                    <RadioGroup
                      value={serviceTypeFilter ?? ''}
                      onValueChange={(value) =>
                        table.getColumn('service_type')?.setFilterValue(value)
                      }
                    >
                      <Label className="flex items-center space-x-2">
                        <RadioGroupItem
                          className="bg-bg-input border-border-button"
                          value=""
                        />
                        <span>{t('admin.all')}</span>
                      </Label>

                      {SERVICE_TYPE_FILTER_OPTIONS.map(({ label, value }) => (
                        <Label
                          key={value}
                          className="flex items-center space-x-2"
                        >
                          <RadioGroupItem
                            className="bg-bg-input border-border-button"
                            value={value}
                          />
                          <span>{label}</span>
                        </Label>
                      ))}
                    </RadioGroup>
                  </section>
                </div>

                <div className="pt-4 flex justify-end">
                  <Button
                    variant="outline"
                    className="dark:bg-bg-input dark:border-border-button text-text-secondary"
                    onClick={() => table.resetColumnFilters()}
                  >
                    {t('admin.reset')}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>

            <Button
              variant="outline"
              size="icon-lg"
              aria-label={t('admin.refresh')}
              data-testid="admin-service-refresh"
              onClick={() =>
                queryClient.invalidateQueries({
                  queryKey: AdminServiceKeys.list(),
                })
              }
            >
              <LucideRefreshCw
                className={isFetching ? 'size-4 animate-spin' : 'size-4'}
              />
            </Button>
          </div>
        </header>

        <Table rootClassName="max-h-[calc(100vh-240px)]">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={header.column.columnDef.meta?.headerClassName}
                  >
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <Button
                        variant="ghost"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        {getSortIcon(header.column.getIsSorted())}
                      </Button>
                    ) : (
                      flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className="group/row">
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
              <TableEmpty columnsLength={columnDefs.length} />
            )}
          </TableBody>
        </Table>

        <div className="flex items-center justify-end pt-3">
          <RAGFlowPagination
            total={filteredTotal}
            current={table.getState().pagination.pageIndex + 1}
            pageSize={table.getState().pagination.pageSize}
            onChange={(page, pageSize) => {
              table.setPagination({
                pageIndex: page - 1,
                pageSize,
              });
            }}
          />
        </div>
      </div>

      {/* Extra info modal*/}
      <Dialog open={extraInfoModalOpen} onOpenChange={setExtraInfoModalOpen}>
        <DialogContent
          className="flex flex-col max-h-[calc(100vh-4rem)] overflow-hidden"
          onAnimationEnd={() => {
            if (!extraInfoModalOpen) {
              setItemToMakeAction(null);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('admin.extraInfo')}</DialogTitle>
          </DialogHeader>

          <DialogDescription className="sr-only" />

          <ScrollArea className="h-0 flex-1 grid">
            <div className="px-6">
              <JsonView
                src={itemToMakeAction?.extra ?? {}}
                className="rounded-lg p-4 bg-bg-card break-words text-text-secondary"
              />
            </div>
          </ScrollArea>

          <DialogFooter className="flex justify-end gap-4 px-6 py-4">
            <Button
              className="px-4 h-10 dark:border-border-button"
              variant="outline"
              onClick={() => setExtraInfoModalOpen(false)}
            >
              {t('admin.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Service details modal */}
      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
        <DialogContent
          className="flex flex-col max-h-[calc(100vh-4rem)] max-w-6xl overflow-hidden"
          onAnimationEnd={() => {
            if (!detailModalOpen) {
              setItemToMakeAction(null);
            }
          }}
        >
          <DialogHeader className="p-6 border-b-0.5 border-border-button">
            <DialogTitle>
              {itemToMakeAction?.service_type === 'task_executor' ? (
                t('admin.taskExecutorDetail')
              ) : (
                <Trans i18nKey="admin.serviceDetail">
                  {{ name: itemToMakeAction?.name }}
                </Trans>
              )}
            </DialogTitle>
          </DialogHeader>

          <DialogDescription className="sr-only" />

          <ScrollArea className="h-0 flex-1 text-text-secondary grid">
            <div className="px-6">
              {itemToMakeAction?.service_type === 'task_executor' ? (
                <TaskExecutorDetail
                  content={
                    serviceDetails?.message as AdminService.TaskExecutorInfo
                  }
                />
              ) : (
                <ServiceDetail content={serviceDetails?.message} />
              )}
            </div>
          </ScrollArea>

          <DialogFooter className="flex justify-end gap-4 px-6 py-4">
            <Button
              className="px-4 h-10 dark:border-border-button"
              variant="outline"
              onClick={() => {
                setDetailModalOpen(false);
              }}
            >
              {t('admin.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default AdminServiceStatus;
