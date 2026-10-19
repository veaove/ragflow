import { AgentCategory } from '@/constants/agent';
import { useSetModalState } from '@/hooks/common-hooks';
import { useSetAgent } from '@/hooks/use-agent-request';

import { initialEmptyDsl } from '@/pages/agent/utils/dsl-bridge';
import { useCallback } from 'react';
import { FlowType } from '../constant';
import { FormSchemaType } from '../create-agent-form';

export function useCreateAgentOrPipeline() {
  const { loading, setAgent } = useSetAgent();
  const {
    visible: creatingVisible,
    hideModal: hideCreatingModal,
    showModal: showCreatingModal,
  } = useSetModalState();

  const handleCreateAgentOrPipeline = useCallback(
    async (data: FormSchemaType) => {
      const type = data.type ?? FlowType.Agent;
      const categoryMap: Record<string, AgentCategory> = {
        [FlowType.Agent]: AgentCategory.AgentCanvas,
        [FlowType.Chatflow]: AgentCategory.ChatflowCanvas,
        [FlowType.Workflow]: AgentCategory.WorkflowCanvas,
        [FlowType.Flow]: AgentCategory.DataflowCanvas,
        [FlowType.Compiler]: AgentCategory.DataflowCanvas,
      };
      const category = categoryMap[type] ?? AgentCategory.AgentCanvas;
      const isAgent = type === FlowType.Agent || type === FlowType.Chatflow || type === FlowType.Workflow;
      const ret = await setAgent({
        title: data.name,
        dsl: initialEmptyDsl(isAgent),
        canvas_category: category,
      });

      if (ret.code === 0) {
        hideCreatingModal();
      }
    },
    [hideCreatingModal, setAgent],
  );

  return {
    loading: loading,
    creatingVisible,
    hideCreatingModal,
    showCreatingModal,
    handleCreateAgentOrPipeline,
  };
}
