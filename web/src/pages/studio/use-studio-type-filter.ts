import { AgentCategory } from '@/constants/agent';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';

export type StudioType = 'all' | 'workflow' | 'chatflow';

const VALID: StudioType[] = ['all', 'workflow', 'chatflow'];

/**
 * 工作室的类型 Tab 状态。落在 URL query 上，刷新和分享链接都能保留视图，
 * 与智能体列表的 filterValue 体验保持一致。
 *
 * canvasCategoryIds 是传给列表接口的过滤值：studio 只承载 chatflow_canvas
 * 与 workflow_canvas，agent_canvas / dataflow_canvas 留在智能体模块。
 */
export function useStudioTypeFilter() {
  const [searchParams, setSearchParams] = useSearchParams();

  const raw = searchParams.get('type');
  const type: StudioType = useMemo(
    () => (VALID.includes(raw as StudioType) ? (raw as StudioType) : 'all'),
    [raw],
  );

  const canvasCategoryIds = useMemo(() => {
    switch (type) {
      case 'workflow':
        return [AgentCategory.WorkflowCanvas];
      case 'chatflow':
        return [AgentCategory.ChatflowCanvas];
      default:
        return [AgentCategory.WorkflowCanvas, AgentCategory.ChatflowCanvas];
    }
  }, [type]);

  const setType = (next: StudioType) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'all') {
      params.delete('type');
    } else {
      params.set('type', next);
    }
    // 切换类型回到第 1 页：上一页的页码在新类型下可能不存在（产品文档 3.3 联动）。
    params.delete('page');
    setSearchParams(params);
  };

  return { type, setType, canvasCategoryIds };
}
