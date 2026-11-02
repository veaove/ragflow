import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal/modal';
import {
  IDocumentFolder,
  IDocumentFolderParseSummary,
} from '@/interfaces/database/document';
import { useEffect, useMemo, useState } from 'react';
import { ROOT_FOLDER, buildFolderTree, descendantFolderIds } from './utils';

/** 新建目录：只有在根目录或某一个已有目录下建，父路径要显示出来，避免建错层。 */
export function CreateFolderDialog({
  open,
  onOpenChange,
  parentPath,
  onOk,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentPath: string;
  onOk: (name: string) => void;
  loading?: boolean;
}) {
  const [name, setName] = useState('');

  useEffect(() => {
    if (open) setName('');
  }, [open]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="新建文件夹"
      onOk={() => onOk(name.trim())}
      confirmLoading={loading}
      disabled={!name.trim()}
      okText="创建"
    >
      <div className="space-y-3">
        <div className="text-sm text-text-secondary">
          位置：<span className="text-text-primary">{parentPath}</span>
        </div>
        <Input
          autoFocus
          value={name}
          maxLength={255}
          placeholder="文件夹名称"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) {
              onOk(name.trim());
            }
          }}
        />
      </div>
    </Modal>
  );
}

/** 重命名目录。 */
export function RenameFolderDialog({
  open,
  onOpenChange,
  initialName,
  onOk,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName: string;
  onOk: (name: string) => void;
  loading?: boolean;
}) {
  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (open) setName(initialName);
  }, [open, initialName]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="重命名文件夹"
      onOk={() => onOk(name.trim())}
      confirmLoading={loading}
      disabled={!name.trim()}
    >
      <Input
        autoFocus
        value={name}
        maxLength={255}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) {
            onOk(name.trim());
          }
        }}
      />
    </Modal>
  );
}

/**
 * 移动目录 / 文件到目标目录。
 *
 * excludeIds 用来把"被移动的目录自己及其子孙"从候选里去掉：
 * 选到它们就是在造环，后端也会拒，但让用户先看不到更省事。
 */
export function MoveToFolderDialog({
  open,
  onOpenChange,
  title = '移动到…',
  folders,
  excludeIds = [],
  onOk,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  folders: IDocumentFolder[];
  excludeIds?: string[];
  onOk: (folderId: string) => void;
  loading?: boolean;
}) {
  const [target, setTarget] = useState<string>(ROOT_FOLDER);

  useEffect(() => {
    if (open) setTarget(ROOT_FOLDER);
  }, [open]);

  const blocked = useMemo(() => {
    const set = new Set<string>();
    excludeIds.forEach((id) => {
      descendantFolderIds(folders, id).forEach((child) => set.add(child));
    });
    return set;
  }, [folders, excludeIds]);

  const options = useMemo(() => {
    const rows: Array<{ id: string; label: string; depth: number }> = [];
    const walk = (
      nodes: ReturnType<typeof buildFolderTree>,
      depth: number,
      prefix: string,
    ) => {
      nodes.forEach((node) => {
        if (blocked.has(node.id)) return;
        const label = prefix ? `${prefix} › ${node.name}` : node.name;
        rows.push({ id: node.id, label, depth });
        walk(node.children, depth + 1, label);
      });
    };
    walk(buildFolderTree(folders), 0, '');
    return rows;
  }, [folders, blocked]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      onOk={() => onOk(target)}
      confirmLoading={loading}
      okText="移动"
    >
      <div className="max-h-80 space-y-1 overflow-auto">
        <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-bg-card">
          <input
            type="radio"
            checked={target === ROOT_FOLDER}
            onChange={() => setTarget(ROOT_FOLDER)}
          />
          <span className="text-sm">根目录（移出文件夹）</span>
        </label>
        {options.map((option) => (
          <label
            key={option.id}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-bg-card"
          >
            <input
              type="radio"
              checked={target === option.id}
              onChange={() => setTarget(option.id)}
            />
            <span className="text-sm">{option.label}</span>
          </label>
        ))}
        {options.length === 0 && (
          <div className="px-2 py-6 text-center text-sm text-text-secondary">
            还没有可用的目标目录
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * 解析目录的确认弹窗。
 *
 * 三种情况必须给出不同文案，否则最容易被当成 bug：
 * 空目录（不能点）、有未解析文件（开始解析）、全部已解析（改成"全部重新解析"）。
 */
export function ParseFolderDialog({
  open,
  onOpenChange,
  folderPath,
  summary,
  loadingSummary,
  onOk,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderPath: string;
  summary?: IDocumentFolderParseSummary;
  loadingSummary?: boolean;
  onOk: (includeParsed: boolean) => void;
  loading?: boolean;
}) {
  const total = summary?.total ?? 0;
  const pending = summary?.pending ?? 0;
  const parsed = summary?.parsed ?? 0;
  const inProgress = summary?.in_progress ?? 0;
  const subFolders = summary?.sub_folders ?? 0;

  const nothingToDo = !loadingSummary && total === 0;
  const allParsed = !loadingSummary && total > 0 && pending === 0;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="解析文件夹"
      onOk={() => onOk(allParsed)}
      confirmLoading={loading}
      disabled={loadingSummary || nothingToDo}
      okText={allParsed ? '全部重新解析' : '开始解析'}
    >
      <div className="space-y-3 text-sm">
        <div>
          <div className="mb-1 text-text-secondary">文件夹</div>
          <div className="rounded bg-bg-card px-2 py-1.5">{folderPath}</div>
        </div>
        <div className="leading-7">
          {loadingSummary ? (
            '统计中…'
          ) : (
            <>
              文件总数：<b>{total}</b> 个
              {subFolders > 0 && `（含 ${subFolders} 个子文件夹）`}
              <br />
              待解析：<b>{pending}</b> 个
              <br />
              解析中：<b>{inProgress}</b> 个
              <br />
              已解析将跳过：<b>{parsed}</b> 个
            </>
          )}
        </div>
        {nothingToDo && (
          <div className="rounded bg-bg-card px-2 py-2 text-text-secondary">
            这个文件夹里还没有文件，解析不会产生任何任务。
          </div>
        )}
        {allParsed && (
          <div className="rounded bg-bg-card px-2 py-2 text-text-secondary">
            文件夹内文件都已解析。继续会重新解析并覆盖现有切片。
          </div>
        )}
      </div>
    </Modal>
  );
}

/** 删除目录：非空要二次确认，并把"会一起删掉多少文件"说清楚。 */
export function DeleteFolderDialog({
  open,
  onOpenChange,
  folderName,
  fileCount,
  subFolderCount,
  onOk,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderName: string;
  fileCount: number;
  subFolderCount: number;
  onOk: () => void;
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="删除文件夹"
      onOk={onOk}
      confirmLoading={loading}
      okText="删除"
      okButtonClassName="bg-state-error text-text-primary"
    >
      <div className="space-y-2 text-sm">
        <div>
          确认删除「<b>{folderName}</b>」？
        </div>
        {(fileCount > 0 || subFolderCount > 0) && (
          <div className="rounded bg-bg-card px-2 py-2 text-text-secondary">
            这个文件夹下还有 {subFolderCount} 个子文件夹、{fileCount} 个文件，
            会一并删除，切片与索引也会一起清理。
          </div>
        )}
      </div>
    </Modal>
  );
}
