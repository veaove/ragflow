import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogNode,
} from '@/components/confirm-delete-dialog';
import { Button } from '@/components/ui/button';
import { useDeleteChat } from '@/hooks/use-chat-request';
import { IDialog } from '@/interfaces/database/chat';
import { PenLine, Trash2 } from 'lucide-react';
import { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * 表格行内的操作按钮：重命名 / 删除。
 *
 * 与智能体表格（AgentRowActions）保持同一约定：卡片视图用折叠的 ChatDropdown，
 * 表格行横向空间足够，平铺两个图标即可，少一次点击。
 */
export function ChatRowActions({
  chat,
  showChatRenameModal,
}: {
  chat: IDialog;
  showChatRenameModal: (chat: IDialog) => void;
}) {
  const { t } = useTranslation();
  const { deleteChat } = useDeleteChat();

  const handleRename = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    showChatRenameModal(chat);
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
        onOk={() => deleteChat(chat.id)}
        title={t('deleteModal.delChat')}
        content={{
          node: (
            <ConfirmDeleteDialogNode
              avatar={{ avatar: chat.icon, name: chat.name }}
              name={chat.name}
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
