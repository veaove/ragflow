import { RepresentationRenderer } from '@/components/structure-graph/representation-renderer';
import { Card } from '@/components/ui/card';
import {
  useGenerateStatus,
  useTraceRunData,
} from '@/hooks/use-dataset-generate';
import {
  DatasetStructureKeys,
  useFetchDatasetStructureGraph,
  useKnowledgeBaseId,
} from '@/hooks/use-knowledge-request';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { StructureKind, ViewMode, ViewModeGenerateTypeMap } from './constants';
import DatasetGraphView from './dataset-graph-view';
import CompilationEmptyState from './empty-state';
import { useRunEndEffect } from './hooks/use-run-end-effect';
import { CompilationLoadingCard } from './loading-card';

interface DatasetStructureViewProps {
  kind: StructureKind;
}

export function DatasetStructureView({ kind }: DatasetStructureViewProps) {
  // Graph 走知识图谱视图：同一份实体/关系数据和同一套渲染（筛选、布局、
  // 检索、证据面板），不再用内嵌小画布另起一套。
  if (kind === ViewMode.Graph) {
    return <DatasetGraphView />;
  }

  return <StructureTreeView kind={kind} />;
}

function StructureTreeView({ kind }: DatasetStructureViewProps) {
  const queryClient = useQueryClient();
  const knowledgeBaseId = useKnowledgeBaseId();
  const { data, loading } = useFetchDatasetStructureGraph(kind);
  const template = data?.templates?.[0];

  const generateType = ViewModeGenerateTypeMap[kind];
  const { data: structureRunData } = useTraceRunData(generateType);
  const { status: structureStatus } = useGenerateStatus(structureRunData);

  const handleRunEnd = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: DatasetStructureKeys.kind(knowledgeBaseId, kind),
    });
  }, [queryClient, knowledgeBaseId, kind]);

  useRunEndEffect(structureStatus, handleRunEnd);

  if (loading && !data) {
    return <CompilationLoadingCard />;
  }

  if (!template) {
    return <CompilationEmptyState type={kind} data={structureRunData} />;
  }

  return (
    <Card className="flex-1 min-h-0 overflow-hidden flex border-border-button rounded-xl flex-col">
      <RepresentationRenderer
        template={template}
        highlightNodeId={null}
        totalEntities={data?.total_entities}
        returnedEntities={data?.returned_entities}
      />
    </Card>
  );
}
