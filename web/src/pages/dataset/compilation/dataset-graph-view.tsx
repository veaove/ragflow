import { Card } from '@/components/ui/card';

import KnowledgeGraphView from '../knowledge-graph/knowledge-graph-view';

/**
 * Artifacts 的 Graph 视图。
 *
 * 读的仍然是本知识库的知识图谱（/datasets/:id/graph，和侧栏「知识图谱」
 * 同一个接口、同一批实体与关系行），渲染也复用同一个视图组件：类型筛选、
 * 力导向/环形布局、检索模式和证据面板都在里面，这里只负责把它放进卡片。
 */
export function DatasetGraphView() {
  return (
    <Card className="flex-1 min-h-0 overflow-hidden flex border-border-button rounded-xl flex-col">
      <KnowledgeGraphView className="min-h-0 flex-1" />
    </Card>
  );
}

export default DatasetGraphView;
