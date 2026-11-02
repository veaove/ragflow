import {
  BulkOperateBar,
  BulkOperateItemType,
} from '@/components/bulk-operate-bar';
import { FileUploadDialog } from '@/components/file-upload-dialog';
import ListFilterBar from '@/components/list-filter-bar';
import { RenameDialog } from '@/components/rename-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useConsolePermissions } from '@/hooks/use-console-permissions';
import { useGoToPreviousPageOnEmpty } from '@/hooks/logic-hooks';
import { useClearSelectionOnPageChange } from '@/hooks/logic-hooks/use-clear-selection-on-page-change';
import {
  useRowSelection,
  useSelectedIds,
} from '@/hooks/logic-hooks/use-row-selection';
import {
  useCreateDocumentFolder,
  useDeleteDocumentFolder,
  useFetchDocumentFolderParseSummary,
  useFetchDocumentFolders,
  useFetchDocumentList,
  useParseDocumentFolder,
  useRunDocument,
  useSetDocumentFolder,
  useUpdateDocumentFolder,
} from '@/hooks/use-document-request';
import { IDocumentFolder, IDocumentInfo } from '@/interfaces/database/document';
import {
  LucideFolderPlus,
  LucideLayoutGrid,
  LucideList,
  LucidePlus,
} from 'lucide-react';
import { useParams, useSearchParams } from 'react-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MetadataType } from '../components/metedata/constant';
import { useManageMetadata } from '../components/metedata/hooks/use-manage-modal';
import { ManageMetadataModal } from '../components/metedata/manage-modal';
import { useKnowledgeBaseContext } from '../contexts/knowledge-base-context';
import { DatasetGrid } from '../folder/dataset-grid';
import {
  CreateFolderDialog,
  DeleteFolderDialog,
  MoveToFolderDialog,
  ParseFolderDialog,
  RenameFolderDialog,
} from '../folder/folder-dialogs';
import {
  ROOT_FOLDER,
  childFoldersOf,
  folderChain,
  folderPathLabel,
} from '../folder/utils';
import { DatasetTable } from './dataset-table';
import { useBulkOperateDataset } from './use-bulk-operate-dataset';
import { useCreateEmptyDocument } from './use-create-empty-document';
import { useSelectDatasetFilters } from './use-select-filters';
import { useHandleUploadDocument } from './use-upload-document';

export default function Dataset() {
  const { t } = useTranslation();
  const {
    documentUploadVisible,
    hideDocumentUploadModal,
    showDocumentUploadModal,
    onDocumentUploadOk,
    documentUploadLoading,
  } = useHandleUploadDocument();
  const { knowledgeBase } = useKnowledgeBaseContext();
  // 上传 / 新建空文件都是 `POST /datasets/:id/documents`，后端按 dataset 的
  // create 动作拦截；没有该权限时按钮点了必吃 403，直接不渲染。
  const { can } = useConsolePermissions();
  const canCreateDocument = can('dataset', 'create');
  // 当前目录走 URL query（?folder_id=xxx），刷新后仍停在同一层。
  // 没有该参数 = 知识库根目录（未分类文件 + 顶层目录）。
  const [searchParams, setSearchParams] = useSearchParams();
  const currentFolderId = searchParams.get('folder_id') ?? ROOT_FOLDER;
  const navigateToFolder = (folderId: string) => {
    const next = new URLSearchParams(searchParams);
    if (folderId === ROOT_FOLDER) {
      next.delete('folder_id');
    } else {
      next.set('folder_id', folderId);
    }
    setSearchParams(next);
  };

  const {
    searchString,
    documents,
    pagination,
    handleInputChange,
    setPagination,
    filterValue,
    handleFilterSubmit,
    loading,
    checkValue,
  } = useFetchDocumentList(true, currentFolderId);

  useGoToPreviousPageOnEmpty(documents?.length, loading);

  const { filters, onOpenChange, filterGroup } = useSelectDatasetFilters();

  const {
    createLoading,
    onCreateOk,
    createVisible,
    hideCreateModal,
    showCreateModal,
  } = useCreateEmptyDocument();

  const {
    manageMetadataVisible,
    showManageMetadataModal,
    hideManageMetadataModal,
    tableData,
    config: metadataConfig,
  } = useManageMetadata();

  useEffect(() => {
    checkValue(filters);
  }, [filters]);

  const {
    rowSelection,
    rowSelectionIsEmpty,
    setRowSelection,
    selectedCount,
    clearRowSelection,
  } = useRowSelection();

  const { id: datasetId } = useParams();
  const { folders: allFolders } = useFetchDocumentFolders();
  const childFolders = useMemo(
    () => childFoldersOf(allFolders, currentFolderId),
    [allFolders, currentFolderId],
  );
  const breadcrumb = folderChain(allFolders, currentFolderId);
  const currentPath = folderPathLabel(allFolders, currentFolderId);

  const [view, setView] = useState<'list' | 'grid'>('list');

  const { createDocumentFolder } = useCreateDocumentFolder();
  const { updateDocumentFolder } = useUpdateDocumentFolder();
  const { deleteDocumentFolder } = useDeleteDocumentFolder();
  const { setDocumentFolder } = useSetDocumentFolder();
  const { parseDocumentFolder } = useParseDocumentFolder();
  const { runDocumentByIds } = useRunDocument();

  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<IDocumentFolder | null>(null);
  const [moveTarget, setMoveTarget] = useState<{
    folderId?: string;
    docIds?: string[];
  } | null>(null);
  const [parseTarget, setParseTarget] = useState<IDocumentFolder | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<IDocumentFolder | null>(null);

  const { summary: parseSummary, loading: parseSummaryLoading } =
    useFetchDocumentFolderParseSummary(
      parseTarget?.id ?? null,
      Boolean(parseTarget),
    );

  const handleCreateFolder = async (name: string) => {
    if (!datasetId) return;
    const result = await createDocumentFolder({
      kb_id: datasetId as string,
      parent_id: currentFolderId,
      name,
    });
    if (result?.code === 0) setCreateOpen(false);
  };

  const handleRenameFolder = async (name: string) => {
    if (!datasetId || !renameTarget) return;
    const result = await updateDocumentFolder({
      kb_id: datasetId as string,
      folder_id: renameTarget.id,
      name,
    });
    if (result?.code === 0) setRenameTarget(null);
  };

  const handleMoveTo = async (targetId: string) => {
    if (!datasetId || !moveTarget) return;
    if (moveTarget.docIds) {
      const result = await setDocumentFolder({
        kb_id: datasetId as string,
        doc_ids: moveTarget.docIds,
        folder_id: targetId,
        folderName:
          allFolders.find((folder) => folder.id === targetId)?.name ?? '根目录',
      });
      if (result?.code === 0) {
        setMoveTarget(null);
        setRowSelection({});
      }
      return;
    }
    if (moveTarget.folderId) {
      const result = await updateDocumentFolder({
        kb_id: datasetId as string,
        folder_id: moveTarget.folderId,
        parent_id: targetId,
      });
      if (result?.code === 0) setMoveTarget(null);
    }
  };

  const handleParseFolder = async (includeParsed: boolean) => {
    if (!datasetId || !parseTarget) return;
    const result = await parseDocumentFolder({
      kb_id: datasetId as string,
      folder_id: parseTarget.id,
      include_parsed: includeParsed,
    });
    if (result?.code === 0) setParseTarget(null);
  };

  const handleDeleteFolder = async () => {
    if (!datasetId || !deleteTarget) return;
    const result = await deleteDocumentFolder({
      kb_id: datasetId as string,
      folder_id: deleteTarget.id,
      recursive: true,
    });
    if (result?.code === 0) {
      const deletedId = deleteTarget.id;
      setDeleteTarget(null);
      // 删掉的是当前所在目录时，退回它的父级，否则会停在一个已不存在的目录上。
      if (deletedId === currentFolderId) {
        const parent =
          allFolders.find((folder) => folder.id === deletedId)?.parent_id ??
          ROOT_FOLDER;
        navigateToFolder(parent);
      }
    }
  };

  const handleParseDocument = async (doc: IDocumentInfo) => {
    await runDocumentByIds({ documentIds: [doc.id], run: 1 });
  };

  useClearSelectionOnPageChange(pagination, clearRowSelection);

  const { list } = useBulkOperateDataset({
    documents,
    rowSelection,
    setRowSelection,
    onMoveToFolder: (docIds) => setMoveTarget({ docIds }),
  });

  const { selectedIds: selectedRowKeys } = useSelectedIds(
    rowSelection,
    documents,
  );

  const handleAddMetadataWithDocuments = () => {
    showManageMetadataModal({
      type: MetadataType.Manage,
      isCanAdd: true,
      isEditField: false,
      isDeleteSingleValue: true,
      isAddValue: true,
      secondTitle: (
        <>
          {t('knowledgeDetails.metadata.selectFiles', {
            count: selectedCount,
          })}
        </>
      ),
      title: (
        <div className="flex flex-col gap-2">
          <div className="text-base font-normal">
            {t('knowledgeDetails.metadata.manageMetadata')}
          </div>
        </div>
      ),
      documentIds: selectedRowKeys,
    });
  };

  const updatedList = list.map((item) => {
    if (item.id === 'batch-metadata') {
      return {
        ...item,
        onClick: handleAddMetadataWithDocuments,
      };
    }
    return item;
  });

  return (
    <Card
      as="article"
      className="mb-5 mr-5 min-w-[880px] bg-transparent shadow-none"
    >
      <CardHeader as="header" className="p-5 space-y-0">
        <ListFilterBar
          onSearchChange={handleInputChange}
          searchString={searchString}
          value={filterValue}
          filterGroup={filterGroup}
          onChange={handleFilterSubmit}
          onOpenChange={onOpenChange}
          filters={filters}
          className="items-end"
          leftPanel={
            <div>
              <h1 className="leading-normal font-medium">
                {t('knowledgeDetails.subbarFiles')}
              </h1>
              {/* 面包屑：根目录可点回，任意上级都可点，点完列表切到那一层 */}
              <div className="mt-2 flex flex-wrap items-center gap-1 text-sm">
                <button
                  type="button"
                  className={
                    currentFolderId === ROOT_FOLDER
                      ? 'px-1 font-medium text-text-primary'
                      : 'px-1 text-text-secondary hover:text-text-primary hover:underline'
                  }
                  onClick={() => navigateToFolder(ROOT_FOLDER)}
                >
                  全部文件
                </button>
                {breadcrumb.map((folder) => (
                  <span key={folder.id} className="flex items-center gap-1">
                    <span className="text-xs text-text-secondary">›</span>
                    <button
                      type="button"
                      className={
                        folder.id === currentFolderId
                          ? 'px-1 font-medium text-text-primary'
                          : 'px-1 text-text-secondary hover:text-text-primary hover:underline'
                      }
                      onClick={() => navigateToFolder(folder.id)}
                    >
                      {folder.name}
                    </button>
                  </span>
                ))}
              </div>
              <p className="text-text-secondary text-sm font-normal">
                {t('knowledgeDetails.datasetDescription')}
              </p>
            </div>
          }
        >
          <div className="flex items-center gap-2">
            {/* 列表 / 平铺：平铺是自适应网格，文件夹与文件靠图标 + 元信息区分 */}
            <div className="flex overflow-hidden rounded-md border border-border-default">
              <button
                type="button"
                title="列表"
                className={`flex items-center gap-1 px-2 py-1.5 text-xs ${
                  view === 'list'
                    ? 'bg-bg-card font-medium text-text-accent'
                    : 'bg-bg-base text-text-secondary'
                }`}
                onClick={() => setView('list')}
              >
                <LucideList className="size-3.5" />
                列表
              </button>
              <button
                type="button"
                title="平铺"
                className={`flex items-center gap-1 border-l border-border-default px-2 py-1.5 text-xs ${
                  view === 'grid'
                    ? 'bg-bg-card font-medium text-text-accent'
                    : 'bg-bg-base text-text-secondary'
                }`}
                onClick={() => setView('grid')}
              >
                <LucideLayoutGrid className="size-3.5" />
                平铺
              </button>
            </div>
            {canCreateDocument && (
              <Button variant="outline" onClick={() => setCreateOpen(true)}>
                <LucideFolderPlus />
                新建文件夹
              </Button>
            )}
            {canCreateDocument && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="default">
                    <LucidePlus />
                    {t('knowledgeDetails.addFile')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-auto min-w-40" align="end">
                  <DropdownMenuItem onClick={showDocumentUploadModal}>
                    {t('fileManager.uploadFile')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={showCreateModal}>
                    {t('knowledgeDetails.emptyFiles')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </ListFilterBar>

        {rowSelectionIsEmpty || (
          <BulkOperateBar
            className="!mt-2.5 !-mb-2.5"
            list={updatedList as BulkOperateItemType[]}
            count={selectedCount}
          />
        )}
      </CardHeader>

      <CardContent className="px-5 py-0">
        {view === 'list' ? (
          <DatasetTable
            documents={documents}
            pagination={pagination}
            setPagination={setPagination}
            rowSelection={rowSelection}
            setRowSelection={setRowSelection}
            showManageMetadataModal={showManageMetadataModal}
            loading={loading}
            bulkOperateBarVisible={!rowSelectionIsEmpty}
            folders={childFolders}
            onEnterFolder={navigateToFolder}
            onParseFolder={setParseTarget}
            onRenameFolder={setRenameTarget}
            onMoveFolder={(folder) => setMoveTarget({ folderId: folder.id })}
            onDeleteFolder={setDeleteTarget}
          />
        ) : (
          <DatasetGrid
            folders={childFolders}
            documents={documents}
            selectedIds={new Set(Object.keys(rowSelection ?? {}))}
            onEnterFolder={navigateToFolder}
            onToggleSelect={(id, selected) =>
              setRowSelection((prev) => {
                const next = { ...(prev ?? {}) };
                if (selected) next[id] = true;
                else delete next[id];
                return next;
              })
            }
            onParseFolder={setParseTarget}
            onMoveFolder={(folder) => setMoveTarget({ folderId: folder.id })}
            onParseDocument={handleParseDocument}
            onMoveDocument={(doc) => setMoveTarget({ docIds: [doc.id] })}
          />
        )}

        {documentUploadVisible && (
          <FileUploadDialog
            hideModal={hideDocumentUploadModal}
            onOk={onDocumentUploadOk}
            loading={documentUploadLoading}
            showParseOnCreation
            isTableParser={knowledgeBase?.chunk_method === 'table'}
          ></FileUploadDialog>
        )}
        {createVisible && (
          <RenameDialog
            hideModal={hideCreateModal}
            onOk={onCreateOk}
            loading={createLoading}
            title={t('knowledgeDetails.fileName')}
          ></RenameDialog>
        )}
        {manageMetadataVisible && (
          <ManageMetadataModal
            title={
              metadataConfig.title || (
                <div className="flex flex-col gap-2">
                  <div className="text-base font-normal">
                    {t('knowledgeDetails.metadata.manageMetadata')}
                  </div>
                  {/* <div className="text-sm text-text-secondary">
                    {t('knowledgeDetails.metadata.manageMetadataForDataset')}
                  </div> */}
                </div>
              )
            }
            visible={manageMetadataVisible}
            hideModal={() => {
              setRowSelection({});
              hideManageMetadataModal();
            }}
            // selectedRowKeys={selectedRowKeys}
            tableData={tableData}
            isCanAdd={metadataConfig.isCanAdd}
            isAddValue={metadataConfig.isAddValue}
            isVerticalShowValue={metadataConfig.isVerticalShowValue}
            isEditField={metadataConfig.isEditField}
            isDeleteSingleValue={metadataConfig.isDeleteSingleValue}
            secondTitle={metadataConfig.secondTitle}
            type={metadataConfig.type}
            documentIds={metadataConfig.documentIds}
            otherData={metadataConfig.record}
          />
        )}
        <CreateFolderDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          parentPath={currentPath || '全部文件'}
          onOk={handleCreateFolder}
        />
        {renameTarget && (
          <RenameFolderDialog
            open
            onOpenChange={(open) => {
              if (!open) setRenameTarget(null);
            }}
            initialName={renameTarget.name}
            onOk={handleRenameFolder}
          />
        )}
        {moveTarget && (
          <MoveToFolderDialog
            open
            onOpenChange={(open) => {
              if (!open) setMoveTarget(null);
            }}
            title={moveTarget.docIds ? '移动文件到…' : '移动文件夹到…'}
            folders={allFolders}
            excludeIds={moveTarget.folderId ? [moveTarget.folderId] : []}
            onOk={handleMoveTo}
          />
        )}
        {parseTarget && (
          <ParseFolderDialog
            open
            onOpenChange={(open) => {
              if (!open) setParseTarget(null);
            }}
            folderPath={folderPathLabel(allFolders, parseTarget.id)}
            summary={parseSummary}
            loadingSummary={parseSummaryLoading}
            onOk={handleParseFolder}
          />
        )}
        {deleteTarget && (
          <DeleteFolderDialog
            open
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(null);
            }}
            folderName={deleteTarget.name}
            fileCount={deleteTarget.file_count}
            subFolderCount={deleteTarget.folder_count}
            onOk={handleDeleteFolder}
          />
        )}
      </CardContent>
    </Card>
  );
}
