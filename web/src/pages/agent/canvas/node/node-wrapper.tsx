import { cn } from '@/lib/utils';
import { NodeResizeControl, useInternalNode, useNodeId } from '@xyflow/react';
import { Loader } from 'lucide-react';
import { HTMLAttributes, useContext } from 'react';
import { AgentInstanceContext, useCanvasReadonly } from '../../context';
import { ResizeIcon, resizeControlHitArea } from './resize-icon';

type IProps = HTMLAttributes<HTMLDivElement> & {
  selected?: boolean;
  /** 关掉右下角缩放角标：占位符这类临时节点没有可调的尺寸。 */
  resizable?: boolean;
  /**
   * 未缩放时也让卡片吃满外层（外层尺寸由节点内容决定）。
   * 便签这种自己带 `w-full h-full` 版式的节点要开，否则会被塞回 200px。
   */
  fill?: boolean;
  /** 缩放下限。跟着节点内容密度走，别让小卡片被拖成一条缝。 */
  minWidth?: number;
  minHeight?: number;
};

/** 与 use-add-node 里的 DefaultNodeWidth 同值：卡片没被拖过时的宽度。 */
const DEFAULT_NODE_WIDTH = 200;

export function NodeWrapper({
  children,
  className,
  selected,
  id,
  resizable = true,
  fill = false,
  minWidth = 160,
  minHeight = 60,
}: IProps) {
  const { currentSendLoading, startButNotFinishedNodeIds = [] } =
    useContext(AgentInstanceContext);
  const readOnly = useCanvasReadonly();
  const flowNodeId = useNodeId();
  const sizedNode = useInternalNode(flowNodeId ?? '');
  /**
   * 拖过右下角之后，NodeResizeControl 会把 width/height 写回节点对象，
   * 这时外层 `.react-flow__node` 有了显式尺寸，卡片必须跟着它走。
   *
   * 没拖过的节点不能也写 `w-full`：此时外层宽度是 auto（由卡片自己撑开），
   * 卡片再 `width:100%` 就成了循环依赖，画布上会直接塌成 0 宽。所以两种
   * 情况分开：拖过的用类名吃满外层，没拖过的用回之前那个 200px。
   */
  const resized = typeof sizedNode?.width === 'number';
  const filled = resized || fill;

  return (
    <section
      // 皮肤钩子：canvas-skin.css 只认 [data-node-card]，不依赖 tailwind 类名，
      // 换皮肤时不需要改这里。
      data-node-card=""
      style={filled ? undefined : { width: DEFAULT_NODE_WIDTH }}
      className={cn(
        // group 不能丢：handle.tsx 的连接点靠 `group-hover:` 放大；
        // group/node 是缩放角标自己的作用域，两者互不干扰。
        'bg-bg-component p-2.5 rounded-md border border-border-button text-xs group group/node hover:shadow-md',
        filled && 'w-full h-full',
        { 'border border-accent-primary': selected },
        className,
      )}
    >
      {resizable && !readOnly && (
        <NodeResizeControl
          minWidth={minWidth}
          minHeight={minHeight}
          // 角标只在 hover / 选中时显形，否则几十个节点一起挂图标太吵。
          //
          // pointer-events 必须一直开着：跟着 hover 一起开关的话，用户把鼠标
          // 往右下拖、指针一离开卡片范围，角标立刻变成 none，拖拽会在半路断掉。
          className={cn(
            '!opacity-0 transition-opacity group-hover/node:!opacity-100',
            selected && '!opacity-100',
          )}
          style={resizeControlHitArea}
        >
          <ResizeIcon />
        </NodeResizeControl>
      )}
      {id &&
        startButNotFinishedNodeIds.indexOf(id as string) > -1 &&
        currentSendLoading && (
          <div className=" absolute right-0 left-0 top-0 flex items-start justify-end p-2">
            <Loader size={12} className=" animate-spin" />
          </div>
        )}
      {children}
    </section>
  );
}
