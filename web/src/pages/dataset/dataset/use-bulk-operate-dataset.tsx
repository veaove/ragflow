import { Modal } from '@/components/ui/modal/modal';
import {
  UseRowSelectionType,
  useSelectedIds,
} from '@/hooks/logic-hooks/use-row-selection';
import { useConsolePermissions } from '@/hooks/use-console-permissions';
import {
  useRemoveDocument,
  useRunDocument,
  useSetDocumentStatus,
  useSetDocumentFolder,
} from '@/hooks/use-document-request';
import { IDocumentInfo } from '@/interfaces/database/document';
import {
  LucideCircleX,
  LucideCylinder,
  LucideFolderInput,
  LucidePlayCircle,
  LucideToggleLeft,
  LucideToggleRight,
  LucideTrash2,
} from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { DocumentType } from './constant';
import { buildParserGapModalContent } from './parser-gap-content';
import { useParserGapValidation } from './use-parser-gap-validation';
import { isDocumentProcessing } from './utils';

export function useBulkOperateDataset({
  rowSelection,
  setRowSelection,
  documents,
  onMoveToFolder,
}: Pick<UseRowSelectionType, 'rowSelection' | 'setRowSelection'> & {
  documents: IDocumentInfo[];
  /** 打开"移动到目录"弹窗；不传时退回按名称输入的旧交互。 */
  onMoveToFolder?: (docIds: string[]) => void;
}) {
  const { t } = useTranslation();
  const { selectedIds: selectedRowKeys } = useSelectedIds(
    rowSelection,
    documents,
  );
  const { id } = useParams();

  const { runDocumentByIds } = useRunDocument();
  const { setDocumentStatus } = useSetDocumentStatus();
  const { removeDocument } = useRemoveDocument();
  const { setDocumentFolder } = useSetDocumentFolder();
  const { findDocumentParseGaps } = useParserGapValidation();
  // 批量操作全部是写动作：解析/停止/启停/移动属编辑，删除单独判定。
  const { can } = useConsolePermissions();
  const canEdit = can('dataset', 'edit');
  const canDelete = can('dataset', 'delete');

  const runDocument = useCallback(
    async (run: number) => {
      const nonVirtualKeys = selectedRowKeys.filter(
        (x) =>
          !documents.some((y) => x === y.id && y.type === DocumentType.Virtual),
      );

      if (nonVirtualKeys.length === 0) {
        toast.error(t('Please select a non-empty file list'));
        return;
      }

      // Starting a parse requires each file type to be supported by the
      // Parser operator its document actually runs with; cancelling is
      // always allowed.
      if (run === 1) {
        const selectedDocuments = documents.filter((x) =>
          nonVirtualKeys.includes(x.id),
        );
        const gaps = findDocumentParseGaps(selectedDocuments);
        if (gaps.length > 0) {
          const failingNames = new Set(gaps.map((gap) => gap.name));
          const validIds = selectedDocuments
            .filter((x) => !failingNames.has(x.name))
            .map((x) => x.id);

          if (validIds.length === 0) {
            Modal.error({
              title: t('knowledgeDetails.parseBlockedTitle'),
              content: buildParserGapModalContent(t, gaps, {
                missingModel: 'knowledgeDetails.addModelToParseHint',
                unsupportedType: 'knowledgeDetails.reselectParserToParseHint',
              }),
              showCancel: false,
              okText: t('common.cancel'),
              closable: false,
            });
            return;
          }

          Modal.warning({
            title: t('knowledgeDetails.parseBlockedPartialTitle'),
            content: (
              <div className="space-y-2">
                {buildParserGapModalContent(t, gaps, {
                  missingModel: 'knowledgeDetails.addModelToParseHint',
                  unsupportedType: 'knowledgeDetails.reselectParserToParseHint',
                })}
                <p>
                  {t('knowledgeDetails.parseValidFilesNote', {
                    count: validIds.length,
                  })}
                </p>
              </div>
            ),
            okText: t('knowledgeDetails.parseValidFiles'),
            cancelText: t('common.cancel'),
            closable: false,
            onOk: async () => {
              await runDocumentByIds({ documentIds: validIds, run });
            },
          });
          return;
        }
      }

      await runDocumentByIds({
        documentIds: nonVirtualKeys,
        run,
      });
    },
    [documents, runDocumentByIds, selectedRowKeys, t, findDocumentParseGaps],
  );

  // Wired straight to the run button's onClick: keep it parameterless so the
  // click event is never mistaken for run options (it is not serializable).
  const handleRunClick = useCallback(() => {
    runDocument(1);
  }, [runDocument]);

  const handleCancelClick = useCallback(() => {
    runDocument(2);
  }, [runDocument]);

  const onChangeStatus = useCallback(
    (enabled: boolean) => {
      setDocumentStatus({
        status: enabled,
        documentId: selectedRowKeys,
        datasetId: id!,
      });
    },
    [selectedRowKeys, setDocumentStatus, id],
  );

  const handleEnableClick = useCallback(() => {
    onChangeStatus(true);
  }, [onChangeStatus]);

  const handleDisableClick = useCallback(() => {
    onChangeStatus(false);
  }, [onChangeStatus]);

  const handleDelete = useCallback(() => {
    const deletedKeys = selectedRowKeys.filter(
      (x) => !documents.filter(isDocumentProcessing).some((y) => y.id === x),
    );
    if (deletedKeys.length === 0) {
      toast.error(
        t('knowledgeConfiguration.theDocumentBeingParsedCannotBeDeleted'),
      );
      return;
    }

    return removeDocument(deletedKeys);
  }, [selectedRowKeys, removeDocument, documents, t]);

  const list = [
    {
      id: 'run',
      label: t('knowledgeDetails.run'),
      icon: <LucidePlayCircle />,
      onClick: handleRunClick,
    },
    {
      id: 'cancel',
      label: t('knowledgeDetails.cancel'),
      icon: <LucideCircleX />,
      onClick: handleCancelClick,
    },
    {
      id: 'enabled',
      label: t('knowledgeDetails.enabled'),
      icon: <LucideToggleRight />,
      onClick: handleEnableClick,
    },
    {
      id: 'disabled',
      label: t('knowledgeDetails.disabled'),
      icon: <LucideToggleLeft />,
      onClick: handleDisableClick,
    },

    {
      id: 'batch-folder',
      label: '移动到目录',
      icon: <LucideFolderInput />,
      onClick: async () => {
        if (onMoveToFolder) {
          onMoveToFolder(selectedRowKeys);
          return;
        }
        const code = await setDocumentFolder({
          kb_id: id as string,
          doc_ids: selectedRowKeys,
          folder_id: '',
        });
        if (code === 0) {
          setRowSelection({});
        }
      },
    },
    {
      id: 'batch-metadata',
      label: t('knowledgeDetails.metadata.metadata'),
      icon: <LucideCylinder />,
    },
    {
      id: 'delete',
      label: t('common.delete'),
      icon: <LucideTrash2 />,
      onClick: async () => {
        const code = await handleDelete();
        if (code === 0) {
          setRowSelection({});
        }
      },
    },
  ].filter((item) => (item.id === 'delete' ? canDelete : canEdit));

  return { list };
}
