import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogNode,
} from '@/components/confirm-delete-dialog';
import { EmptyType } from '@/components/empty/constant';
import Empty from '@/components/empty/empty';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal/modal';
import { RAGFlowPagination } from '@/components/ui/ragflow-pagination';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RunningStatus } from '@/constants/knowledge';
import { Pagination } from '@/interfaces/common';
import { cn } from '@/lib/utils';
import ProcessLogModal, {
  ILogInfo,
  replaceText,
} from '@/pages/dataset/process-log-modal';
import { MemoryOptions } from '@/pages/memories/constants';
import { SessionPreviewCell } from './session-preview-cell';
import {
  ColumnDef,
  ColumnFiltersState,
  ExpandedState,
  Row,
  SortingState,
  VisibilityState,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import dayjs from 'dayjs';
import { t } from 'i18next';
import { pick } from 'lodash';
import {
  Copy,
  Eraser,
  ListChevronsDownUp,
  ListChevronsUpDown,
  TextSelect,
} from 'lucide-react';
import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { useMessageAction } from './hook';
import { IMessageInfo } from './interface';

export type MemoryTableProps = {
  messages: Array<IMessageInfo>;
  total: number;
  pagination: Pagination;
  setPagination: (params: { page: number; pageSize: number }) => void;
};

const columnHelper = createColumnHelper<IMessageInfo>();

function getTaskStatus(progress: number) {
  if (progress >= 1) {
    return RunningStatus.DONE;
  } else if (progress > 0 && progress < 1) {
    return RunningStatus.RUNNING;
  } else if (progress < 0) {
    return RunningStatus.FAIL;
  } else {
    return RunningStatus.UNSTART;
  }
}

type UpdateMessageStateFn = (
  message: IMessageInfo,
  enable: boolean,
) => Promise<boolean>;

/**
 * 「遗忘于」的空值统一渲染成破折号。
 *
 * 后端对「永不遗忘」有三种写法：null、空串、以及字符串 "None"
 * （历史数据里引擎写回的就是字面量 None），直接输出会在表格里显示成空白或
 * 莫名其妙的 "None"。
 */
function formatForgetAt(value: string | null | undefined) {
  if (!value || value === 'None' || value === 'null') {
    return '—';
  }
  return value;
}

function StatusSwitch({
  row,
  disabled,
  onUpdate,
}: {
  row: Row<IMessageInfo>;
  disabled: boolean;
  onUpdate: UpdateMessageStateFn;
}) {
  const serverStatus = row.original.status;
  const [optimisticStatus, setOptimisticStatus] = useState(serverStatus);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setOptimisticStatus(serverStatus);
  }, [serverStatus]);

  return (
    <div className="flex items-center">
      <Switch
        disabled={disabled || pending}
        checked={optimisticStatus}
        onCheckedChange={(val) => {
          setOptimisticStatus(val);
          setPending(true);
          onUpdate(row.original, val).then((success) => {
            setPending(false);
            if (!success) {
              setOptimisticStatus(serverStatus);
            }
          });
        }}
      />
    </div>
  );
}

export function MemoryTable({
  messages,
  total,
  pagination,
  setPagination,
}: MemoryTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [copied, setCopied] = useState(false);
  const {
    showDeleteDialog,
    setShowDeleteDialog,
    handleClickDeleteMessage,
    selectedMessage,
    handleDeleteMessage,

    handleClickUpdateMessageState,
    selectedMessageContent,
    showMessageContentDialog,
    setShowMessageContentDialog,
    handleClickMessageContentDialog,
  } = useMessageAction();

  const disabledRowFunc = (row: Row<IMessageInfo>) => {
    return row.original.forget_at !== 'None' && !!row.original.forget_at;
  };

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [logInfo, setLogInfo] = useState<ILogInfo>();
  const showLog = (row: Row<IMessageInfo>) => {
    const task = row.original.task;
    const logDetail = {
      startTime: dayjs(task.create_time)
        .locale(document.documentElement.lang)
        .format('MM/DD/YYYY HH:mm:ss'),
      status: getTaskStatus(task.progress),
      details: task.progress_msg,
    } as unknown as ILogInfo;
    setLogInfo(logDetail);
    setIsModalVisible(true);
  };
  // Define columns for the memory table
  const columns: ColumnDef<IMessageInfo>[] = useMemo(
    () => [
      {
        accessorKey: 'session_id',
        meta: {
          headerClassName: 'w-[1%] whitespace-nowrap',
          cellClassName: 'w-[1%] whitespace-nowrap',
        },
        header: ({ table }) => (
          <div className="flex items-center gap-1">
            <button
              {...{
                onClick: table.getToggleAllRowsExpandedHandler(),
              }}
            >
              {table.getIsAllRowsExpanded() ? (
                <ListChevronsDownUp size={16} />
              ) : (
                <ListChevronsUpDown size={16} />
              )}
            </button>{' '}
            <span>{t('memory.messages.sessionId')}</span>
          </div>
        ),
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            {row.getCanExpand() ? (
              <button
                {...{
                  onClick: row.getToggleExpandedHandler(),
                  style: { cursor: 'pointer' },
                }}
              >
                {row.getIsExpanded() ? (
                  <ListChevronsDownUp size={16} />
                ) : (
                  <ListChevronsUpDown size={16} />
                )}
              </button>
            ) : (
              ''
            )}
            {/* UUID 有 32 位，整串铺开要占 250px+，把整张表挤到横向滚动。
                这里截断显示，鼠标悬停用 title 给出完整 ID。 */}
            <div
              className={cn('max-w-[170px] truncate text-sm font-medium', {
                'pl-5': !row.getCanExpand(),
              })}
              title={row.getValue('session_id') as string}
            >
              {row.getValue('session_id')}
            </div>
          </div>
        ),
      },
      {
        // 会话名称来自 conversation.name，后端随列表一次批量带回。
        // 未命名会话给一个占位符，避免整列看起来是空的。
        accessorKey: 'session_name',
        header: () => <span>{t('memory.messages.session')}</span>,
        meta: {
          headerClassName: 'w-[1%] whitespace-nowrap',
          cellClassName: 'w-[1%] max-w-[150px] whitespace-nowrap',
        },
        cell: ({ row }) => (
          <div
            className="max-w-[150px] truncate text-sm font-medium"
            title={row.original.session_name || undefined}
          >
            {row.original.session_name || (
              <span className="text-text-disabled">
                {t('memory.messages.untitledSession')}
              </span>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'session_question',
        // 唯一一列不给 w-[1%]：让它吃掉剩余宽度。但必须给下限，
        // 否则其余列 nowrap 后它会被压成一条缝。
        meta: {
          headerClassName: 'min-w-[150px]',
          cellClassName: 'min-w-[150px]',
        },
        header: () => <span>{t('memory.messages.sessionPreview')}</span>,
        cell: ({ row }) => (
          <SessionPreviewCell
            sessionID={row.original.session_id}
            preview={row.original.session_question}
          />
        ),
      },
      {
        accessorKey: 'agent_name',
        header: () => <span>{t('memory.messages.agent')}</span>,
        meta: {
          headerClassName: 'w-[1%] whitespace-nowrap',
          cellClassName: 'w-[1%] max-w-[120px] whitespace-nowrap',
        },
        cell: ({ row }) => (
          <div
            className="max-w-[120px] truncate text-sm font-medium"
            title={row.getValue('agent_name') as string}
          >
            {row.getValue('agent_name')}
          </div>
        ),
      },
      {
        accessorKey: 'message_type',
        header: () => <span>{t('memory.messages.type')}</span>,
        // 列宽必须 nowrap：窄屏下「原始」会被压成竖排的「原 / 始」。
        meta: {
          headerClassName: 'w-[1%] whitespace-nowrap',
          cellClassName: 'w-[1%] whitespace-nowrap',
        },
        cell: ({ row }) => (
          <div className="text-sm font-medium capitalize">
            {row.getValue('message_type')
              ? MemoryOptions(t).find(
                  (item) =>
                    item.value === (row.getValue('message_type') as string),
                )?.label
              : row.getValue('message_type')}
          </div>
        ),
      },
      {
        accessorKey: 'valid_at',
        header: () => <span>{t('memory.messages.validDate')}</span>,
        meta: {
          headerClassName: 'w-[1%] whitespace-nowrap',
          cellClassName: 'w-[1%] whitespace-nowrap',
        },
        cell: ({ row }) => (
          <div className="text-sm ">{row.getValue('valid_at')}</div>
        ),
      },
      {
        accessorKey: 'forget_at',
        header: () => <span>{t('memory.messages.forgetAt')}</span>,
        meta: {
          headerClassName: 'w-[1%] whitespace-nowrap',
          cellClassName: 'w-[1%] whitespace-nowrap',
        },
        cell: ({ row }) => (
          <div className="text-sm">
            {formatForgetAt(row.getValue('forget_at') as string)}
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: () => <span>{t('memory.messages.enable')}</span>,
        meta: {
          headerClassName: 'w-[1%] whitespace-nowrap',
          cellClassName: 'w-[1%] whitespace-nowrap',
        },
        cell: ({ row }) => (
          <StatusSwitch
            row={row}
            disabled={disabledRowFunc(row)}
            onUpdate={handleClickUpdateMessageState}
          />
        ),
      },
      columnHelper.display({
        id: 'task_progress',
        meta: {
          headerClassName: 'w-[1%]',
          cellClassName: 'w-[1%] whitespace-nowrap',
        },
        cell: ({ row }) => {
          const { task } = row.original;

          if (!task) {
            return null;
          }

          const taskStatus = getTaskStatus(task.progress);

          return (
            <Button
              variant="transparent"
              size="icon"
              className="border-0 size-8"
              onClick={() => {
                showLog(row);
              }}
            >
              <div
                className={cn('size-1 rounded-full', {
                  'bg-state-success': taskStatus === RunningStatus.DONE,
                  'bg-state-error': taskStatus === RunningStatus.FAIL,
                  'bg-state-warning': taskStatus === RunningStatus.RUNNING,
                  'bg-text-secondary': taskStatus === RunningStatus.UNSTART,
                })}
              />
            </Button>
          );
        },
      }),
      {
        // 操作列默认常显：原先用 opacity-0 + group-hover 隐藏，
        // 结果整列看起来是空的（尤其行没 hover 时），用户以为功能没了。
        accessorKey: 'action',
        header: () => <span>{t('memory.messages.action')}</span>,
        meta: {
          headerClassName: 'w-[1%] whitespace-nowrap',
          cellClassName: 'w-[1%] whitespace-nowrap',
        },
        cell: ({ row }) => (
          <div className="flex items-center">
            <Button
              variant={'ghost'}
              className="size-8 bg-transparent"
              onClick={() => {
                handleClickMessageContentDialog(row.original);
              }}
            >
              <TextSelect />
            </Button>
            <Button
              variant={'delete'}
              disabled={disabledRowFunc(row)}
              className="size-8 bg-transparent"
              aria-label="Edit"
              onClick={() => {
                handleClickDeleteMessage(row.original);
              }}
            >
              <Eraser />
            </Button>
          </div>
        ),
      },
    ],
    [
      handleClickDeleteMessage,
      handleClickUpdateMessageState,
      handleClickMessageContentDialog,
    ],
  );

  const currentPagination = useMemo(() => {
    return {
      pageIndex: (pagination.current || 1) - 1,
      pageSize: pagination.pageSize || 10,
    };
  }, [pagination]);
  const [expanded, setExpanded] = React.useState<ExpandedState>({});
  const table = useReactTable({
    data: messages,
    columns,
    onExpandedChange: setExpanded,
    getSubRows: (row) => (row.extract as IMessageInfo[]) || undefined,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    manualPagination: true,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      pagination: currentPagination,
      expanded,
    },
    rowCount: total,
  });

  return (
    <div className="w-full">
      <Table rootClassName="max-h-[calc(100vh-292px)]">
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className={cn(header.column.columnDef.meta?.headerClassName)}
                >
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
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && 'selected'}
                className={cn('group', {
                  'bg-bg-list/5': !row.getCanExpand(),
                })}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cn(cell.column.columnDef.meta?.cellClassName)}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
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
      {showDeleteDialog && (
        <ConfirmDeleteDialog
          onOk={handleDeleteMessage}
          title={t('memory.messages.forgetMessage')}
          open={showDeleteDialog}
          onOpenChange={setShowDeleteDialog}
          okButtonText={t('memory.messages.forget')}
          content={{
            title: t('memory.messages.forgetMessageTip'),
            node: (
              <ConfirmDeleteDialogNode
                // avatar={{ avatar: selectedMessage.avatar, name: selectedMessage.name }}
                name={
                  t('memory.messages.sessionId') +
                  ': ' +
                  selectedMessage.session_id
                }
                warnText={t('memory.messages.delMessageWarn')}
              />
            ),
          }}
        />
      )}

      {showMessageContentDialog && (
        <Modal
          title={t('memory.messages.content')}
          open={showMessageContentDialog}
          onOpenChange={setShowMessageContentDialog}
          className="!w-[640px]"
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowMessageContentDialog(false)}
                className={
                  'px-2 py-1 border border-border-button rounded-md hover:bg-bg-card hover:text-text-primary '
                }
              >
                {t('common.close')}
              </button>
            </div>
          }
        >
          <div className="flex flex-col gap-2.5">
            <div className="text-text-secondary text-sm">
              {t('memory.messages.sessionId')}:&nbsp;&nbsp;
              {selectedMessage.session_id}
            </div>
            {selectedMessageContent?.content && (
              <div className="w-full bg-accent-primary-5  whitespace-pre-line text-wrap rounded-lg h-fit max-h-[350px] overflow-y-auto scrollbar-auto px-2.5 py-1">
                {replaceText(selectedMessageContent?.content || '')}
              </div>
            )}
            {selectedMessageContent?.content_embed && (
              <div className="flex gap-2 items-center">
                <CopyToClipboard
                  text={selectedMessageContent?.content_embed}
                  onCopy={() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1000);
                  }}
                >
                  <Button
                    variant={'ghost'}
                    className="border border-border-button "
                  >
                    {t('memory.messages.contentEmbed')}
                    <Copy />
                  </Button>
                </CopyToClipboard>
                {copied && (
                  <span className="text-xs text-text-secondary">
                    {t('memory.messages.copied')}
                  </span>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}

      {isModalVisible && (
        <ProcessLogModal
          title={t('memory.taskLogDialog.title')}
          visible={isModalVisible}
          onCancel={() => setIsModalVisible(false)}
          translateKey="memory.taskLogDialog"
          logInfo={logInfo as unknown as ILogInfo}
        />
      )}

      <div className="flex items-center justify-end  absolute bottom-3 right-3">
        <RAGFlowPagination
          {...pick(pagination, 'current', 'pageSize')}
          total={total}
          onChange={(page, pageSize) => {
            setPagination({ page, pageSize });
          }}
        />
      </div>
    </div>
  );
}
