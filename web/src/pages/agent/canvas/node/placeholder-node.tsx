import { Skeleton } from '@/components/ui/skeleton';
import { NodeProps, Position } from '@xyflow/react';
import { memo } from 'react';
import { NodeHandleId } from '../../constant';
import { CommonHandle } from './handle';
import { LeftHandleStyle } from './handle-icon';
import { NodeWrapper } from './node-wrapper';

function InnerPlaceholderNode({ id, selected }: NodeProps) {
  return (
    // 占位符是拖线时临时贴上去的骨架屏，落定就会被真实节点替换，
    // 给它缩放角标只会挡住拖拽。
    <NodeWrapper selected={selected} resizable={false}>
      <CommonHandle
        type="target"
        position={Position.Left}
        isConnectable
        style={LeftHandleStyle}
        nodeId={id}
        id={NodeHandleId.End}
      ></CommonHandle>
      <div className="space-y-2">
        <Skeleton className="h-8 w-8 rounded-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    </NodeWrapper>
  );
}

export const PlaceholderNode = memo(InnerPlaceholderNode);
