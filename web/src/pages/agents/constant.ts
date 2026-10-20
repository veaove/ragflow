import { AgentCategory } from '@/constants/agent';
import { LucideIcon, MessageSquareText, Network, Route, Shapes, Workflow } from 'lucide-react';

export enum FlowType {
  Agent = 'agent',
  Chatflow = 'chatflow',
  Workflow = 'workflow',
  Compiler = 'compiler',
  Flow = 'flow',
}

export const FlowTypeConfig: Record<
  FlowType,
  { icon: LucideIcon; labelKey: string; color: string }
> = {
  [FlowType.Agent]: {
    icon: Network,
    labelKey: 'tabList.agentCanvas',
    color: 'var(--team-member)',
  },
  [FlowType.Chatflow]: {
    icon: MessageSquareText,
    labelKey: 'chatflow',
    color: 'var(--team-department)',
  },
  [FlowType.Workflow]: {
    icon: Workflow,
    labelKey: 'taskFlow',
    color: 'var(--team-group)',
  },
  [FlowType.Compiler]: {
    icon: Shapes,
    labelKey: 'tabList.compilationOperator',
    color: 'var(--team-department)',
  },
  [FlowType.Flow]: {
    icon: Route,
    labelKey: 'tabList.ingestionPipeline',
    color: 'var(--team-group)',
  },
};

/**
 * Map canvas_category → FlowType for resolving icons in agent cards.
 */
export const CanvasCategoryToFlowType: Record<string, FlowType> = {
  [AgentCategory.AgentCanvas]: FlowType.Agent,
  [AgentCategory.ChatflowCanvas]: FlowType.Chatflow,
  [AgentCategory.WorkflowCanvas]: FlowType.Workflow,
  [AgentCategory.DataflowCanvas]: FlowType.Flow,
};
