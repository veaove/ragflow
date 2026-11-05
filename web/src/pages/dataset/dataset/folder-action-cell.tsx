import { Button } from '@/components/ui/button';
import { IDocumentFolder } from '@/interfaces/database/document';
import { FolderInput, PenLine, Trash2 } from 'lucide-react';

/**
 * 文件夹行的「操作」列。与文件行一致：hover 才出现的图标按钮，
 * 解析是批量动作，放在「解析」列的文字按钮上，不混进这一列。
 */
export function FolderActionCell({
  record,
  onRename,
  onMove,
  onDelete,
}: {
  record: IDocumentFolder;
  onRename?: (folder: IDocumentFolder) => void;
  onMove?: (folder: IDocumentFolder) => void;
  onDelete?: (folder: IDocumentFolder) => void;
}) {
  return (
    <div
      className="
      flex gap-2 items-center opacity-0
      transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
    >
      {onRename && (
        <Button
          size="icon-xs"
          variant="ghost"
          title="重命名"
          onClick={() => onRename(record)}
        >
          <PenLine className="size-[1em]" />
        </Button>
      )}
      {onMove && (
        <Button
          size="icon-xs"
          variant="ghost"
          title="移动到"
          onClick={() => onMove(record)}
        >
          <FolderInput className="size-[1em]" />
        </Button>
      )}
      {onDelete && (
        <Button
          size="icon-xs"
          variant="ghost"
          title="删除"
          onClick={() => onDelete(record)}
        >
          <Trash2 className="size-[1em]" />
        </Button>
      )}
    </div>
  );
}
