import { CardContainer } from '@/components/card-container';
import { EmptyCardType } from '@/components/empty/constant';
import { EmptyAppCard } from '@/components/empty/empty';
import ListFilterBar from '@/components/list-filter-bar';
import { RenameDialog } from '@/components/rename-dialog';
import { Button } from '@/components/ui/button';
import { RAGFlowPagination } from '@/components/ui/ragflow-pagination';
import { Spin } from '@/components/ui/spin';
import { ListDeletionKey } from '@/constants/list-deletion';
import { useGoToPreviousPageOnEmpty } from '@/hooks/logic-hooks';
import { useFetchChatList } from '@/hooks/use-chat-request';
import { buildOwnersFilter } from '@/utils/list-filter-util';
import { pick } from 'lodash';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useNavigatePage } from '@/hooks/logic-hooks/navigate-hooks';
import { ChatCard } from './chat-card';
import { ChatTable } from './chat-table';
import { ViewToggle } from '@/pages/studio/view-toggle';
import { useListViewPreference } from '@/hooks/use-list-view-preference';
import { useCreateChatDialog } from './hooks/use-create-chat';
import { useRenameChat } from './hooks/use-rename-chat';

export default function ChatList() {
  const {
    data,
    setPagination,
    pagination,
    handleInputChange,
    searchString,
    setSearchString,
    filterValue,
    setFilterValue,
    handleFilterSubmit,
    loading,
  } = useFetchChatList();
  const { t } = useTranslation();
  const { t: tc } = useTranslation('common');
  const { mode: viewMode, setMode: setViewMode } = useListViewPreference();
  const { navigateToChat } = useNavigatePage();
  const owners = [buildOwnersFilter(data?.chats ?? [], undefined, tc('owner'))];
  const {
    initialChatName,
    chatRenameVisible,
    showChatRenameModal,
    hideChatRenameModal,
    onChatRenameOk,
    chatRenameLoading,
  } = useRenameChat();
  const {
    createChatVisible,
    showCreateChatModal,
    hideCreateChatModal,
    onCreateChatOk,
    createChatLoading,
  } = useCreateChatDialog();

  const handlePageChange = useCallback(
    (page: number, pageSize?: number) => {
      setPagination({ page, pageSize });
    },
    [setPagination],
  );
  useGoToPreviousPageOnEmpty(data?.chats?.length, loading, {
    deletionKey: ListDeletionKey.ChatList,
    searchString,
    setSearchString,
    filterValue,
    setFilterValue,
  });

  const handleShowCreateModal = useCallback(() => {
    showCreateChatModal();
  }, [showCreateChatModal]);

  const [searchParams, setSearchParams] = useSearchParams();
  const isCreate = searchParams.get('isCreate') === 'true';
  useEffect(() => {
    if (isCreate) {
      handleShowCreateModal();
      searchParams.delete('isCreate');
      setSearchParams(searchParams);
    }
  }, [isCreate, handleShowCreateModal, searchParams, setSearchParams]);

  const renameDialogProps = useMemo(() => {
    if (chatRenameVisible) {
      return {
        hideModal: hideChatRenameModal,
        onOk: onChatRenameOk,
        initialName: initialChatName,
        loading: chatRenameLoading,
        title: initialChatName,
      };
    }
    if (createChatVisible) {
      return {
        hideModal: hideCreateChatModal,
        onOk: onCreateChatOk,
        initialName: '',
        loading: createChatLoading,
        title: t('chat.createChat'),
      };
    }
    return null;
  }, [
    chatRenameVisible,
    createChatVisible,
    hideChatRenameModal,
    onChatRenameOk,
    initialChatName,
    chatRenameLoading,
    hideCreateChatModal,
    onCreateChatOk,
    createChatLoading,
    t,
  ]);

  // data 的类型允许 undefined（请求还没回来），统一收窄一次，
  // 避免每处 data.chats 都写可选链——漏一处就是一次运行时炸。
  const chats = data?.chats ?? [];

  return (
    <>
      {loading && !chats.length ? (
        <article
          className="size-full flex items-center justify-center"
          data-testid="chats-list"
        >
          <Spin size="large" />
        </article>
      ) : chats.length || searchString ? (
        <article
          className="size-full min-w-0 flex flex-col"
          data-testid="chats-list"
        >
          <header className="mb-4 min-w-0 px-5 pt-8">
            <ListFilterBar
              title={t('chat.chatApps')}
              icon="chats"
              onSearchChange={handleInputChange}
              searchString={searchString}
              filters={owners}
              value={filterValue}
              onChange={handleFilterSubmit}
            >
              <Button data-testid="create-chat" onClick={handleShowCreateModal}>
                <Plus className="size-[1em]" />
                {t('chat.createChat')}
              </Button>
            </ListFilterBar>
          </header>
          <div className="mb-3 flex justify-end px-5">
            <ViewToggle mode={viewMode} onChange={setViewMode} />
          </div>

          {chats.length ? (
            <>
              {viewMode === 'table' ? (
                <div className="flex-1 overflow-auto px-5">
                  <ChatTable
                    rows={chats}
                    onOpen={(id) => navigateToChat(id)()}
                    showChatRenameModal={showChatRenameModal}
                  />
                </div>
              ) : (
                <CardContainer className="flex-1 overflow-auto px-5">
                  {chats.map((x) => (
                    <ChatCard
                      key={x.id}
                      data={x}
                      showChatRenameModal={showChatRenameModal}
                    />
                  ))}
                </CardContainer>
              )}

              <footer className="mt-4 px-5 pb-5">
                <RAGFlowPagination
                  {...pick(pagination, 'current', 'pageSize')}
                  total={pagination.total}
                  onChange={handlePageChange}
                />
              </footer>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <EmptyAppCard
                showIcon
                size="large"
                className="w-[480px] p-14"
                isSearch
                type={EmptyCardType.Chat}
                testId="chats-empty-create"
              />
            </div>
          )}
        </article>
      ) : (
        <article
          className="size-full flex items-center justify-center"
          data-testid="chats-list"
        >
          <EmptyAppCard
            showIcon
            size="large"
            className="w-[480px] p-14"
            type={EmptyCardType.Chat}
            onClick={() => handleShowCreateModal()}
            testId="chats-empty-create"
          />
        </article>
      )}

      {renameDialogProps && (
        <RenameDialog {...renameDialogProps}></RenameDialog>
      )}
    </>
  );
}
