import { useQuery } from '@tanstack/react-query';
import {
  LucideChevronRight,
  LucidePlus,
  LucideShieldCheck,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { RAGFlowPagination } from '@/components/ui/ragflow-pagination';
import {
  GrantExceptionItem,
  GrantSubject,
  GrantTreeNode,
  GrantVisibility,
  fetchGrantExceptions,
} from '@/services/console-service';

import { GrantTarget, VISIBILITY_OPTIONS } from './grant-dialog';
import { GrantKeys } from './grant-keys';
import { GrantSummaryBadge } from './grant-tree';

const EXCEPTION_PREVIEW_SIZE = 6;
const EXCEPTION_PAGE_SIZE = 20;

/** 标题旁的层级标签：点的是库还是文件夹，一眼要能分开。 */
const NODE_KIND_LABEL: Record<string, string> = {
  dataset: '知识库',
  folder: '文件夹',
  file: '文件',
};

/**
 * 规则标签：允许是蓝底，拒绝是红底 —— 拒绝在这份列表里最需要被看见。
 *
 * grants 为空不等于「没有规则」：例外列表里的每一行都至少有一条规则，只是
 * 主体可能已经解析不出名字（成员被移出租户、历史脏数据）。这时必须给一个
 * 明确占位，否则整个标签格留白，看起来像这一行渲染坏了。
 */
function GrantChips({
  grants,
  restricted,
}: {
  grants: GrantSubject[];
  restricted?: boolean;
}) {
  if (grants.length === 0) {
    if (!restricted) return null;
    return (
      <span
        className="rounded bg-background-second px-1.5 py-0.5 text-[11px] leading-4 text-text-secondary"
        title="这一项有独立规则，但规则主体已不可解析；点「调整」重新设置"
      >
        规则主体未知
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {grants.map((grant, idx) => (
        <span
          key={`${grant.kind}-${grant.id}-${idx}`}
          className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] leading-4 ${
            grant.effect === 'deny'
              ? 'bg-state-error/10 text-state-error'
              : 'bg-accent-primary/10 text-accent-primary'
          }`}
        >
          {grant.kind === 'team' ? '全团队' : grant.name}
          {grant.effect === 'deny'
            ? '·已排除'
            : grant.permission === 'read'
              ? '·只读'
              : '·可编辑'}
        </span>
      ))}
    </div>
  );
}

interface ExceptionRowProps {
  item: GrantExceptionItem;
  onEdit: (item: GrantExceptionItem) => void;
  onClear: (item: GrantExceptionItem) => void;
}

function ExceptionRow({ item, onEdit, onClear }: ExceptionRowProps) {
  const handleEdit = useCallback(() => onEdit(item), [item, onEdit]);
  const handleClear = useCallback(() => onClear(item), [item, onClear]);

  return (
    <div className="flex items-center gap-4 border-t border-border-default px-3 py-2 first:border-t-0">
      {/* 名称、路径与规则标签同一列：名字长时截断，标签始终紧跟名字右侧，
          不会再飘到行中间、和右边的操作按钮挤在一起。 */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm text-text-primary" title={item.resource_name}>
            {item.node_kind === 'folder' ? '📁 ' : ''}
            {item.resource_name}
          </div>
          {item.path && (
            <div className="truncate text-[11px] text-text-secondary" title={item.path}>
              {item.path}
            </div>
          )}
        </div>
        <div className="shrink-0">
          <GrantChips grants={item.grants ?? []} restricted={item.restricted} />
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-3 text-xs">
        <button
          type="button"
          className="text-accent-primary hover:underline"
          onClick={handleEdit}
        >
          调整
        </button>
        <button
          type="button"
          className="text-text-secondary hover:text-text-primary"
          onClick={handleClear}
          title="清空这条规则，恢复继承本层设置"
        >
          取消例外
        </button>
      </div>
    </div>
  );
}

interface GrantExceptionDialogProps {
  tenantId: string;
  kind: string;
  datasetId: string;
  folderId: string;
  title: string;
  open: boolean;
  onClose: () => void;
  onEdit: (item: GrantExceptionItem) => void;
  onClear: (item: GrantExceptionItem) => void;
}

/**
 * 「查看全部文件」：把这一层下的子项一次列全。
 *
 * 默认视图只给例外，否则一个 44 个文件的库会把"谁被特殊照顾了"淹掉；要逐项确认
 * 才打开这个弹窗，它按 includeAll 拉全量并标出每项是否仍在继承。
 */
function GrantExceptionDialog({
  tenantId,
  kind,
  datasetId,
  folderId,
  title,
  open,
  onClose,
  onEdit,
  onClear,
}: GrantExceptionDialogProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(EXCEPTION_PAGE_SIZE);
  const [keywords, setKeywords] = useState('');

  const { data, isFetching } = useQuery({
    queryKey: GrantKeys.exceptions(
      tenantId,
      kind,
      datasetId,
      folderId,
      keywords,
      true,
      page,
      pageSize,
    ),
    enabled: open && !!tenantId,
    queryFn: async () => {
      const res = await fetchGrantExceptions(tenantId, {
        kind,
        dataset_id: datasetId || undefined,
        folder_id: folderId || undefined,
        keywords: keywords || undefined,
        all: true,
        page,
        page_size: pageSize,
      });
      return (
        res?.data?.data ?? {
          items: [],
          total: 0,
          file_total: 0,
          exception_total: 0,
        }
      );
    },
  });
  const items = data?.items ?? [];

  const handleKeywordsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setKeywords(e.target.value);
      setPage(1);
    },
    [],
  );
  const handlePageChange = useCallback((nextPage: number, nextSize: number) => {
    setPage(nextPage);
    setPageSize(nextSize);
  }, []);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs text-text-secondary">
            共 {data?.total ?? 0} 项，其中 {data?.exception_total ?? 0} 项有独立规则；
            其余仍在继承本层设置
          </p>
          <div className="relative">
            <Input
              value={keywords}
              onChange={handleKeywordsChange}
              placeholder="搜索文件名称"
              className="h-8 w-48"
            />
          </div>
        </div>

        <div className="max-h-[52vh] overflow-auto rounded-md border border-border-default">
          {items.length === 0 ? (
            <p className="py-8 text-center text-xs text-text-secondary">
              {isFetching ? '…' : '没有匹配的文件'}
            </p>
          ) : (
            items.map((item) => (
              <ExceptionRow
                key={`${item.grant_kind}-${item.resource_id}`}
                item={item}
                onEdit={onEdit}
                onClear={onClear}
              />
            ))
          )}
        </div>

        <div className="flex items-center justify-end pt-2">
          <RAGFlowPagination
            total={data?.total ?? 0}
            current={page}
            pageSize={pageSize}
            onChange={handlePageChange}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface GrantDetailPanelProps {
  tenantId: string;
  kind: string;
  node: GrantTreeNode;
  trail: GrantTreeNode[];
  /** 最近的可授权祖先及其规则，用于「继承自」那一行。 */
  inheritedFrom?: { node: GrantTreeNode; grants: GrantSubject[] };
  onEdit: (target: GrantTarget) => void;
  onRemove: (target: GrantTarget, subject: GrantSubject) => void;
  onClearException: (item: GrantExceptionItem) => void;
  onVisibilityChange: (node: GrantTreeNode, next: GrantVisibility) => void;
}

/**
 * 右侧详情面板：这一层给了谁、例外在哪、其余继承什么。
 *
 * 页面主体是「授权」而不是「资源」：本层授权永远只有几行，例外才需要往下翻，
 * 所以前者平铺、后者可折叠可搜索。
 */
export function GrantDetailPanel({
  tenantId,
  kind,
  node,
  trail,
  inheritedFrom,
  onEdit,
  onRemove,
  onClearException,
  onVisibilityChange,
}: GrantDetailPanelProps) {
  const [viewAllOpen, setViewAllOpen] = useState(false);

  const datasetId = useMemo(() => {
    if (kind !== 'dataset') return '';
    return node.node_kind === 'dataset' ? node.id : (node.parent_grant_id ?? '');
  }, [kind, node]);

  const folderId = useMemo(() => {
    if (kind === 'file') {
      return node.node_kind === 'folder' ? node.id : '';
    }
    return node.node_kind === 'folder' ? node.id : '';
  }, [kind, node]);

  const isLeafFile = node.node_kind === 'file';

  const { data, isLoading: exceptionsLoading } = useQuery({
    queryKey: GrantKeys.exceptions(
      tenantId,
      kind,
      datasetId,
      folderId,
      '',
      false,
      1,
      EXCEPTION_PREVIEW_SIZE,
    ),
    enabled: !!tenantId && !isLeafFile,
    queryFn: async () => {
      const res = await fetchGrantExceptions(tenantId, {
        kind,
        dataset_id: datasetId || undefined,
        folder_id: folderId || undefined,
        page: 1,
        page_size: EXCEPTION_PREVIEW_SIZE,
      });
      return (
        res?.data?.data ?? {
          items: [],
          total: 0,
          file_total: 0,
          exception_total: 0,
        }
      );
    },
  });

  const target: GrantTarget = useMemo(
    () => ({
      kind: node.grant_kind ?? '',
      resourceId: node.id,
      name: node.name,
      parentId: node.parent_grant_id,
      parentName: trail.length > 1 ? trail[trail.length - 2].name : undefined,
      grants: node.grants ?? [],
      supportsDeny: node.supports_deny,
      defaultScope:
        node.visibility ||
        (node.node_kind === 'dataset' || node.node_kind === 'file'
          ? 'owner'
          : 'inherit'),
      scopeHint: isLeafFile
        ? undefined
        : `本层及全部 ${node.file_count} 个文件；子项自己设置过的规则优先`,
    }),
    [isLeafFile, node, trail],
  );

  const handleEdit = useCallback(() => onEdit(target), [onEdit, target]);
  const handleExceptionEdit = useCallback(
    (item: GrantExceptionItem) =>
      onEdit({
        kind: item.grant_kind,
        resourceId: item.resource_id,
        name: item.resource_name,
        parentId: item.parent_grant_id,
        parentName: node.name,
        grants: item.grants ?? [],
        defaultScope: 'inherit',
        supportsDeny: item.supports_deny,
        // 「添加例外」在知识库内就是排除；文件管理的文件没有排除语义，
        // 例外表现为单独放开，所以默认仍是允许。
        initialEffect: item.supports_deny ? 'deny' : 'allow',
      }),
    [node.name, onEdit],
  );
  const handleVisibilityChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) =>
      onVisibilityChange(node, e.target.value as GrantVisibility),
    [node, onVisibilityChange],
  );

  const items = data?.items ?? [];
  const fileTotal = data?.file_total ?? 0;
  const exceptionTotal = data?.exception_total ?? node.exception_count;
  const inheritedFiles = Math.max(fileTotal - exceptionTotal, 0);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-border-default pb-3">
        <div className="flex flex-wrap items-center gap-1 text-xs text-text-secondary">
          {trail.slice(0, -1).map((item, idx) => (
            <span key={item.id} className="flex items-center gap-1">
              {idx > 0 && (
                <LucideChevronRight className="size-3 text-text-secondary/60" />
              )}
              <span className="max-w-[220px] truncate" title={item.name}>
                {item.name}
              </span>
            </span>
          ))}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-medium text-text-primary">{node.name}</h2>
          <span className="rounded bg-background-second px-1.5 py-0.5 text-[11px] leading-4 text-text-secondary">
            {NODE_KIND_LABEL[node.node_kind] ?? node.node_kind}
          </span>
          <GrantSummaryBadge summary={node.summary} />
          {node.owner_name && (
            <span className="text-xs text-text-secondary">
              所有者 {node.owner_name}
            </span>
          )}
          <span className="ml-auto flex items-center gap-2">
            {node.supports_visibility && (
              <select
                value={node.visibility || 'owner'}
                onChange={handleVisibilityChange}
                className="h-8 rounded-md border border-border-default bg-bg-base px-2 text-xs text-text-primary outline-none"
                title="可见范围：三档收窄，普通成员需逐人授权"
              >
                {VISIBILITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
            {node.grant_kind && (
              <Button variant="secondary" className="h-8" onClick={handleEdit}>
                <LucidePlus className="mr-1 size-3.5" />
                添加授权
              </Button>
            )}
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-auto pt-4">
        <section>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-medium text-text-primary">本层授权</h3>
            <span className="text-xs text-text-secondary">
              {node.grant_kind
                ? '只有这里列出的主体能看到本层；其余按可见范围'
                : '文件夹不单独授权，规则落在知识库与文件上'}
            </span>
          </div>

          {node.grant_kind == null || node.grant_kind === '' ? (
            <div className="rounded-md border border-border-default bg-background-second p-3 text-xs text-text-secondary">
              本层没有独立规则，全部继承
              {inheritedFrom ? `「${inheritedFrom.node.name}」` : '上级'}。
              {inheritedFrom && inheritedFrom.grants.length > 0 && (
                <div className="mt-2">
                  <GrantChips grants={inheritedFrom.grants} />
                </div>
              )}
            </div>
          ) : node.grants.length === 0 ? (
            <div className="rounded-md border border-dashed border-border-default p-3 text-xs text-text-secondary">
              暂无显式授权。当前可见范围：
              {node.supports_visibility
                ? VISIBILITY_OPTIONS.find(
                    (o) => o.value === (node.visibility || 'owner'),
                  )?.label
                : '仅所有者可见'}
              ，普通成员需要逐人授权。
              <button
                type="button"
                className="ml-2 text-accent-primary hover:underline"
                onClick={handleEdit}
              >
                添加授权
              </button>
            </div>
          ) : (
            <div className="rounded-md border border-border-default">
              {node.grants.map((grant, idx) => (
                <div
                  key={`${grant.kind}-${grant.id}-${idx}`}
                  className="flex items-center gap-3 border-t border-border-default px-3 py-2 first:border-t-0"
                >
                  <span className="size-1.5 shrink-0 rounded-full bg-state-success" />
                  <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                    {grant.kind === 'team' ? '全团队' : grant.name}
                  </span>
                  {/* 名字已经在左边了，这里只补权限级别，避免同一行重复两遍。 */}
                  <span className="shrink-0 text-xs text-text-secondary">
                    {grant.kind === 'department' ? '部门 · ' : ''}
                    {grant.permission === 'edit' ? '可编辑' : '可查看'}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-xs text-text-secondary hover:text-text-primary"
                    onClick={() => onRemove(target, grant)}
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {!isLeafFile && (
          <section>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-sm font-medium text-text-primary">子项例外</h3>
              <span className="text-xs text-text-secondary">
                只列不再继承本层设置的文件
              </span>
              <button
                type="button"
                className="ml-auto text-xs text-accent-primary hover:underline"
                onClick={() => setViewAllOpen(true)}
              >
                查看全部文件
              </button>
            </div>

            {exceptionsLoading ? (
              <div
                aria-busy="true"
                className="space-y-2 rounded-md border border-border-default p-3"
              >
                <div className="h-3 w-1/3 animate-pulse rounded bg-background-second" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-background-second" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex items-center gap-2 rounded-md border border-border-default bg-state-success/5 p-3 text-xs text-text-secondary">
                <LucideShieldCheck className="size-4 shrink-0 text-state-success" />
                {fileTotal > 0
                  ? `全部 ${fileTotal} 个文件都继承本层设置，没有单独例外。`
                  : '这里还没有文件。'}
              </div>
            ) : (
              <>
                <div className="rounded-md border border-border-default">
                  {items.map((item) => (
                    <ExceptionRow
                      key={`${item.grant_kind}-${item.resource_id}`}
                      item={item}
                      onEdit={handleExceptionEdit}
                      onClear={onClearException}
                    />
                  ))}
                </div>
                <p className="mt-2 text-xs text-text-secondary">
                  其余 {inheritedFiles} 个仍继承本层设置
                  {exceptionTotal > items.length
                    ? `；还有 ${exceptionTotal - items.length} 项例外，点「查看全部文件」逐项确认`
                    : '。'}
                </p>
              </>
            )}
          </section>
        )}
      </div>

      <GrantExceptionDialog
        tenantId={tenantId}
        kind={kind}
        datasetId={datasetId}
        folderId={folderId}
        title={`${node.name} · 全部文件`}
        open={viewAllOpen}
        onClose={() => setViewAllOpen(false)}
        onEdit={handleExceptionEdit}
        onClear={onClearException}
      />
    </section>
  );
}
