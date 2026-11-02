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
  useFetchDatasetCategories,
  useFetchNextKnowledgeListByPage,
} from '@/hooks/use-knowledge-request';
import { FilterValue } from '@/components/list-filter-bar/interface';
import { hasActiveFilter } from '@/components/list-filter-bar/utils';
import { MultiSelect } from '@/components/ui/multi-select';
import { DateRangeFilter } from '@/components/date-range-filter';
import {
  DatasetCategoryFilter,
  DatasetCreateTimeFilter,
  DatasetStatusFilter,
  DatasetUpdateTimeFilter,
  buildDateRangeFilterValue,
  parseDateRangeFilterValue,
} from '@/utils/dataset-filter';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, ChevronDown } from 'lucide-react';
import { DateRange } from 'react-day-picker';
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
import { useConsolePermissions } from '@/hooks/use-console-permissions';
import { useListViewPreference } from '@/hooks/use-list-view-preference';
import { useEditDataset } from './use-edit-dataset';
import { DatasetEditDialog } from './dataset-edit-dialog';

type StatusFilter = 'all' | 'enabled' | 'disabled';

const StatusFilterOptions: { label: string; value: StatusFilter }[] = [
  { label: '全部', value: 'all' },
  { label: '启用', value: 'enabled' },
  { label: '停用', value: 'disabled' },
];

export default function Datasets() {
  const { t } = useTranslation();

  // 分类 / 状态 / 时间范围先落在草稿上，点「查询」才提交：这些条件常要一次
  // 调好几项，边改边查会打出一串互相覆盖的请求。
  const [statusDraft, setStatusDraft] = useState<StatusFilter>('all');
  const [categoryDraft, setCategoryDraft] = useState<string[]>([]);
  const [createTimeDraft, setCreateTimeDraft] = useState<DateRange>();
  const [updateTimeDraft, setUpdateTimeDraft] = useState<DateRange>();

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
    filterValue,
    setFilterValue,
    handleFilterSubmit,
  } = useFetchNextKnowledgeListByPage();

  const { categories } = useFetchDatasetCategories();
  const categoryOptions = useMemo(
    () => categories.map((category) => ({ label: category, value: category })),
    [categories],
  );

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
  const { mode: viewMode, setMode: setViewMode } =
    useListViewPreference('dataset');
  const { can } = useConsolePermissions();

  const currentPageSize = pagination.pageSize || 10;

  // filterValue 是"已提交"的筛选。删除或翻页导致列表回退时它会被清空，
  // 草稿要跟着清，否则筛选条还显示着已经不再生效的条件。
  useEffect(() => {
    const applied = filterValue ?? {};
    setStatusDraft(
      ((applied[DatasetStatusFilter] as string[])?.[0] as StatusFilter) ??
        'all',
    );
    setCategoryDraft((applied[DatasetCategoryFilter] as string[]) ?? []);
    setCreateTimeDraft(
      parseDateRangeFilterValue(applied[DatasetCreateTimeFilter] as string[]),
    );
    setUpdateTimeDraft(
      parseDateRangeFilterValue(applied[DatasetUpdateTimeFilter] as string[]),
    );
  }, [filterValue]);

  const handleStatusChange = useCallback((value: string) => {
    setStatusDraft(value as StatusFilter);
  }, []);

  const handleCategoryChange = useCallback((value: string[]) => {
    setCategoryDraft(value);
  }, []);

  const handleCreateTimeChange = useCallback((range?: DateRange) => {
    setCreateTimeDraft(range);
  }, []);

  const handleUpdateTimeChange = useCallback((range?: DateRange) => {
    setUpdateTimeDraft(range);
  }, []);

  // 叉掉时间条件 = 取消这个筛选，立即重查；没提交的其他草稿不动。
  const handleCreateTimeClear = useCallback(() => {
    setCreateTimeDraft(undefined);
    const filter: FilterValue = { ...filterValue };
    delete filter[DatasetCreateTimeFilter];
    handleFilterSubmit(filter);
  }, [filterValue, handleFilterSubmit]);

  const handleUpdateTimeClear = useCallback(() => {
    setUpdateTimeDraft(undefined);
    const filter: FilterValue = { ...filterValue };
    delete filter[DatasetUpdateTimeFilter];
    handleFilterSubmit(filter);
  }, [filterValue, handleFilterSubmit]);

  const handleQuery = useCallback(() => {
    const filter: FilterValue = {};
    if (categoryDraft.length) {
      filter[DatasetCategoryFilter] = categoryDraft;
    }
    if (statusDraft !== 'all') {
      filter[DatasetStatusFilter] = [statusDraft];
    }
    const createTime = buildDateRangeFilterValue(
      createTimeDraft?.from,
      createTimeDraft?.to,
    );
    if (createTime) {
      filter[DatasetCreateTimeFilter] = createTime;
    }
    const updateTime = buildDateRangeFilterValue(
      updateTimeDraft?.from,
      updateTimeDraft?.to,
    );
    if (updateTime) {
      filter[DatasetUpdateTimeFilter] = updateTime;
    }
    // 所属人筛选由别处写入 filterValue，查询动作不该顺手把它清掉。
    if (filterValue.owner) {
      filter.owner = filterValue.owner;
    }
    handleFilterSubmit(filter);
  }, [
    categoryDraft,
    createTimeDraft,
    filterValue,
    handleFilterSubmit,
    statusDraft,
    updateTimeDraft,
  ]);

  const handleReset = useCallback(() => {
    setSearchString('');
    setStatusDraft('all');
    setCategoryDraft([]);
    setCreateTimeDraft(undefined);
    setUpdateTimeDraft(undefined);
    handleFilterSubmit({});
  }, [handleFilterSubmit, setSearchString]);

  useGoToPreviousPageOnEmpty(kbs?.length, loading, {
    deletionKey: ListDeletionKey.KnowledgeList,
    searchString,
    setSearchString,
    filterValue,
    setFilterValue,
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

  const showTable = kbs?.length || searchString || hasActiveFilter(filterValue);

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

                {can('dataset', 'create') && (
                  <Button variant="accent" onClick={showModal}>
                    <Plus className="size-[1em]" />
                    {t('knowledgeList.createKnowledgeBase')}
                  </Button>
                )}
              </div>
            </div>

            {/* 筛选行：名称即时搜索（防抖），其余条件点「查询」统一提交。
                全部条件都是服务端筛选，分页总数与筛选结果保持一致。 */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <SearchInput
                value={searchString}
                onChange={handleInputChange}
                placeholder="请输入知识库名称"
                className="w-60"
              />

              <Select value={statusDraft} onValueChange={handleStatusChange}>
                <SelectTrigger className="w-28">
                  <SelectValue placeholder="状态" />
                </SelectTrigger>
                <SelectContent>
                  {StatusFilterOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <MultiSelect
                className="w-40"
                options={categoryOptions}
                value={categoryDraft}
                onValueChange={handleCategoryChange}
                placeholder="分类"
                maxCount={2}
                showSelectAll={false}
                modalPopover
              />

              <DateRangeFilter
                label="创建时间"
                value={createTimeDraft}
                onChange={handleCreateTimeChange}
                onClear={handleCreateTimeClear}
              />
              <DateRangeFilter
                label="更新时间"
                value={updateTimeDraft}
                onChange={handleUpdateTimeChange}
                onClear={handleUpdateTimeClear}
              />

              <Button variant="accent" onClick={handleQuery}>
                查询
              </Button>
              <Button variant="outline" onClick={handleReset}>
                {t('common.reset')}
              </Button>
            </div>
          </header>

          {kbs?.length && viewMode === 'card' ? (
            <CardContainer className="flex-1 overflow-auto px-5">
              {kbs.map((kb) => (
                <DatasetCard
                  key={kb.id}
                  dataset={kb}
                  showDatasetEditModal={showDatasetEditModal}
                />
              ))}
            </CardContainer>
          ) : kbs?.length ? (
            <KnowledgeBaseTable
              data={kbs}
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
