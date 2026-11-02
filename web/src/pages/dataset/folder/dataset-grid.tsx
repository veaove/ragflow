import { EmptyType } from '@/components/empty/constant';
import Empty from '@/components/empty/empty';
import { IngestionTaskStatus } from '@/constants/knowledge';
import {
  IDocumentFolder,
  IDocumentInfo,
} from '@/interfaces/database/document';
import {
  LucideArrowRightSquare,
  LucideFolder,
  LucidePlay,
} from 'lucide-react';

const formatSize = (bytes?: number) => {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const statusOf = (doc: IDocumentInfo) => {
  switch (doc.ingestion_status) {
    case IngestionTaskStatus.COMPLETED:
      return { text: '已解析', className: 'bg-state-success/10 text-state-success' };
    case IngestionTaskStatus.RUNNING:
    case IngestionTaskStatus.SCHEDULED:
    case IngestionTaskStatus.CREATED:
    case IngestionTaskStatus.STOPPING:
      return { text: '解析中', className: 'bg-state-warning/10 text-state-warning' };
    case IngestionTaskStatus.FAILED:
      return { text: '解析失败', className: 'bg-state-error/10 text-state-error' };
    default:
      return { text: '未解析', className: 'bg-bg-card text-text-secondary' };
  }
};

/**
 * 平铺视图（对齐原型）：文件夹与文件靠图标 + 元信息区分，
 * hover 才出现勾选与快捷操作，避免静态时整屏都是控件。
 */
export function DatasetGrid({
  folders,
  documents,
  selectedIds,
  onEnterFolder,
  onToggleSelect,
  onParseFolder,
  onMoveFolder,
  onParseDocument,
  onMoveDocument,
}: {
  folders: IDocumentFolder[];
  documents: IDocumentInfo[];
  selectedIds: Set<string>;
  onEnterFolder: (folderId: string) => void;
  onToggleSelect: (id: string, selected: boolean) => void;
  onParseFolder: (folder: IDocumentFolder) => void;
  onMoveFolder: (folder: IDocumentFolder) => void;
  onParseDocument: (doc: IDocumentInfo) => void;
  onMoveDocument: (doc: IDocumentInfo) => void;
}) {
  if (folders.length === 0 && documents.length === 0) {
    return (
      <div className="py-12">
        <Empty type={EmptyType.Data} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 px-1 py-4">
      {folders.map((folder) => (
        <div
          key={folder.id}
          className="group relative flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-border-default bg-bg-base p-3 hover:border-text-accent hover:shadow-sm"
          onClick={() => onEnterFolder(folder.id)}
        >
          <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 group-hover:opacity-100">
            <button
              type="button"
              title="解析"
              className="rounded bg-bg-base px-1 text-text-secondary hover:text-text-accent"
              onClick={(e) => {
                e.stopPropagation();
                onParseFolder(folder);
              }}
            >
              <LucidePlay className="size-3.5" />
            </button>
            <button
              type="button"
              title="移动"
              className="rounded bg-bg-base px-1 text-text-secondary hover:text-text-accent"
              onClick={(e) => {
                e.stopPropagation();
                onMoveFolder(folder);
              }}
            >
              <LucideArrowRightSquare className="size-3.5" />
            </button>
          </div>
          <LucideFolder className="size-11 text-state-warning" />
          <div className="line-clamp-2 min-h-[35px] break-all text-center text-xs">
            {folder.name}
          </div>
          <div className="text-[10px] text-text-secondary">
            {folder.file_count} 个文件
          </div>
        </div>
      ))}

      {documents.map((doc) => {
        const status = statusOf(doc);
        const selected = selectedIds.has(doc.id);
        return (
          <div
            key={doc.id}
            className={`group relative flex cursor-pointer flex-col items-center gap-2 rounded-lg border p-3 ${
              selected
                ? 'border-text-accent bg-bg-card'
                : 'border-border-default bg-bg-base hover:border-text-accent hover:shadow-sm'
            }`}
            onClick={() => onToggleSelect(doc.id, !selected)}
          >
            <input
              type="checkbox"
              className={`absolute left-1.5 top-1.5 ${selected ? '' : 'opacity-0 group-hover:opacity-100'}`}
              checked={selected}
              onChange={(e) => onToggleSelect(doc.id, e.target.checked)}
              onClick={(e) => e.stopPropagation()}
            />
            <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 group-hover:opacity-100">
              <button
                type="button"
                title="解析"
                className="rounded bg-bg-base px-1 text-text-secondary hover:text-text-accent"
                onClick={(e) => {
                  e.stopPropagation();
                  onParseDocument(doc);
                }}
              >
                <LucidePlay className="size-3.5" />
              </button>
              <button
                type="button"
                title="移动"
                className="rounded bg-bg-base px-1 text-text-secondary hover:text-text-accent"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveDocument(doc);
                }}
              >
                <LucideArrowRightSquare className="size-3.5" />
              </button>
            </div>
            <div className="text-3xl opacity-80">📄</div>
            <div className="line-clamp-2 min-h-[35px] break-all text-center text-xs">
              {doc.name}
            </div>
            <div className="text-[10px] text-text-secondary">
              {formatSize(doc.size)}
            </div>
            <span className={`rounded px-1.5 py-0.5 text-[10px] ${status.className}`}>
              {status.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}
