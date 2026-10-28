import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogNode,
} from '@/components/confirm-delete-dialog';
import { Button } from '@/components/ui/button';
import { PenLine, Trash2 } from 'lucide-react';
import { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useDeleteMemory } from './hooks';
import { IMemory } from './interface';

/**
 * 记忆表格行内的操作按钮：重命名 / 删除。
 *
 * 与知识检索、知识问答的表格保持同一约定：卡片视图仍用折叠的
 * MemoryDropdown（卡片宽度有限，平铺两个图标会把标题挤掉），表格行横向
 * 空间足够，平铺可以少一次点击。
 */
export function MemoryRowActions({
  memory,
  showMemoryRenameModal,
}: {
  memory: IMemory;
  showMemoryRenameModal: (memory: IMemory) => void;
}) {
  const { t } = useTranslation();
  const { deleteMemory } = useDeleteMemory();

  const handleRename = (e: MouseEvent<HTMLButtonElement>) => {
    // 行本身可能绑定跳转，编辑动作不能顺带把记忆详情页打开。
    e.stopPropagation();
    showMemoryRenameModal(memory);
  };

  return (
    <div className="flex items-center justify-end gap-0.5">
      <Button
        variant="transparent"
        size="icon-sm"
        className="border-none text-text-primary hover:bg-bg-card"
        title={t('common.rename')}
        onClick={handleRename}
      >
        <PenLine />
      </Button>
      <ConfirmDeleteDialog
        onOk={() => deleteMemory({ memory_id: memory.id })}
        title={t('deleteModal.delMemory')}
        content={{
          node: (
            <ConfirmDeleteDialogNode
              avatar={{ avatar: memory.avatar, name: memory.name }}
              name={memory.name}
              warnText={t('memories.delMemoryWarn')}
            />
          ),
        }}
      >
        <Button
          variant="transparent"
          size="icon-sm"
          className="border-none text-state-error hover:bg-bg-card"
          title={t('common.delete')}
          onClick={(e: MouseEvent<HTMLButtonElement>) => e.stopPropagation()}
        >
          <Trash2 />
        </Button>
      </ConfirmDeleteDialog>
    </div>
  );
}
