import OperatorIcon from '@/components/operator-icon';
import { IRagNode } from '@/interfaces/database/agent';
import { NodeProps, Position } from '@xyflow/react';
import { memo } from 'react';
import { NodeHandleId, Operator } from '../../constant';
import { CommonHandle, LeftEndHandle } from './handle';
import { RightHandleStyle } from './handle-icon';
import NodeHeader from './node-header';
import { NodeWrapper } from './node-wrapper';
import { ToolBar } from './toolbar';

/**
 * 工作室一线节点（End / Answer / LLM / 参数提取 / 模板转换）的画布卡片。
 *
 * 与通用 RagNode 的区别只有一点：标题图标用彩色方块（对齐原型 .node），
 * 其余骨架（handle、选中态、工具栏）与 ragNode 完全一致。
 * 单独成一个 type，是因为直接改 RagNode 会波及智能体的 fallback 节点。
 */
function InnerStudioNode({ id, data, selected }: NodeProps<IRagNode>) {
  return (
    <ToolBar
      selected={selected}
      id={id}
      label={data.label}
      showRun={false}
      showCopy={false}
    >
      <NodeWrapper selected={selected} id={id}>
        <LeftEndHandle></LeftEndHandle>
        <CommonHandle
          type="source"
          position={Position.Right}
          id={NodeHandleId.Start}
          style={RightHandleStyle}
          nodeId={id}
          isConnectableEnd={false}
        ></CommonHandle>
        <NodeHeader
          id={id}
          name={data.name}
          label={data.label}
          icon={<OperatorIcon name={data.label as Operator} colored />}
        ></NodeHeader>
      </NodeWrapper>
    </ToolBar>
  );
}

export const StudioNode = memo(InnerStudioNode);
