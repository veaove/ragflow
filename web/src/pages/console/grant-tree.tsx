import {
  LucideBookOpen,
  LucideChevronRight,
  LucideFileText,
  LucideFolder,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { GrantNodeSummary, GrantTreeNode } from '@/services/console-service';

/**
 * 摘要色调只在这里映射成样式。
 *
 * 橙只留给「例外」：需要人处理的是例外，正常继承和「仅所有者」都不该抢视觉。
 */
const TONE_CLASS: Record<GrantNodeSummary['tone'], string> = {
  owner: 'bg-background-second text-text-secondary',
  visible: 'bg-state-success/10 text-state-success',
  exception: 'bg-state-warning/10 text-state-warning',
  inherit: 'bg-background-second text-text-secondary',
};

export function GrantSummaryBadge({
  summary,
}: {
  summary: GrantNodeSummary;
}) {
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] leading-4 ${
        TONE_CLASS[summary.tone] ?? TONE_CLASS.inherit
      }`}
      title={summary.label}
    >
      {summary.label}
    </span>
  );
}

function NodeIcon({ nodeKind }: { nodeKind: string }) {
  const className = 'size-3.5 shrink-0';
  if (nodeKind === 'dataset') {
    return <LucideBookOpen className={`${className} text-text-secondary`} />;
  }
  if (nodeKind === 'folder') {
    return <LucideFolder className={`${className} text-state-warning`} />;
  }
  return <LucideFileText className={`${className} text-text-secondary`} />;
}

interface TreeRowProps {
  node: GrantTreeNode;
  depth: number;
  selectedId: string;
  expanded: Set<string>;
  onSelect: (node: GrantTreeNode) => void;
  onToggle: (id: string) => void;
}

function TreeRow({
  node,
  depth,
  selectedId,
  expanded,
  onSelect,
  onToggle,
}: TreeRowProps) {
  const hasChildren = !!node.children?.length;
  const isOpen = expanded.has(node.id);
  const isSelected = selectedId === node.id;

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggle(node.id);
    },
    [node.id, onToggle],
  );
  // 选中时顺带展开：折叠状态下点一行，除了右侧换内容，左侧也该露出里面，
  // 否则「点了一下」在树上看不出任何变化。
  const handleSelect = useCallback(() => {
    onSelect(node);
    if (hasChildren && !isOpen) onToggle(node.id);
  }, [hasChildren, isOpen, node, onSelect, onToggle]);

  return (
    <li>
      <button
        type="button"
        onClick={handleSelect}
        aria-current={isSelected ? 'true' : undefined}
        className={`group relative flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm transition-colors duration-150 ${
          isSelected
            ? 'bg-accent-primary/10 font-medium text-accent-primary ring-1 ring-inset ring-accent-primary/25'
            : 'text-text-primary hover:bg-background-second'
        }`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {/* 选中态在最左侧加一条竖线：只有背景色时，浅色主题下几乎看不出来。 */}
        {isSelected && (
          <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent-primary" />
        )}
        {hasChildren ? (
          <span
            role="presentation"
            onClick={handleToggle}
            className="flex size-4 shrink-0 items-center justify-center rounded hover:bg-bg-base"
          >
            <LucideChevronRight
              className={`size-3.5 text-text-secondary transition-transform ${
                isOpen ? 'rotate-90' : ''
              }`}
            />
          </span>
        ) : (
          <span className="size-4 shrink-0" />
        )}
        <NodeIcon nodeKind={node.node_kind} />
        <span className="min-w-0 flex-1 truncate" title={node.name}>
          {node.name}
        </span>
        {node.file_count > 0 && (
          <span className="shrink-0 text-[11px] text-text-secondary">
            {node.file_count}
          </span>
        )}
        <GrantSummaryBadge summary={node.summary} />
      </button>
      {hasChildren && isOpen && (
        <ul>
          {node.children?.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              expanded={expanded}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

interface GrantTreeProps {
  nodes: GrantTreeNode[];
  selectedId: string;
  onSelect: (node: GrantTreeNode) => void;
  emptyText: string;
}

/**
 * 授权树。
 *
 * 折叠状态只放本地：默认只展开根节点（库 / 顶层目录），文件夹要自己点开。
 * 文件不进树，避免一个库几十个文件把左侧挤成一列滚动条。
 */
export function GrantTree({
  nodes,
  selectedId,
  onSelect,
  emptyText,
}: GrantTreeProps) {
  const defaultExpanded = useMemo(
    () => new Set(nodes.map((node) => node.id)),
    [nodes],
  );

  const [expanded, setExpanded] = useState<Set<string>>(defaultExpanded);

  // 搜索会换掉整棵树，折叠状态跟着重置，否则会停留在已消失的节点上。
  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [defaultExpanded]);

  const handleToggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  if (!nodes.length) {
    return (
      <p className="px-3 py-6 text-center text-xs text-text-secondary">
        {emptyText}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {nodes.map((node) => (
        <TreeRow
          key={node.id}
          node={node}
          depth={0}
          selectedId={selectedId}
          expanded={expanded}
          onSelect={onSelect}
          onToggle={handleToggle}
        />
      ))}
    </ul>
  );
}

/**
 * 按 id 找节点，子节点也要找。
 *
 * 只用根节点匹配会让「点文件夹」落回第一个知识库：右栏看起来毫无反应，用户
 * 分不清是没点上还是没生效。
 */
export function findGrantNode(
  nodes: GrantTreeNode[],
  id: string,
): GrantTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children?.length) {
      const hit = findGrantNode(node.children, id);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** 从根到目标节点的路径，面板用它解释「这是谁的子项」。 */
export function findGrantNodePath(
  nodes: GrantTreeNode[],
  id: string,
): GrantTreeNode[] {
  for (const node of nodes) {
    if (node.id === id) return [node];
    if (node.children?.length) {
      const trail = findGrantNodePath(node.children, id);
      if (trail.length) return [node, ...trail];
    }
  }
  return [];
}
