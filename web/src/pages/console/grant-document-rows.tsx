import { useQuery } from '@tanstack/react-query';
import { LucideFileText } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Input } from '@/components/ui/input';
import { RAGFlowPagination } from '@/components/ui/ragflow-pagination';
import { TableCell, TableRow } from '@/components/ui/table';
import {
  GrantDocument,
  GrantSubject,
  fetchGrantDocuments,
} from '@/services/console-service';

import { GrantTarget, defaultScopeLabel } from './grant-dialog';
import { GrantKeys } from './grant-keys';

const DOCUMENT_PAGE_SIZE = 10;

function grantTagClass(grant: GrantSubject) {
  return grant.effect === 'deny'
    ? 'rounded bg-state-error/10 px-1.5 py-0.5 text-state-error'
    : 'rounded bg-accent-primary/10 px-1.5 py-0.5 text-accent-primary';
}

function grantTagLabel(grant: GrantSubject) {
  if (grant.effect === 'deny') return `拒绝 ${grant.name}`;
  const level = grant.permission === 'edit' ? '可编辑' : '可查看';
  return `${grant.name}（${level}）`;
}

interface DocumentRowProps {
  doc: GrantDocument;
  dataset: { resourceId: string; name: string; defaultScope: string };
  onEdit: (target: GrantTarget) => void;
}

/** 一行文件。可见范围保留「继承自知识库」与「已单独设置」的区分。 */
function DocumentRow({ doc, dataset, onEdit }: DocumentRowProps) {
  const handleEdit = useCallback(() => {
    onEdit({
      kind: 'document',
      resourceId: doc.document_id,
      name: doc.document_name || '未命名文件',
      parentId: dataset.resourceId,
      parentName: dataset.name,
      grants: doc.grants ?? [],
      // 文件级没有 legacy 二值字段：清空规则就等于继承知识库。
      defaultScope: 'inherit',
    });
  }, [dataset.name, dataset.resourceId, doc, onEdit]);

  return (
    <TableRow className="hover:bg-bg-list/50">
      <TableCell className="text-sm text-text-primary">
        <div className="flex items-center gap-2 pl-8">
          <LucideFileText className="size-3.5 shrink-0 text-text-secondary" />
          <span className="truncate">{doc.document_name || '-'}</span>
        </div>
      </TableCell>
      <TableCell className="text-xs text-text-secondary">文件</TableCell>
      <TableCell className="text-xs">
        {doc.created_by_name || doc.created_by || '-'}
      </TableCell>
      <TableCell className="text-xs">
        {doc.restricted ? (
          <div className="flex flex-wrap gap-1">
            {(doc.grants ?? []).map((grant, idx) => (
              <span
                key={`${grant.kind}-${grant.id}-${idx}`}
                className={grantTagClass(grant)}
              >
                {grantTagLabel(grant)}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-text-secondary">
            继承自知识库（{defaultScopeLabel(dataset.defaultScope)}）
          </span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs">
        <button
          type="button"
          className="text-accent-primary hover:underline"
          onClick={handleEdit}
        >
          设置
        </button>
      </TableCell>
    </TableRow>
  );
}

interface GrantDocumentRowsProps {
  tenantId: string;
  dataset: {
    resourceId: string;
    name: string;
    defaultScope: string;
  };
  onEdit: (target: GrantTarget) => void;
}

/**
 * 资源行展开后显示的文件列表。
 *
 * 只在展开时挂载，查询按库分页 —— 一个库可能有上千个文件，不展开的库不请求。
 */
export function GrantDocumentRows({
  tenantId,
  dataset,
  onEdit,
}: GrantDocumentRowsProps) {
  const [page, setPage] = useState(1);
  const [keywords, setKeywords] = useState('');

  const { data, isFetching } = useQuery({
    queryKey: GrantKeys.documents(
      tenantId,
      dataset.resourceId,
      page,
      DOCUMENT_PAGE_SIZE,
      keywords,
    ),
    queryFn: async () => {
      const res = await fetchGrantDocuments(tenantId, dataset.resourceId, {
        keywords: keywords || undefined,
        page,
        page_size: DOCUMENT_PAGE_SIZE,
      });
      return res?.data?.data ?? { documents: [], total: 0 };
    },
  });
  const documents: GrantDocument[] = data?.documents ?? [];
  const total = data?.total ?? 0;

  const handleKeywordsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setKeywords(e.target.value);
      setPage(1);
    },
    [],
  );

  const handlePageChange = useCallback((nextPage: number) => {
    setPage(nextPage);
  }, []);

  return (
    <>
      <TableRow className="bg-bg-list/60">
        <TableCell colSpan={5} className="py-2">
          <div className="flex flex-wrap items-center gap-3 pl-8">
            <span className="text-xs text-text-secondary">
              {isFetching ? '加载中…' : `共 ${total} 个文件`}
            </span>
            <Input
              value={keywords}
              onChange={handleKeywordsChange}
              placeholder="搜索文件名"
              className="h-7 w-48"
            />
            <span className="ml-auto text-xs text-text-secondary">
              未单独设置的文件继承知识库的可见范围
            </span>
          </div>
        </TableCell>
      </TableRow>

      {documents.length === 0 && (
        <TableRow>
          <TableCell
            colSpan={5}
            className="py-4 pl-8 text-xs text-text-secondary"
          >
            {isFetching ? '…' : '没有匹配的文件'}
          </TableCell>
        </TableRow>
      )}

      {documents.map((doc) => (
        <DocumentRow
          key={doc.document_id}
          doc={doc}
          dataset={dataset}
          onEdit={onEdit}
        />
      ))}

      {total > DOCUMENT_PAGE_SIZE && (
        <TableRow>
          <TableCell colSpan={5} className="py-1">
            <div className="flex justify-end">
              <RAGFlowPagination
                total={total}
                current={page}
                pageSize={DOCUMENT_PAGE_SIZE}
                onChange={handlePageChange}
              />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
