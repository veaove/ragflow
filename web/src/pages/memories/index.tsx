import { CardContainer } from '@/components/card-container';
import { EmptyCardType } from '@/components/empty/constant';
import { EmptyAppCard } from '@/components/empty/empty';
import ListFilterBar from '@/components/list-filter-bar';
import { Button } from '@/components/ui/button';
import { RAGFlowPagination } from '@/components/ui/ragflow-pagination';
import { ListDeletionKey } from '@/constants/list-deletion';
import { useTranslate } from '@/hooks/common-hooks';
import { useListViewPreference } from '@/hooks/use-list-view-preference';
import { useGoToPreviousPageOnEmpty } from '@/hooks/logic-hooks';
import { pick } from 'lodash';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ViewToggle } from '@/pages/studio/view-toggle';
import { AddOrEditModal } from './add-or-edit-modal';
import { defaultMemoryFields } from './constants';
import {
  useFetchMemoryFilters,
  useFetchMemoryList,
  useRenameMemory,
  useSelectFilters,
} from './hooks';
import { ICreateMemoryProps, IMemory } from './interface';
import { MemoryCard } from './memory-card';
import { MemoryTable } from './memory-table';

export default function MemoryList() {
  // const { data } = useFetchFlowList();
  const { t } = useTranslate('memories');
  const { mode: viewMode, setMode: setViewMode } = useListViewPreference();
  const [addOrEditType, setAddOrEditType] = useState<'add' | 'edit'>('add');
  // const [isEdit, setIsEdit] = useState(false);
  const {
    data: list,
    isLoading,
    pagination,
    searchString,
    setSearchString,
    handleInputChange,
    setPagination,
    refetch: refetchList,
    filterValue,
    setFilterValue,
    handleFilterSubmit,
  } = useFetchMemoryList();
  const { data: filterData } = useFetchMemoryFilters();

  const {
    openCreateModal,
    showMemoryRenameModal,
    hideMemoryModal,
    memoryRenameLoading,
    onMemoryRenameOk,
    initialMemory,
  } = useRenameMemory();

  const onMemoryConfirm = (data: ICreateMemoryProps) => {
    onMemoryRenameOk(data, () => {
      refetchList();
    });
  };
  const openCreateModalFun = useCallback(() => {
    // setIsEdit(false);
    setAddOrEditType('add');
    showMemoryRenameModal(defaultMemoryFields as unknown as IMemory);
  }, [showMemoryRenameModal]);
  // 卡片和表格共用同一个重命名入口：先切成 edit，再交给弹窗预填。
  const handleShowMemoryRenameModal = useCallback(
    (memory: IMemory) => {
      setAddOrEditType('edit');
      showMemoryRenameModal(memory);
    },
    [showMemoryRenameModal],
  );
  const handlePageChange = useCallback(
    (page: number, pageSize?: number) => {
      setPagination({ page, pageSize });
    },
    [setPagination],
  );
  useGoToPreviousPageOnEmpty(list?.data?.memory_list?.length, isLoading, {
    deletionKey: ListDeletionKey.MemoryList,
    searchString,
    setSearchString,
    filterValue,
    setFilterValue,
  });

  const [searchUrl, setMemoryUrl] = useSearchParams();
  const { filters } = useSelectFilters(filterData);
  const isCreate = searchUrl.get('isCreate') === 'true';
  useEffect(() => {
    if (isCreate) {
      openCreateModalFun();
      searchUrl.delete('isCreate');
      setMemoryUrl(searchUrl);
    }
  }, [isCreate, openCreateModalFun, searchUrl, setMemoryUrl]);

  return (
    <>
      {list?.data?.memory_list?.length || searchString ? (
        <article
          className="size-full min-w-0 flex flex-col"
          data-testid="memory-list"
        >
          <header className="mb-4 min-w-0 px-5 pt-8">
            <ListFilterBar
              icon="memory"
              title={t('memory')}
              onSearchChange={handleInputChange}
              searchString={searchString}
              filters={filters}
              onChange={handleFilterSubmit}
              value={filterValue}
            >
              <Button onClick={() => openCreateModalFun()}>
                <Plus className="size-[1em]" />
                {t('createMemory')}
              </Button>
            </ListFilterBar>
            {/* 卡片 / 表格切换与智能体、知识检索列表同源（同一份 localStorage
                偏好），放在标题行下方右侧，不占搜索框宽度。 */}
            <div className="mt-3 flex justify-end">
              <ViewToggle mode={viewMode} onChange={setViewMode} />
            </div>
          </header>

          {list?.data?.memory_list?.length ? (
            <>
              {viewMode === 'table' ? (
                <div className="flex-1 overflow-auto px-5">
                  <MemoryTable
                    rows={list.data.memory_list}
                    showMemoryRenameModal={handleShowMemoryRenameModal}
                  />
                </div>
              ) : (
                <CardContainer className="flex-1 overflow-auto px-5">
                  {list?.data.memory_list.map((x) => (
                    <MemoryCard
                      key={x.id}
                      data={x}
                      showMemoryRenameModal={handleShowMemoryRenameModal}
                    />
                  ))}
                </CardContainer>
              )}

              <footer className="mt-4 px-5 pb-5">
                <RAGFlowPagination
                  {...pick(pagination, 'current', 'pageSize')}
                  total={list?.data.total_count}
                  onChange={handlePageChange}
                />
              </footer>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center px-5">
              <EmptyAppCard
                showIcon
                size="large"
                isSearch
                type={EmptyCardType.Memory}
                onClick={() => openCreateModalFun()}
              />
            </div>
          )}
        </article>
      ) : (
        <article
          className="size-full min-w-0 flex items-center justify-center px-5"
          data-testid="memory-list"
        >
          <EmptyAppCard
            showIcon
            size="large"
            type={EmptyCardType.Memory}
            onClick={() => openCreateModalFun()}
          />
        </article>
      )}
      {/* {openCreateModal && (
        <RenameDialog
          hideModal={hideMemoryRenameModal}
          onOk={onMemoryRenameConfirm}
          initialName={initialMemoryName}
          loading={searchRenameLoading}
          title={<HomeIcon name="memory" width={'24'} />}
        ></RenameDialog>
      )} */}
      {openCreateModal && (
        <AddOrEditModal
          initialMemory={initialMemory}
          isCreate={addOrEditType === 'add'}
          open={openCreateModal}
          loading={memoryRenameLoading}
          onClose={hideMemoryModal}
          onSubmit={onMemoryConfirm}
        />
      )}
    </>
  );
}
