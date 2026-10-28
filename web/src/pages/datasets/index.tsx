import { EmptyCardType } from '@/components/empty/constant';
import { EmptyAppCard } from '@/components/empty/empty';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchInput } from '@/components/ui/input';
import { Spin } from '@/components/ui/spin';
import { ListDeletionKey } from '@/constants/list-deletion';
import { useGoToPreviousPageOnEmpty } from '@/hooks/logic-hooks';
import {
  KnowledgeApiAction,
  useFetchNextKnowledgeListByPage,
} from '@/hooks/use-knowledge-request';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { IDataset, IDatasetReference } from '@/interfaces/database/dataset';
import { DatasetCreatingDialog } from './dataset-creating-dialog';
import { DatasetDisableBlockedDialog } from './dataset-disable-blocked-dialog';
import { useSaveKnowledge } from './hooks';
import { KnowledgeBaseTable } from './knowledge-base-table';
import { DatasetCard } from './dataset-card';
import { CardContainer } from '@/components/card-container';
import { ViewToggle } from '@/pages/studio/view-toggle';
import { useListViewPreference } from '@/hooks/use-list-view-preference';
import { useEditDataset } from './use-edit-dataset';
import { DatasetEditDialog } from './dataset-edit-dialog';

type StatusFilter = 'all' | 'enabled' | 'disabled';

export default function Datasets() {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const {
    visible,
    hideModal,
    showModal,
    onCreateOk,
    loading: creatingLoading,
  } = useSaveKnowledge();

  const {
    kbs,
    total_datasets,
    pagination,
    setPagination,
    handleInputChange,
    searchString,
    setSearchString,
    loading,
  } = useFetchNextKnowledgeListByPage();

  const {
    datasetEditLoading,
    initialDatasetName,
    initialDatasetDescription,
    initialDatasetCategory,
    onDatasetEditOk,
    datasetEditVisible,
    hideDatasetEditModal,
    showDatasetEditModal,
  } = useEditDataset();
  const { mode: viewMode, setMode: setViewMode } = useListViewPreference();

  const filteredKbs = useMemo(() => {
    if (!kbs) return [];
    if (statusFilter === 'all') return kbs;
    const isEnabled = (dataset: IDataset) => dataset.enabled !== false;
    if (statusFilter === 'enabled') return kbs.filter(isEnabled);
    return kbs.filter((dataset) => !isEnabled(dataset));
  }, [kbs, statusFilter]);

  const currentPageSize = pagination.pageSize || 10;

  const handleSearch = useCallback(() => {
    setPagination({ page: 1, pageSize: currentPageSize });
  }, [currentPageSize, setPagination]);

  const handleReset = useCallback(() => {
    setSearchString('');
    setStatusFilter('all');
    setPagination({ page: 1, pageSize: currentPageSize });
  }, [currentPageSize, setPagination, setSearchString]);

  useGoToPreviousPageOnEmpty(filteredKbs?.length, loading, {
    deletionKey: ListDeletionKey.KnowledgeList,
    searchString,
    setSearchString,
    filterValue: { status: [statusFilter] },
    setFilterValue: (value) => {
      const v = value as { status?: string[] };
      setStatusFilter((v?.status?.[0] as StatusFilter) ?? 'all');
    },
  });

  const [searchUrl, setSearchUrl] = useSearchParams();
  const isCreate = searchUrl.get('isCreate') === 'true';
  const queryClient = useQueryClient();

  // A dataset that apps still bind cannot be disabled; the dialog names them.
  const [disableBlocked, setDisableBlocked] = useState<{
    dataset: IDataset;
    references: IDatasetReference[];
  } | null>(null);
  useEffect(() => {
    if (isCreate) {
      queryClient.invalidateQueries({ queryKey: ['tenantInfo'] });
      showModal();
      searchUrl.delete('isCreate');
      setSearchUrl(searchUrl);
    }
  }, [isCreate, showModal, searchUrl, setSearchUrl, queryClient]);

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: [KnowledgeApiAction.FetchKnowledgeListByPage],
    });
  }, [queryClient]);

  const handlePageChange = useCallback(
    (params: { page: number; pageSize: number }) => {
      setPagination(params);
    },
    [setPagination],
  );

  const showTable = filteredKbs?.length || searchString || statusFilter !== 'all';

  return (
    <>
      {loading && !kbs?.length ? (
        <article
          className="size-full flex items-center justify-center"
          data-testid="datasets-list"
        >
          <Spin size="large" />
        </article>
      ) : showTable ? (
        <article
          className="size-full min-w-0 flex flex-col"
          data-testid="datasets-list"
        >
          <header className="mb-4 min-w-0 px-5 pt-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <h1 className="flex shrink-0 items-center gap-2.5 text-2xl font-medium text-text-primary">
                {t('header.dataset')}
              </h1>

              <div className="flex w-full flex-wrap items-center gap-3 md:w-auto md:flex-nowrap">
                <SearchInput
                  value={searchString}
                  onChange={handleInputChange}
                  placeholder="请输入知识库名称"
                  className="w-60"
                />

                <Select
                  value={statusFilter}
                  onValueChange={(value) => {
                    setStatusFilter(value as StatusFilter);
                    setPagination({ page: 1, pageSize: currentPageSize });
                  }}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue placeholder="状态" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部</SelectItem>
                    <SelectItem value="enabled">
                      {t('knowledgeDetails.enabled')}
                    </SelectItem>
                    <SelectItem value="disabled">
                      {t('knowledgeDetails.disabled')}
                    </SelectItem>
                  </SelectContent>
                </Select>

                <Button variant="accent" onClick={handleSearch}>
                  查询
                </Button>
                <Button variant="outline" onClick={handleReset}>
                  {t('common.reset')}
                </Button>

                <div className="ml-auto flex items-center gap-3">
                  <ViewToggle mode={viewMode} onChange={setViewMode} />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="gap-1">
                        同步
                        <ChevronDown className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={handleRefresh}>
                        <RefreshCw className="mr-2 size-4" />
                        刷新列表
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Button variant="accent" onClick={showModal}>
                    <Plus className="size-[1em]" />
                    {t('knowledgeList.createKnowledgeBase')}
                  </Button>
                </div>
              </div>
            </div>
          </header>

          {filteredKbs?.length && viewMode === 'card' ? (
            <CardContainer className="flex-1 overflow-auto px-5">
              {filteredKbs.map((kb) => (
                <DatasetCard
                  key={kb.id}
                  dataset={kb}
                  showDatasetEditModal={showDatasetEditModal}
                />
              ))}
            </CardContainer>
          ) : filteredKbs?.length ? (
            <KnowledgeBaseTable
              data={filteredKbs}
              pagination={{
                current: pagination.current,
                pageSize: currentPageSize,
                total: total_datasets ?? 0,
              }}
              setPagination={handlePageChange}
              showDatasetEditModal={showDatasetEditModal}
              onDisableBlocked={(dataset, references) =>
                setDisableBlocked({ dataset, references })
              }
            />
          ) : (
            <div className="flex flex-1 items-center justify-center px-5">
              <EmptyAppCard
                showIcon
                size="large"
                className="w-[480px] p-14"
                isSearch
                type={EmptyCardType.Dataset}
                onClick={() => showModal()}
              />
            </div>
          )}
        </article>
      ) : (
        <article
          className="size-full flex items-center justify-center"
          data-testid="datasets-list"
        >
          <EmptyAppCard
            showIcon
            size="large"
            className="w-[480px] p-14"
            type={EmptyCardType.Dataset}
            onClick={() => showModal()}
          />
        </article>
      )}
      {visible && (
        <DatasetCreatingDialog
          hideModal={hideModal}
          onOk={onCreateOk}
          loading={creatingLoading}
        ></DatasetCreatingDialog>
      )}
      {datasetEditVisible && (
        <DatasetEditDialog
          hideModal={hideDatasetEditModal}
          onOk={onDatasetEditOk}
          initialName={initialDatasetName}
          initialDescription={initialDatasetDescription}
          initialCategory={initialDatasetCategory}
          loading={datasetEditLoading}
        />
      )}
      {disableBlocked && (
        <DatasetDisableBlockedDialog
          dataset={disableBlocked.dataset}
          references={disableBlocked.references}
          onClose={() => setDisableBlocked(null)}
        />
      )}
    </>
  );
}
