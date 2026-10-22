import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogNode,
} from '@/components/confirm-delete-dialog';
import { Button } from '@/components/ui/button';
import { useDeleteAgent } from '@/hooks/use-agent-request';
import { IFlow } from '@/interfaces/database/agent';
import { PenLine, Tag, Trash2 } from 'lucide-react';
import { MouseEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AgentTagEditor } from './agent-tag-editor';
import { useRenameAgent } from './use-rename-agent';

/**
 * 表格行内的操作按钮：编辑（重命名）/ 标签 / 删除。
 *
 * 卡片视图仍用折叠的 AgentDropdown —— 卡片宽度有限，平铺三个图标会把标题
 * 挤掉；表格行横向空间足够，平铺可以少一次点击。
 */
export function AgentRowActions({
  agent,
  showAgentRenameModal,
}: Pick<ReturnType<typeof useRenameAgent>, 'showAgentRenameModal'> & {
  agent: IFlow;
}) {
  const { t } = useTranslation();
  const { deleteAgent } = useDeleteAgent();
  const [tagEditorOpen, setTagEditorOpen] = useState(false);

  return (
    <>
      <div className="flex items-center justify-end gap-0.5">
        <Button
          variant="transparent"
          size="icon-sm"
          className="border-none text-text-primary hover:bg-bg-card"
          title={t('common.rename')}
          onClick={(e: MouseEvent<HTMLButtonElement>) => {
            // 行本身可能绑定跳转，编辑动作不能顺带把画布也打开。
            e.stopPropagation();
            showAgentRenameModal(agent);
          }}
        >
          <PenLine />
        </Button>
        <Button
          variant="transparent"
          size="icon-sm"
          className="border-none text-text-primary hover:bg-bg-card"
          title={t('flow.editTags')}
          onClick={(e: MouseEvent<HTMLButtonElement>) => {
            e.stopPropagation();
            setTagEditorOpen(true);
          }}
        >
          <Tag />
        </Button>
        <ConfirmDeleteDialog
          onOk={() => deleteAgent(agent.id)}
          title={t('deleteModal.delAgent')}
          content={{
            node: (
              <ConfirmDeleteDialogNode
                avatar={{ avatar: agent.avatar, name: agent.title }}
                name={agent.title}
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
      <AgentTagEditor
        agent={agent}
        open={tagEditorOpen}
        onOpenChange={setTagEditorOpen}
      />
    </>
  );
}
