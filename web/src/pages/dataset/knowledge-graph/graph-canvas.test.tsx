/*
 *  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

import {
  IKGGraphEdge,
  IKGGraphNode,
} from '@/interfaces/database/knowledge-graph';
import { fireEvent, render } from '@testing-library/react';
import GraphCanvas from './graph-canvas';

const WIDTH = 800;
const HEIGHT = 600;

const nodes: IKGGraphNode[] = [
  {
    id: 'a',
    name: '华夏基金',
    type: 'organization',
    type_label: '组织',
    mention_count: 1,
    degree: 2,
  },
  {
    id: 'b',
    name: '华夏基金产品',
    type: 'fund',
    type_label: '基金产品',
    mention_count: 1,
    degree: 1,
  },
];

const edges: IKGGraphEdge[] = [
  {
    id: 'e1',
    source: 'a',
    target: 'b',
    type: 'related',
    type_label: '属于',
    normalized: true,
    confidence: 0.9,
    support: { chunks: 1, docs: 1 },
    evidence: [],
  },
];

const emptyHighlight = { nodes: new Set<string>(), edges: new Set<string>() };

interface PointerInit {
  button?: number;
  clientX?: number;
  clientY?: number;
  pointerId?: number;
}

/**
 * jsdom has no PointerEvent constructor, and the generic Event that
 * testing-library falls back to drops `button`, which makes every gesture look
 * like a right click. A MouseEvent carries the coordinates and the button;
 * pointerId is the one extra field the canvas reads.
 */
const pointerEvent = (type: string, init: PointerInit) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: init.button ?? 0,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
  });
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 });
  return event;
};

const pointerDown = (target: Element, init: PointerInit) =>
  fireEvent(target, pointerEvent('pointerdown', init));
const pointerMove = (target: Element, init: PointerInit) =>
  fireEvent(target, pointerEvent('pointermove', init));
const pointerUp = (target: Element, init: PointerInit) =>
  fireEvent(target, pointerEvent('pointerup', init));

const setupCanvas = () => {
  const utils = render(
    <GraphCanvas
      nodes={nodes}
      edges={edges}
      mode="radial"
      highlight={emptyHighlight}
      onSelect={jest.fn()}
    />,
  );

  const svg = utils.container.querySelector('svg') as SVGSVGElement;

  const viewportGroup = () =>
    utils.container.querySelector('g[transform*="scale("]') as SVGGElement;

  const nodeGroup = (id: string) => {
    const node = nodes.find((item) => item.id === id) as IKGGraphNode;
    const title = `${node.name} · ${node.type_label}`;
    return Array.from(
      utils.container.querySelectorAll('g[transform^="translate("]'),
    ).find(
      (group) =>
        !(group.getAttribute('transform') ?? '').includes('scale(') &&
        group.querySelector('title')?.textContent === title,
    ) as SVGGElement;
  };

  return { ...utils, svg, viewportGroup, nodeGroup };
};

const zoomOf = (group: Element) => {
  const match = /scale\(([\d.]+)\)/.exec(group.getAttribute('transform') ?? '');
  return match ? Number(match[1]) : Number.NaN;
};

const translateOf = (group: Element) => {
  const match = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(
    group.getAttribute('transform') ?? '',
  );
  return match ? { x: Number(match[1]), y: Number(match[2]) } : undefined;
};

beforeAll(() => {
  // jsdom has no ResizeObserver and no pointer capture; the canvas needs both.
  class ResizeObserverMock {
    private callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe() {
      this.callback(
        [
          {
            contentRect: { width: WIDTH, height: HEIGHT },
          } as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  }
  global.ResizeObserver =
    ResizeObserverMock as unknown as typeof ResizeObserver;
  Element.prototype.setPointerCapture = jest.fn();
  Element.prototype.releasePointerCapture = jest.fn();
  Element.prototype.hasPointerCapture = jest.fn(() => false);
});

describe('GraphCanvas zoom', () => {
  test('wheel up zooms in around the pointer', () => {
    const { svg, viewportGroup } = setupCanvas();
    expect(zoomOf(viewportGroup())).toBe(1);

    fireEvent.wheel(svg, { deltaY: -120, clientX: 400, clientY: 300 });

    expect(zoomOf(viewportGroup())).toBeGreaterThan(1);
    // Zoom is anchored at the pointer, so the graph shifts left and up.
    const { x, y } = translateOf(viewportGroup()) as { x: number; y: number };
    expect(x).toBeLessThan(0);
    expect(y).toBeLessThan(0);
  });

  test('wheel down zooms back out and stops at the lower bound', () => {
    const { svg, viewportGroup } = setupCanvas();

    fireEvent.wheel(svg, { deltaY: 120, clientX: 400, clientY: 300 });
    expect(zoomOf(viewportGroup())).toBeLessThan(1);

    for (let i = 0; i < 40; i += 1) {
      fireEvent.wheel(svg, { deltaY: 500, clientX: 400, clientY: 300 });
    }
    expect(zoomOf(viewportGroup())).toBeCloseTo(0.3, 5);
  });
});

describe('GraphCanvas pan', () => {
  test('dragging the background moves the whole graph', () => {
    const { svg, viewportGroup } = setupCanvas();
    const before = translateOf(viewportGroup()) as { x: number; y: number };

    pointerDown(svg, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    pointerMove(svg, { pointerId: 1, clientX: 160, clientY: 130 });

    expect(translateOf(viewportGroup())).toEqual({
      x: before.x + 60,
      y: before.y + 30,
    });
  });

  test('a pan does not clear the selection on release', () => {
    const onSelect = jest.fn();
    const { container } = render(
      <GraphCanvas
        nodes={nodes}
        edges={edges}
        mode="radial"
        highlight={emptyHighlight}
        onSelect={onSelect}
      />,
    );
    const svg = container.querySelector('svg') as SVGSVGElement;

    pointerDown(svg, { button: 0, pointerId: 2, clientX: 10, clientY: 10 });
    pointerMove(svg, { pointerId: 2, clientX: 80, clientY: 40 });
    pointerUp(svg, { pointerId: 2, clientX: 80, clientY: 40 });
    fireEvent.click(svg);

    expect(onSelect).not.toHaveBeenCalled();

    // A plain click still clears the selection.
    pointerDown(svg, { button: 0, pointerId: 3, clientX: 10, clientY: 10 });
    pointerUp(svg, { pointerId: 3, clientX: 10, clientY: 10 });
    fireEvent.click(svg);
    expect(onSelect).toHaveBeenCalledWith(undefined);
  });
});

describe('GraphCanvas hover', () => {
  test('hovering a node adds a halo and removes it on leave', () => {
    const { nodeGroup } = setupCanvas();
    const circlesBefore = nodeGroup('a').querySelectorAll('circle').length;

    fireEvent.pointerOver(nodeGroup('a'));
    expect(nodeGroup('a').querySelectorAll('circle')).toHaveLength(
      circlesBefore + 1,
    );

    fireEvent.pointerOut(nodeGroup('a'));
    expect(nodeGroup('a').querySelectorAll('circle')).toHaveLength(
      circlesBefore,
    );
  });
});

describe('GraphCanvas node drag', () => {
  test('dragging a node moves it to the cursor position', () => {
    const { svg, nodeGroup } = setupCanvas();
    const before = translateOf(nodeGroup('a')) as { x: number; y: number };

    pointerDown(nodeGroup('a'), {
      button: 0,
      pointerId: 4,
      clientX: 100,
      clientY: 100,
    });
    pointerMove(svg, { pointerId: 4, clientX: 260, clientY: 220 });
    pointerUp(svg, { pointerId: 4, clientX: 260, clientY: 220 });

    const after = translateOf(nodeGroup('a')) as { x: number; y: number };
    expect(after).not.toEqual(before);
    expect(after.x).toBeCloseTo(260, 5);
    expect(after.y).toBeCloseTo(220, 5);
  });

  test('dragging after zoom still follows the cursor', () => {
    const { svg, nodeGroup } = setupCanvas();

    fireEvent.wheel(svg, { deltaY: -400, clientX: 0, clientY: 0 });
    const before = translateOf(nodeGroup('a')) as { x: number; y: number };

    pointerDown(nodeGroup('a'), {
      button: 0,
      pointerId: 5,
      clientX: 100,
      clientY: 100,
    });
    pointerMove(svg, { pointerId: 5, clientX: 300, clientY: 200 });
    pointerUp(svg, { pointerId: 5, clientX: 300, clientY: 200 });

    // The canvas is magnified, so the same pointer travel is a shorter layout
    // move - but the node must still follow the cursor.
    const after = translateOf(nodeGroup('a')) as { x: number; y: number };
    expect(after).not.toEqual(before);
    expect(Math.abs(after.x - 100)).toBeLessThan(Math.abs(300 - 100));
  });
});
