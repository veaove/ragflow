import { useNavigatePage } from '@/hooks/logic-hooks/navigate-hooks';
import { useRemoveKnowledgeGraph } from '@/hooks/use-knowledge-request';
import { isEditPermissionDenied } from '@/utils/permission-error';
import { useCallback, useState } from 'react';
import { useParams } from 'react-router';
import { useKnowledgeBaseContext } from '../contexts/knowledge-base-context';

export function useDeleteKnowledgeGraph() {
  const { removeKnowledgeGraph, loading } = useRemoveKnowledgeGraph();
  const { navigateToDataset } = useNavigatePage();
  const { knowledgeBase } = useKnowledgeBaseContext();
  const { id } = useParams();
  // 删图谱改的是库内容，不是"看一眼"：只读授权与部门管理员都能看这个图，但
  // 删不得。能力位来自资源层，这里只负责别发那次注定被拒的请求。
  const canDelete = knowledgeBase?.capabilities?.delete_content !== false;
  const [deleteDenied, setDeleteDenied] = useState(false);

  const handleDeleteKnowledgeGraph = useCallback(async () => {
    if (!canDelete) {
      setDeleteDenied(true);
      return;
    }
    const ret = await removeKnowledgeGraph();
    if (isEditPermissionDenied(ret)) {
      setDeleteDenied(true);
      return;
    }
    if (ret === 0 && id) {
      navigateToDataset(id)();
    }
  }, [canDelete, id, navigateToDataset, removeKnowledgeGraph]);

  return {
    handleDeleteKnowledgeGraph,
    loading,
    canDelete,
    deleteDenied,
    closeDeleteDenied: useCallback(() => setDeleteDenied(false), []),
  };
}
