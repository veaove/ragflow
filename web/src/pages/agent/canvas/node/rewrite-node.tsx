import { useTheme } from '@/components/theme-provider';
import { IRewriteNode } from '@/interfaces/database/agent';
import {
  Handle,
  NodeProps,
  NodeResizeControl,
  Position,
  useInternalNode,
  useNodeId,
} from '@xyflow/react';
import classNames from 'classnames';
import { get } from 'lodash';
import { memo } from 'react';
import { useCanvasReadonly } from '../../context';
import { LLMLabelCard } from './card';
import { LeftHandleStyle, RightHandleStyle } from './handle-icon';
import styles from './index.module.less';
import NodeHeader from './node-header';
import { ResizeIcon, resizeControlHitArea } from './resize-icon';

function InnerRewriteNode({
  id,
  data,
  isConnectable = true,
  selected,
}: NodeProps<IRewriteNode>) {
  const { theme } = useTheme();
  const readOnly = useCanvasReadonly();
  const sizedNode = useInternalNode(useNodeId() ?? '');
  // 这个节点没走 NodeWrapper（用的是 less 里的 logicNode 版式），所以宽高
  // 适配要自己判断：拖过角标之后才让 style 吃满外层，否则保持 less 定的宽度。
  const resized = typeof sizedNode?.width === 'number';

  return (
    <section
      style={resized ? { width: '100%', height: '100%' } : undefined}
      className={classNames(
        styles.logicNode,
        'group/node',
        theme === 'dark' ? styles.dark : '',
        {
          [styles.selectedNode]: selected,
        },
      )}
    >
      {!readOnly && (
        <NodeResizeControl
          minWidth={160}
          minHeight={60}
          className={classNames('transition-opacity', {
            '!opacity-100': selected,
            '!opacity-0 group-hover/node:!opacity-100': !selected,
          })}
          style={resizeControlHitArea}
        >
          <ResizeIcon />
        </NodeResizeControl>
      )}
      <Handle
        id="c"
        type="source"
        position={Position.Left}
        isConnectable={isConnectable}
        className={styles.handle}
        style={LeftHandleStyle}
      ></Handle>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={isConnectable}
        className={styles.handle}
        style={RightHandleStyle}
        id="b"
      ></Handle>

      <NodeHeader
        id={id}
        name={data.name}
        label={data.label}
        className={styles.nodeHeader}
      ></NodeHeader>

      <LLMLabelCard llmId={get(data, 'form.llm_id')}></LLMLabelCard>
    </section>
  );
}

export const RewriteNode = memo(InnerRewriteNode);
