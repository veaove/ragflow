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
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from 'd3-force';
import { useCallback, useEffect, useState } from 'react';
import { LayoutMode, Point, RadialRing, radialLayout, seedPositions } from './layout';

interface SimNode extends Point {
  id: string;
  degree: number;
  vx?: number;
  vy?: number;
}

interface SimLink {
  source: string;
  target: string;
}

interface UseGraphLayoutParams {
  nodes: IKGGraphNode[];
  edges: IKGGraphEdge[];
  mode: LayoutMode;
  width: number;
  height: number;
  /** bump to re-run the force layout (the "reset layout" action) */
  runId?: number;
}

export interface GraphLayoutState {
  positions: Record<string, Point>;
  rings: RadialRing[];
  moveNode: (id: string, point: Point) => void;
}

/**
 * Positions the graph either with a cooled-down force simulation or with the
 * deterministic radial rings. Node coordinates live in state because the SVG
 * renders from them; the simulation itself is stepped inside rAF so React is
 * not re-rendered from d3's own timer.
 */
export function useGraphLayout({
  nodes,
  edges,
  mode,
  width,
  height,
  runId = 0,
}: UseGraphLayoutParams): GraphLayoutState {
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const [rings, setRings] = useState<RadialRing[]>([]);

  useEffect(() => {
    if (width <= 0 || height <= 0 || nodes.length === 0) {
      setPositions({});
      setRings([]);
      return;
    }

    if (mode === 'radial') {
      const result = radialLayout(nodes, width, height);
      setPositions(result.positions);
      setRings(result.rings);
      return;
    }

    setRings([]);
    const seed = seedPositions(nodes, width, height);
    const simNodes: SimNode[] = nodes.map((node) => ({
      id: node.id,
      degree: node.degree ?? 0,
      ...(seed[node.id] ?? { x: width / 2, y: height / 2 }),
    }));
    const known = new Set(simNodes.map((node) => node.id));
    const links: SimLink[] = edges
      .filter((edge) => known.has(edge.source) && known.has(edge.target))
      .map((edge) => ({ source: edge.source, target: edge.target }));

    const simulation = forceSimulation(simNodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(links)
          .id((node) => node.id)
          .distance(140)
          .strength(0.25),
      )
      // Same shape as the prototype: strong local repulsion, weak global pull.
      .force('charge', forceManyBody<SimNode>().strength(-650).distanceMax(520))
      .force('center', forceCenter(width / 2, height / 2))
      .force('x', forceX<SimNode>(width / 2).strength(0.02))
      .force('y', forceY<SimNode>(height / 2).strength(0.02))
      .stop();

    let cancelled = false;
    let frame = 0;
    const step = () => {
      if (cancelled) {
        return;
      }
      // Two ticks per frame: the graph settles in about a second without the
      // simulation outrunning what the browser can paint.
      simulation.tick(2);
      const next: Record<string, Point> = {};
      for (const node of simNodes) {
        next[node.id] = { x: node.x ?? 0, y: node.y ?? 0 };
      }
      setPositions(next);
      if (simulation.alpha() > 0.02) {
        frame = requestAnimationFrame(step);
      }
    };
    frame = requestAnimationFrame(step);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      simulation.stop();
    };
  }, [nodes, edges, mode, width, height, runId]);

  const moveNode = useCallback((id: string, point: Point) => {
    setPositions((previous) => ({ ...previous, [id]: point }));
  }, []);

  return { positions, rings, moveNode };
}
