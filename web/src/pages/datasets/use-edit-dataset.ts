import { useSetModalState } from '@/hooks/common-hooks';
import { useUpdateKnowledge } from '@/hooks/use-knowledge-request';
import { IDataset } from '@/interfaces/database/dataset';
import { useCallback, useState } from 'react';
import { DatasetEditValues } from './dataset-edit-dialog';

/**
 * 知识库编辑弹窗的状态与提交。
 *
 * 原来只改名称（useRenameDataset）；现在一次改名称 / 描述 / 分类，
 * 三个字段一起提交。后端的更新接口本身支持部分更新，所以空值也会被写进去
 * ——这正好符合「清空描述」「清空分类」的预期语义。
 */
export const useEditDataset = () => {
  const [dataset, setDataset] = useState<IDataset>({} as IDataset);
  const {
    visible: datasetEditVisible,
    hideModal: hideDatasetEditModal,
    showModal: showDatasetEditModal,
  } = useSetModalState();
  const { saveKnowledgeConfiguration, loading } = useUpdateKnowledge(true);

  const onDatasetEditOk = useCallback(
    async (values: DatasetEditValues) => {
      const ret = await saveKnowledgeConfiguration({
        kb_id: dataset.id,
        name: values.name,
        description: values.description,
        category: values.category,
      });

      // 弹窗按返回值决定是否关闭：失败时保持打开，用户还能改。
      return ret?.code === 0;
    },
    [saveKnowledgeConfiguration, dataset],
  );

  const handleShowDatasetEditModal = useCallback(
    async (record: IDataset) => {
      setDataset(record);
      showDatasetEditModal();
    },
    [showDatasetEditModal],
  );

  return {
    datasetEditLoading: loading,
    initialDatasetName: dataset?.name,
    initialDatasetDescription: dataset?.description,
    initialDatasetCategory: dataset?.category,
    onDatasetEditOk,
    datasetEditVisible,
    hideDatasetEditModal,
    showDatasetEditModal: handleShowDatasetEditModal,
  };
};
