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
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  IDENTITY_VIEWPORT,
  LayoutMode,
  Selection,
  Viewport,
  edgeEndpoints,
  maxDegreeOf,
  nodeRadius,
  toLayoutPoint,
  wheelZoomFactor,
  zoomAt,
} from './layout';
import { useGraphLayout } from './use-graph-layout';

const DIM_OPACITY = 0.15;
/** Above this many edges the labels turn into noise, so only hits keep them. */
const EDGE_LABEL_BUDGET = 120;
/** Pointer travel (css px) that turns a press into a drag instead of a click. */
const DRAG_THRESHOLD = 4;

interface GraphCanvasProps {
  nodes: IKGGraphNode[];
  edges: IKGGraphEdge[];
  mode: LayoutMode;
  selection?: Selection;
  highlight: { nodes: Set<string>; edges: Set<string> };
  runId?: number;
  onSelect: (selection?: Selection) => void;
}

interface PanGesture {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

const GraphCanvas = ({
  nodes,
  edges,
  mode,
  selection,
  highlight,
  runId,
  onSelect,
}: GraphCanvasProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef<string | null>(null);
  const panRef = useRef<PanGesture | null>(null);
  const draggedRef = useRef(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<Viewport>(IDENTITY_VIEWPORT);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) {
        return;
      }
      setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // "重置布局" re-runs the physics; the zoom level belongs with it, otherwise the
  // graph re-settles somewhere off screen.
  useEffect(() => {
    setViewport(IDENTITY_VIEWPORT);
  }, [runId]);

  const { positions, rings: layoutRings, moveNode, beginDrag, endDrag } =
    useGraphLayout({
      nodes,
      edges,
      mode,
      width: size.width,
      height: size.height,
      runId,
    });

  const radiusById = useMemo(() => {
    const maxDegree = maxDegreeOf(nodes);
    const map = new Map<string, number>();
    nodes.forEach((node) => {
      map.set(node.id, nodeRadius(node.degree ?? 0, maxDegree));
    });
    return map;
  }, [nodes]);

  const dimming = highlight.nodes.size > 0 || highlight.edges.size > 0;
  const showAllEdgeLabels = edges.length <= EDGE_LABEL_BUDGET;

  const toCanvasPoint = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) {
        return undefined;
      }
      const scaleX = rect.width === 0 ? 1 : size.width / rect.width;
      const scaleY = rect.height === 0 ? 1 : size.height / rect.height;
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
      };
    },
    [size.width, size.height],
  );

  // React binds wheel handlers as passive, so preventDefault inside onWheel is
  // ignored and the page scrolls instead of zooming. A native listener keeps
  // the gesture inside the canvas.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
      const point = toCanvasPoint(event.clientX, event.clientY);
      if (!point) {
        return;
      }
      event.preventDefault();
      const factor = wheelZoomFactor(event.deltaY);
      setViewport((current) => zoomAt(current, point, factor));
    };
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, [toCanvasPoint]);

  const handlePointerMove = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      const id = draggingRef.current;
      if (id) {
        const point = toCanvasPoint(event.clientX, event.clientY);
        if (point) {
          moveNode(id, toLayoutPoint(viewport, point));
        }
        return;
      }
      const pan = panRef.current;
      if (!pan || pan.pointerId !== event.pointerId) {
        return;
      }
      const dx = event.clientX - pan.startX;
      const dy = event.clientY - pan.startY;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        draggedRef.current = true;
      }
      setViewport((current) => ({
        ...current,
        x: pan.originX + dx,
        y: pan.originY + dy,
      }));
    },
    [moveNode, toCanvasPoint, viewport],
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      if (event.button !== 0) {
        return;
      }
      draggedRef.current = false;
      panRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: viewport.x,
        originY: viewport.y,
      };
      // Capture on the svg so a fast pan keeps tracking outside the canvas.
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [viewport.x, viewport.y],
  );

  const stopGestures = useCallback(() => {
    if (draggingRef.current) {
      endDrag(draggingRef.current);
      draggingRef.current = null;
    }
    panRef.current = null;
  }, [endDrag]);

  const handleClick = useCallback(() => {
    // A pan ends with a click event; that must not clear the selection.
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    onSelect(undefined);
  }, [onSelect]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
    >
      <svg
        ref={svgRef}
        width={size.width}
        height={size.height}
        viewBox={`0 0 ${size.width} ${size.height}`}
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopGestures}
        onPointerCancel={stopGestures}
        onClick={handleClick}
      >
        <defs>
          <marker
            id="kg-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
          </marker>
        </defs>

        <g
          transform={`translate(${viewport.x}, ${viewport.y}) scale(${viewport.k})`}
        >
          {mode === 'radial' &&
            layoutRings.map((ring) => (
              <circle
                key={`ring-${ring.radius}`}
                cx={size.width / 2}
                cy={size.height / 2}
                r={ring.radius}
                fill="none"
                stroke="currentColor"
                strokeDasharray="4 6"
                className="text-border-default"
              />
            ))}

          {edges.map((edge) => {
            const from = positions[edge.source];
            const to = positions[edge.target];
            if (!from || !to) {
              return null;
            }
            const fromRadius = radiusById.get(edge.source) ?? 7;
            const toRadius = radiusById.get(edge.target) ?? 7;
            const points = edgeEndpoints(from, to, fromRadius, toRadius);
            const selected =
              selection?.kind === 'edge' && selection.id === edge.id;
            const hit = highlight.edges.has(edge.id);
            const dimmed = dimming && !hit;
            const hovered =
              !!hoveredId &&
              (edge.source === hoveredId || edge.target === hoveredId);
            const showLabel = selected || hit || hovered || showAllEdgeLabels;
            return (
              <g
                key={edge.id}
                opacity={dimmed ? DIM_OPACITY : 1}
                className="cursor-pointer"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect({ kind: 'edge', id: edge.id });
                }}
              >
                <line
                  x1={points.x1}
                  y1={points.y1}
                  x2={points.x2}
                  y2={points.y2}
                  stroke={selected || hit || hovered ? '#475569' : '#94a3b8'}
                  strokeWidth={selected ? 2.2 : hit || hovered ? 1.8 : 1.2}
                  markerEnd="url(#kg-arrow)"
                />
                {showLabel && (
                  <text
                    x={(points.x1 + points.x2) / 2}
                    y={(points.y1 + points.y2) / 2 - 4}
                    textAnchor="middle"
                    fontSize={9}
                    fill="currentColor"
                    stroke="var(--color-bg-base, #fff)"
                    strokeWidth={3}
                    paintOrder="stroke"
                    className="text-text-secondary pointer-events-none"
                  >
                    {edge.type_label}
                  </text>
                )}
              </g>
            );
          })}

          {nodes.map((node) => {
            const position = positions[node.id];
            if (!position) {
              return null;
            }
            const radius = radiusById.get(node.id) ?? 7;
            const selected =
              selection?.kind === 'node' && selection.id === node.id;
            const hit = highlight.nodes.has(node.id);
            const dimmed = dimming && !hit;
            const hovered = hoveredId === node.id;
            return (
              <g
                key={node.id}
                opacity={dimmed ? DIM_OPACITY : 1}
                transform={`translate(${position.x}, ${position.y})`}
                className="cursor-pointer"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect({ kind: 'node', id: node.id });
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0) {
                    return;
                  }
                  // The node owns the gesture: no pan starts behind it.
                  event.stopPropagation();
                  draggedRef.current = true;
                  draggingRef.current = node.id;
                  beginDrag(node.id);
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerEnter={() => setHoveredId(node.id)}
                onPointerLeave={() =>
                  setHoveredId((current) =>
                    current === node.id ? null : current,
                  )
                }
              >
                {hovered && (
                  <circle
                    r={radius + 6}
                    fill={node.color || '#9a998f'}
                    opacity={0.18}
                  />
                )}
                <circle
                  r={hovered ? radius + 1.5 : radius}
                  fill={node.color || '#9a998f'}
                  stroke={selected || hit ? '#0f172a' : '#ffffff'}
                  strokeWidth={selected ? 2.6 : 1.6}
                />
                <text
                  y={1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={radius > 11 ? 10 : 8}
                  className="pointer-events-none"
                  fill="#ffffff"
                >
                  {node.icon}
                </text>
                <text
                  y={radius + 12}
                  textAnchor="middle"
                  fontSize={11}
                  stroke="var(--color-bg-base, #fff)"
                  strokeWidth={3}
                  paintOrder="stroke"
                  fill="currentColor"
                  className="text-text-primary pointer-events-none"
                >
                  {node.name.length > 14
                    ? `${node.name.slice(0, 14)}…`
                    : node.name}
                </text>
                <title>{`${node.name} · ${node.type_label}`}</title>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
};

export default GraphCanvas;
