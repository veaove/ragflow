/*
 *  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

import { PermissionDeniedDialog } from '@/components/permission-denied-dialog';
import KnowledgeGraphView from './knowledge-graph-view';
import { useDeleteKnowledgeGraph } from './use-delete-graph';

const KnowledgeGraph = () => {
  const { handleDeleteKnowledgeGraph, canDelete, deleteDenied, closeDeleteDenied } =
    useDeleteKnowledgeGraph();

  return (
    <>
      <KnowledgeGraphView
        onDelete={handleDeleteKnowledgeGraph}
        canDelete={canDelete}
      />
      <PermissionDeniedDialog
        open={deleteDenied}
        title="无法删除知识图谱"
        description="你对这个知识库只有「可查看」权限，删除知识图谱属于修改库内容，需要「可编辑」授权。图谱仍然可以查看和检索；如需删除或重建，请联系知识库所有者或本租户管理员调整授权。"
        testId="knowledge-graph-delete-denied"
        onClose={closeDeleteDenied}
      />
    </>
  );
};

export default KnowledgeGraph;
