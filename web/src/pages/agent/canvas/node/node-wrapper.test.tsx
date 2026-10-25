import { act, render, screen } from '@testing-library/react';
import { ReactFlow, useNodesState } from '@xyflow/react';
import { CanvasReadonlyContext } from '../../context';
import { NodeWrapper } from './node-wrapper';

// React Flow measures nodes with ResizeObserver and parses zoom transforms with
// DOMMatrixReadOnly; jsdom has neither (xyflow testing guide recipe).
beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = ResizeObserverStub;
  }

  class DOMMatrixReadOnlyStub {
    m22: number;
    constructor(transform?: string) {
      const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1];
      this.m22 = scale ? Number(scale) : 1;
    }
  }
  if (!window.DOMMatrixReadOnly) {
    window.DOMMatrixReadOnly =
      DOMMatrixReadOnlyStub as unknown as typeof DOMMatrixReadOnly;
  }
});

function WrapperNode() {
  return (
    <NodeWrapper selected={false}>
      <div>body</div>
    </NodeWrapper>
  );
}

function FillNode() {
  return (
    <NodeWrapper selected={false} fill>
      <div>filled body</div>
    </NodeWrapper>
  );
}

const nodeTypes = { wrapperNode: WrapperNode, fillNode: FillNode };

const cardOf = (nodeId: string) =>
  document.querySelector(
    `.react-flow__node[data-id="${nodeId}"] [data-node-card]`,
  ) as HTMLElement | null;

function renderCanvas(
  nodes: {
    id: string;
    width?: number;
    height?: number;
  }[],
  readOnly = false,
) {
  return render(
    <CanvasReadonlyContext.Provider value={readOnly}>
      <ReactFlow
        nodes={nodes.map((node, index) => ({
          ...node,
          type: 'wrapperNode',
          position: { x: 0, y: index * 200 },
          data: { label: node.id },
        }))}
        edges={[]}
        nodeTypes={nodeTypes}
      />
    </CanvasReadonlyContext.Provider>,
  );
}

function renderFillCanvas() {
  return render(
    <CanvasReadonlyContext.Provider value={false}>
      <ReactFlow
        nodes={[
          {
            id: 'filled',
            type: 'fillNode',
            position: { x: 0, y: 0 },
            data: { label: 'filled' },
          },
        ]}
        edges={[]}
        nodeTypes={nodeTypes}
      />
    </CanvasReadonlyContext.Provider>,
  );
}

describe('NodeWrapper resize affordance', () => {
  it('keeps the intrinsic 200px width for nodes that were never resized', () => {
    renderCanvas([{ id: 'plain' }]);

    const card = cardOf('plain');
    expect(card).not.toBeNull();
    // 没拖过角标的节点外层 `.react-flow__node` 没有显式宽度，卡片必须自己
    // 给出宽度；改成 w-full 会和父容器的 auto 宽度互相等待，画布上直接塌掉。
    expect(card?.style.width).toBe('200px');
    expect(card?.className).not.toContain('w-full');
    expect(card?.className).not.toContain('h-full');
  });

  it('fills the node box once the node carries an explicit size', () => {
    renderCanvas([{ id: 'sized', width: 320, height: 180 }]);

    const card = cardOf('sized');
    expect(card).not.toBeNull();
    // 拖过角标之后 React Flow 把 width/height 写回节点，外层有了确定尺寸，
    // 卡片就该吃满它，否则用户只看到选择框变大、卡片纹丝不动。
    expect(card?.style.width).toBe('');
    expect(card?.className).toContain('w-full');
    expect(card?.className).toContain('h-full');
  });

  it('leaves the width to the node itself when fill is on', () => {
    renderFillCanvas();

    const card = cardOf('filled');
    // 便签这类节点自带 w-full h-full 版式，NodeWrapper 不能再用 200px 盖掉它。
    expect(card?.style.width).toBe('');
    expect(card?.className).toContain('w-full');
    expect(card?.className).toContain('h-full');
  });

  it('renders a resize control for editable canvases', () => {
    renderCanvas([{ id: 'plain' }]);

    expect(
      document.querySelector(
        '.react-flow__node[data-id="plain"] .react-flow__resize-control',
      ),
    ).not.toBeNull();
  });

  it('hides the resize control on a read-only canvas', () => {
    renderCanvas([{ id: 'plain' }], true);

    expect(
      document.querySelector(
        '.react-flow__node[data-id="plain"] .react-flow__resize-control',
      ),
    ).toBeNull();
    expect(screen.getByText('body')).not.toBeNull();
  });

  it('switches to fill mode after a resize, box and card agree', () => {
    let dispatch: ((changes: unknown[]) => void) | undefined;

    function Canvas() {
      const [nodes, , onNodesChange] = useNodesState([
        {
          id: 'plain',
          type: 'wrapperNode',
          position: { x: 0, y: 0 },
          data: { label: 'plain' },
        },
      ]);
      dispatch = onNodesChange as (changes: unknown[]) => void;
      return (
        <CanvasReadonlyContext.Provider value={false}>
          <ReactFlow
            nodes={nodes}
            edges={[]}
            onNodesChange={onNodesChange}
            nodeTypes={nodeTypes}
          />
        </CanvasReadonlyContext.Provider>
      );
    }

    render(<Canvas />);

    const plainBox = document.querySelector(
      '.react-flow__node[data-id="plain"]',
    ) as HTMLElement;
    expect(plainBox.style.width).toBe('');
    expect(cardOf('plain')?.style.width).toBe('200px');

    // NodeResizeControl 拖拽时派发的就是这个 change：带 setAttributes 的
    // dimensions，xyflow 会把它写回 node.width / node.height。
    act(() => {
      dispatch?.([
        {
          id: 'plain',
          type: 'dimensions',
          dimensions: { width: 320, height: 180 },
          setAttributes: true,
        },
      ]);
    });

    expect(plainBox.style.width).toBe('320px');
    expect(plainBox.style.height).toBe('180px');
    expect(cardOf('plain')?.style.width).toBe('');
    expect(cardOf('plain')?.className).toContain('w-full');
    expect(cardOf('plain')?.className).toContain('h-full');
  });
});
