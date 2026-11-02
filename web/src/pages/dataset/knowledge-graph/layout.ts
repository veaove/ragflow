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

export type LayoutMode = 'force' | 'radial';

export interface Point {
  x: number;
  y: number;
}

export interface RadialRing {
  radius: number;
  /** number of nodes placed on the ring */
  count: number;
}

export const CANVAS_PADDING = 72;

/** Node radius grows with degree so hubs read as hubs, but stays bounded. */
export function nodeRadius(degree: number, maxDegree: number): number {
  const base = 7;
  if (maxDegree <= 0) {
    return base;
  }
  const ratio = Math.log1p(Math.max(degree, 0)) / Math.log1p(maxDegree);
  return base + ratio * 12;
}

export function maxDegreeOf(nodes: { degree: number }[]): number {
  return nodes.reduce((max, node) => Math.max(max, node.degree ?? 0), 0);
}

function ringSeed(index: number, total: number, width: number, height: number) {
  const radius = Math.max(60, Math.min(width, height) / 2 - CANVAS_PADDING);
  const angle = (index / Math.max(total, 1)) * Math.PI * 2;
  return {
    x: width / 2 + Math.cos(angle) * radius,
    y: height / 2 + Math.sin(angle) * radius,
  };
}

/**
 * Deterministic initial positions for the force layout. Seeding on a circle
 * instead of random coordinates keeps reloads visually stable and avoids the
 * first frames where every node sits on top of every other.
 */
export function seedPositions(
  nodes: { id: string }[],
  width: number,
  height: number,
): Record<string, Point> {
  const positions: Record<string, Point> = {};
  nodes.forEach((node, index) => {
    positions[node.id] = ringSeed(index, nodes.length, width, height);
  });
  return positions;
}

/**
 * Radial layout: hubs innermost, leaves outside, split into three rings so a
 * graph with a flat degree distribution still uses the canvas. Returns the ring
 * radii so the canvas can draw the guide circles the prototype shows.
 */
export function radialLayout(
  nodes: { id: string; degree: number }[],
  width: number,
  height: number,
): { positions: Record<string, Point>; rings: RadialRing[] } {
  const positions: Record<string, Point> = {};
  if (nodes.length === 0) {
    return { positions, rings: [] };
  }
  const cx = width / 2;
  const cy = height / 2;
  const outer = Math.max(90, Math.min(width, height) / 2 - CANVAS_PADDING);
  const radii = [outer * 0.38, outer * 0.7, outer];

  const sorted = [...nodes].sort((a, b) => {
    if ((b.degree ?? 0) !== (a.degree ?? 0)) {
      return (b.degree ?? 0) - (a.degree ?? 0);
    }
    return a.id.localeCompare(b.id);
  });
  const firstCut = Math.max(1, Math.ceil(sorted.length * 0.2));
  const secondCut = Math.max(firstCut, Math.ceil(sorted.length * 0.55));
  const buckets = [
    sorted.slice(0, firstCut),
    sorted.slice(firstCut, secondCut),
    sorted.slice(secondCut),
  ];

  const rings: RadialRing[] = [];
  buckets.forEach((bucket, ringIndex) => {
    if (bucket.length === 0) {
      return;
    }
    rings.push({ radius: radii[ringIndex], count: bucket.length });
    bucket.forEach((node, index) => {
      if (bucket.length === 1 && ringIndex === 0) {
        positions[node.id] = { x: cx, y: cy };
        return;
      }
      const angle = (index / bucket.length) * Math.PI * 2 - Math.PI / 2;
      positions[node.id] = {
        x: cx + Math.cos(angle) * radii[ringIndex],
        y: cy + Math.sin(angle) * radii[ringIndex],
      };
    });
  });

  return { positions, rings };
}

/**
 * Shortens a node-to-node segment so the arrow head lands on the target circle
 * instead of underneath it, and the line starts outside the source circle.
 */
export function edgeEndpoints(
  from: Point,
  to: Point,
  fromRadius: number,
  toRadius: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy) || 1;
  const ux = dx / distance;
  const uy = dy / distance;
  return {
    x1: from.x + ux * (fromRadius + 1),
    y1: from.y + uy * (fromRadius + 1),
    x2: to.x - ux * (toRadius + 7),
    y2: to.y - uy * (toRadius + 7),
  };
}

export interface VisibleGraph {
  nodes: IKGGraphNode[];
  edges: IKGGraphEdge[];
}

/**
 * Applies the legend/relation filter. Edges survive only when both endpoints are
 * visible, so a hidden entity type never leaves dangling arrows.
 */
export function filterGraph(
  nodes: IKGGraphNode[],
  edges: IKGGraphEdge[],
  hiddenEntityTypes: Set<string>,
  hiddenRelationTypes: Set<string>,
): VisibleGraph {
  const visibleNodes = nodes.filter(
    (node) => !hiddenEntityTypes.has(node.type),
  );
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = edges.filter(
    (edge) =>
      !hiddenRelationTypes.has(edge.type) &&
      visibleIds.has(edge.source) &&
      visibleIds.has(edge.target),
  );
  return { nodes: visibleNodes, edges: visibleEdges };
}

export interface Selection {
  kind: 'node' | 'edge';
  id: string;
}

/** Below this the labels are unreadable; above it a node fills the canvas. */
export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 3;

/**
 * Canvas pan/zoom. `k` scales the whole graph, `x`/`y` shift it in screen
 * pixels; node coordinates are always layout coordinates and never change when
 * the view is zoomed.
 */
export interface Viewport {
  k: number;
  x: number;
  y: number;
}

export const IDENTITY_VIEWPORT: Viewport = { k: 1, x: 0, y: 0 };

export function clampZoom(k: number): number {
  if (!Number.isFinite(k)) {
    return 1;
  }
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}

/**
 * Zooms around a pointer given in canvas (screen) pixels, so the layout point
 * under the cursor stays under the cursor.
 */
export function zoomAt(
  viewport: Viewport,
  pointer: Point,
  factor: number,
): Viewport {
  const k = clampZoom(viewport.k * factor);
  if (k === viewport.k) {
    return viewport;
  }
  const ratio = k / viewport.k;
  return {
    k,
    x: pointer.x - (pointer.x - viewport.x) * ratio,
    y: pointer.y - (pointer.y - viewport.y) * ratio,
  };
}

/** Canvas (screen) pixel to layout coordinate under the current viewport. */
export function toLayoutPoint(viewport: Viewport, point: Point): Point {
  const k = viewport.k || 1;
  return {
    x: (point.x - viewport.x) / k,
    y: (point.y - viewport.y) / k,
  };
}

/**
 * Wheel delta to zoom factor. Wheel up (negative delta) zooms in, wheel down
 * zooms out; the exponential keeps a trackpad's many small deltas and a mouse
 * wheel's single 100px delta feeling like the same gesture.
 */
export function wheelZoomFactor(deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) {
    return 1;
  }
  return Math.exp(-deltaY * 0.0015);
}

/**
 * What the canvas dims around: the server-side search hit set when a query is
 * active, otherwise the neighbourhood of the current selection. An empty result
 * means "no dimming".
 */
export function highlightIds(
  edges: IKGGraphEdge[],
  matchedNodeIds: string[],
  matchedEdgeIds: string[],
  selection?: Selection,
): { nodes: Set<string>; edges: Set<string> } {
  const nodeSet = new Set<string>();
  const edgeSet = new Set<string>();

  if (matchedNodeIds.length > 0 || matchedEdgeIds.length > 0) {
    matchedNodeIds.forEach((id) => nodeSet.add(id));
    matchedEdgeIds.forEach((id) => edgeSet.add(id));
    edges.forEach((edge) => {
      if (edgeSet.has(edge.id)) {
        nodeSet.add(edge.source);
        nodeSet.add(edge.target);
      }
    });
    return { nodes: nodeSet, edges: edgeSet };
  }

  if (!selection) {
    return { nodes: nodeSet, edges: edgeSet };
  }
  if (selection.kind === 'node') {
    nodeSet.add(selection.id);
    edges.forEach((edge) => {
      if (edge.source === selection.id || edge.target === selection.id) {
        edgeSet.add(edge.id);
        nodeSet.add(edge.source);
        nodeSet.add(edge.target);
      }
    });
    return { nodes: nodeSet, edges: edgeSet };
  }
  const edge = edges.find((item) => item.id === selection.id);
  if (edge) {
    edgeSet.add(edge.id);
    nodeSet.add(edge.source);
    nodeSet.add(edge.target);
  }
  return { nodes: nodeSet, edges: edgeSet };
}

export function confidenceLabel(confidence: number): string {
  return `${Math.round((confidence ?? 0) * 100)}%`;
}

export function edgeLabel(edge: IKGGraphEdge, fromName = '', toName = ''): string {
  return `${fromName} ${edge.type_label} ${toName}`.trim();
}
