import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogNode,
} from '@/components/confirm-delete-dialog';
import { Button } from '@/components/ui/button';
import { PenLine, Trash2 } from 'lucide-react';
import { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ISearchAppProps, useDeleteSearch } from './hooks';

/**
 * 表格行内的操作按钮：重命名 / 删除。
 *
 * 与智能体表格（AgentRowActions）保持同一约定：卡片视图用折叠的
 * SearchDropdown（卡片宽度有限），表格行横向空间足够，平铺两个图标即可，
 * 少一次点击。此前表格里复用了卡片的 MoreButton，而 MoreButton 默认
 * opacity-0 等 hover 才淡入，行上又没有 group 祖先，导致整个「操作」列空白。
 */
export function SearchRowActions({
  search,
  showSearchRenameModal,
}: {
  search: ISearchAppProps;
  showSearchRenameModal: (search: ISearchAppProps) => void;
}) {
  const { t } = useTranslation();
  const { deleteSearch } = useDeleteSearch();

  const handleRename = (e: MouseEvent<HTMLButtonElement>) => {
    // 行本身可能绑定跳转，编辑动作不能顺带把应用也打开。
    e.stopPropagation();
    showSearchRenameModal(search);
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
        onOk={() => deleteSearch({ search_id: search.id })}
        title={t('deleteModal.delSearch')}
        content={{
          node: (
            <ConfirmDeleteDialogNode
              avatar={{ avatar: search.avatar, name: search.name }}
              name={search.name}
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
