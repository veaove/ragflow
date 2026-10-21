import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Operator } from '@/constants/agent';
import { IModalProps } from '@/interfaces/common';
import { AgentInstanceContext, HandleContext } from '@/pages/agent/context';
import OperatorIcon from '@/components/operator-icon';
import { Position } from '@xyflow/react';
import { lowerFirst } from 'lodash';
import { createContext, useContext } from 'react';
import { useTranslation } from 'react-i18next';

export type OperatorItemProps = {
  operators: Operator[];
  isCustomDropdown?: boolean;
  mousePosition?: { x: number; y: number };
};

export const HideModalContext = createContext<IModalProps<any>['showModal']>(
  () => {},
);
export const OnNodeCreatedContext = createContext<
  ((newNodeId: string) => void) | undefined
>(undefined);

/**
 * 少数节点的 i18n key 不能由 `lowerFirst(operator)` 推出来：
 * - LLM：lowerFirst 得到 `lLM`，而文案里存的是 `llm`，匹配不上 →
 *   界面直接显示 `flow.lLM` 这种原始 key。
 * - Answer：`flow.answer` 已被占用（值是「对话」，语义不符），
 *   新节点用 `answerNode`。
 */
const NODE_I18N_KEY: Partial<Record<Operator, string>> = {
  [Operator.LLM]: 'llm',
  [Operator.Answer]: 'answerNode',
};

const nodeI18nKey = (operator: Operator) =>
  NODE_I18N_KEY[operator] ?? lowerFirst(operator);

export function OperatorItemList({
  operators,
  isCustomDropdown = false,
  mousePosition,
}: OperatorItemProps) {
  const { addCanvasNode } = useContext(AgentInstanceContext);
  const handleContext = useContext(HandleContext);
  const hideModal = useContext(HideModalContext);
  const onNodeCreated = useContext(OnNodeCreatedContext);
  const { t } = useTranslation();

  const handleClick =
    (operator: Operator): React.MouseEventHandler<HTMLElement> =>
    (e) => {
      const contextData = handleContext || {
        nodeId: '',
        id: '',
        type: 'source' as const,
        position: Position.Right,
        isFromConnectionDrag: true,
      };

      const mockEvent = mousePosition
        ? {
            clientX: mousePosition.x,
            clientY: mousePosition.y,
          }
        : e;

      const newNodeId = addCanvasNode(operator, contextData)(mockEvent);

      if (onNodeCreated && newNodeId) {
        onNodeCreated(newNodeId);
      }

      hideModal?.();
    };

  const renderOperatorItem = (operator: Operator) => {
    const commonContent = (
      <div className="hover:bg-background-card py-1 px-3 cursor-pointer rounded-sm flex gap-2 items-center justify-start">
        <OperatorIcon name={operator} />
        {t(`flow.${nodeI18nKey(operator)}`)}
      </div>
    );

    return (
      <Tooltip key={operator}>
        <TooltipTrigger asChild>
          {isCustomDropdown ? (
            <li onClick={handleClick(operator)}>{commonContent}</li>
          ) : (
            <DropdownMenuItem
              key={operator}
              className="hover:bg-background-card py-1 px-3 cursor-pointer rounded-sm flex gap-2 items-center justify-start"
              onClick={handleClick(operator)}
              onSelect={() => hideModal?.()}
            >
              <OperatorIcon name={operator} />
              {t(`flow.${nodeI18nKey(operator)}`)}
            </DropdownMenuItem>
          )}
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={24}>
          <p>{t(`flow.${nodeI18nKey(operator)}Description`)}</p>
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <ul className="space-y-2 text-text-primary font-normal">
      {operators.map(renderOperatorItem)}
    </ul>
  );
}
