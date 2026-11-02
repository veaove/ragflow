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

import { IKGGraphEdge, IKGGraphNode } from '@/interfaces/database/knowledge-graph';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  confidenceLabel,
  edgeEndpoints,
  filterGraph,
  highlightIds,
  maxDegreeOf,
  nodeRadius,
  radialLayout,
  seedPositions,
  toLayoutPoint,
  wheelZoomFactor,
  zoomAt,
} from './layout';

const makeNode = (id: string, degree: number): IKGGraphNode => ({
  id,
  name: id,
  type: 'organization',
  type_label: '组织',
  mention_count: 1,
  degree,
});

const makeEdge = (
  id: string,
  source: string,
  target: string,
  type = 'issue',
): IKGGraphEdge => ({
  id,
  source,
  target,
  type,
  type_label: type,
  normalized: true,
  confidence: 0.8,
  support: { chunks: 1, docs: 1 },
});

describe('nodeRadius', () => {
  test('grows with degree and stays bounded', () => {
    expect(nodeRadius(0, 10)).toBeCloseTo(7);
    expect(nodeRadius(10, 10)).toBeGreaterThan(nodeRadius(3, 10));
    expect(nodeRadius(10, 10)).toBeLessThanOrEqual(19);
    expect(nodeRadius(5, 0)).toBe(7);
  });

  test('maxDegreeOf handles an empty graph', () => {
    expect(maxDegreeOf([])).toBe(0);
  });
});

describe('seedPositions', () => {
  test('is deterministic and spreads nodes apart', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const first = seedPositions(nodes, 800, 600);
    const second = seedPositions(nodes, 800, 600);
    expect(first).toEqual(second);
    expect(first.a).not.toEqual(first.b);
    Object.values(first).forEach((point) => {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    });
  });
});

describe('radialLayout', () => {
  test('places every node and keeps hubs closer to the center', () => {
    const nodes = [
      makeNode('hub', 8),
      makeNode('mid', 4),
      makeNode('leaf-1', 1),
      makeNode('leaf-2', 1),
      makeNode('leaf-3', 1),
    ];
    const { positions, rings } = radialLayout(nodes, 800, 600);
    expect(Object.keys(positions)).toHaveLength(nodes.length);
    expect(rings.length).toBeGreaterThan(1);

    const distance = (id: string) =>
      Math.hypot(positions[id].x - 400, positions[id].y - 300);
    expect(distance('hub')).toBeLessThan(distance('leaf-1'));
    expect(rings.map((ring) => ring.radius)).toEqual(
      [...rings.map((ring) => ring.radius)].sort((a, b) => a - b),
    );
  });

  test('returns nothing for an empty graph', () => {
    expect(radialLayout([], 800, 600)).toEqual({ positions: {}, rings: [] });
  });
});

describe('edgeEndpoints', () => {
  test('stops at the node circles instead of the centers', () => {
    const { x1, y1, x2, y2 } = edgeEndpoints(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      10,
      20,
    );
    expect(x1).toBeCloseTo(11);
    expect(y1).toBeCloseTo(0);
    expect(x2).toBeCloseTo(73);
    expect(y2).toBeCloseTo(0);
  });
});

describe('filterGraph', () => {
  test('drops edges whose endpoint type is hidden', () => {
    const nodes = [
      { ...makeNode('a', 1), type: 'fund_company' },
      { ...makeNode('b', 1), type: 'risk' },
      { ...makeNode('c', 0), type: 'risk' },
    ];
    const edges = [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')];

    const noRisk = filterGraph(nodes, edges, new Set(['risk']), new Set());
    expect(noRisk.nodes.map((node) => node.id)).toEqual(['a']);
    expect(noRisk.edges).toEqual([]);

    const noIssue = filterGraph(nodes, edges, new Set(), new Set(['issue']));
    expect(noIssue.nodes).toHaveLength(3);
    expect(noIssue.edges).toEqual([]);
  });
});

describe('highlightIds', () => {
  const edges = [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')];

  test('prefers the server-side search hit set', () => {
    const result = highlightIds(edges, ['a'], ['e1'], { kind: 'node', id: 'c' });
    expect(result.edges.has('e1')).toBe(true);
    expect(result.nodes.has('a')).toBe(true);
    expect(result.nodes.has('b')).toBe(true);
    expect(result.nodes.has('c')).toBe(false);
  });

  test('falls back to the selection neighbourhood', () => {
    const result = highlightIds(edges, [], [], { kind: 'node', id: 'b' });
    expect([...result.edges].sort()).toEqual(['e1', 'e2']);
    expect([...result.nodes].sort()).toEqual(['a', 'b', 'c']);
  });

  test('highlights both endpoints of a selected relation', () => {
    const result = highlightIds(edges, [], [], { kind: 'edge', id: 'e2' });
    expect([...result.edges]).toEqual(['e2']);
    expect([...result.nodes].sort()).toEqual(['b', 'c']);
  });

  test('returns empty sets when nothing is selected', () => {
    const result = highlightIds(edges, [], []);
    expect(result.nodes.size).toBe(0);
    expect(result.edges.size).toBe(0);
  });
});

describe('confidenceLabel', () => {
  test('renders a rounded percentage', () => {
    expect(confidenceLabel(0.944)).toBe('94%');
    expect(confidenceLabel(0)).toBe('0%');
  });
});

describe('clampZoom', () => {
  test('keeps zoom inside the readable range', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(1.4)).toBe(1.4);
  });

  test('falls back to 1:1 on a broken value', () => {
    expect(clampZoom(Number.NaN)).toBe(1);
  });
});

describe('wheelZoomFactor', () => {
  test('wheel up zooms in and wheel down zooms out', () => {
    expect(wheelZoomFactor(-120)).toBeGreaterThan(1);
    expect(wheelZoomFactor(120)).toBeLessThan(1);
  });

  test('is symmetric and neutral at zero', () => {
    expect(wheelZoomFactor(0)).toBe(1);
    expect(wheelZoomFactor(-100) * wheelZoomFactor(100)).toBeCloseTo(1, 5);
  });
});

describe('zoomAt', () => {
  const pointer = { x: 200, y: 120 };

  test('keeps the layout point under the pointer', () => {
    const before = { k: 1, x: 0, y: 0 };
    const after = zoomAt(before, pointer, 1.5);
    const layoutBefore = toLayoutPoint(before, pointer);
    const layoutAfter = toLayoutPoint(after, pointer);
    expect(after.k).toBeCloseTo(1.5, 5);
    expect(layoutAfter.x).toBeCloseTo(layoutBefore.x, 5);
    expect(layoutAfter.y).toBeCloseTo(layoutBefore.y, 5);
  });

  test('anchors around the pointer, not the origin', () => {
    const after = zoomAt({ k: 1, x: 0, y: 0 }, pointer, 2);
    expect(after.x).toBeCloseTo(-200, 5);
    expect(after.y).toBeCloseTo(-120, 5);
  });

  test('stops at the bounds instead of drifting', () => {
    const atMax = { k: MAX_ZOOM, x: 10, y: 20 };
    expect(zoomAt(atMax, pointer, 4)).toBe(atMax);
  });

  test('round-trips through toLayoutPoint', () => {
    const viewport = { k: 2.5, x: -80, y: 40 };
    const layout = toLayoutPoint(viewport, { x: 300, y: 200 });
    const back = {
      x: layout.x * viewport.k + viewport.x,
      y: layout.y * viewport.k + viewport.y,
    };
    expect(back.x).toBeCloseTo(300, 5);
    expect(back.y).toBeCloseTo(200, 5);
  });
});
