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

import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog';
import { Button } from '@/components/ui/button';
import { useFetchKnowledgeGraph } from '@/hooks/use-knowledge-request';
import { cn } from '@/lib/utils';
import { useDebounce } from 'ahooks';
import { CircleDot, RotateCcw, Share2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import DetailPanel from './detail-panel';
import GraphCanvas from './graph-canvas';
import { LayoutMode, Selection, filterGraph, highlightIds } from './layout';
import SearchBox, { SearchMode } from './search-box';
import SidePanel from './side-panel';

/**
 * 知识图谱的完整视图：检索、类型筛选、画布、证据面板。
 *
 * 单独抽出来是因为库内有两处入口都展示同一张图：侧栏「知识图谱」整页，
 * 以及 Artifacts 的 Graph 视图。两处共用一份读接口（/datasets/:id/graph）
 * 和一份渲染，避免同一条数据出现两套长相。
 */
export function KnowledgeGraphView({
  onDelete,
  className,
}: {
  /** 传入时在工具条右侧显示删除入口；Artifacts 内嵌时不传。 */
  onDelete?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();

  const [query, setQuery] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('auto');
  const debouncedQuery = useDebounce(query, { wait: 300 });
  const { data, loading } = useFetchKnowledgeGraph({
    keywords: debouncedQuery.trim(),
    mode: searchMode,
  });

  const [layoutMode, setLayoutMode] = useState<LayoutMode>('force');
  const [layoutRunId, setLayoutRunId] = useState(0);
  const [selection, setSelection] = useState<Selection | undefined>();
  const [hiddenEntityTypes, setHiddenEntityTypes] = useState<Set<string>>(
    () => new Set(),
  );
  const [hiddenRelationTypes, setHiddenRelationTypes] = useState<Set<string>>(
    () => new Set(),
  );

  const graphNodes = useMemo(() => data?.graph.nodes ?? [], [data]);
  const graphEdges = useMemo(() => data?.graph.edges ?? [], [data]);

  const visible = useMemo(
    () =>
      filterGraph(
        graphNodes,
        graphEdges,
        hiddenEntityTypes,
        hiddenRelationTypes,
      ),
    [graphNodes, graphEdges, hiddenEntityTypes, hiddenRelationTypes],
  );

  const nodesById = useMemo(() => {
    const map = new Map<string, (typeof graphNodes)[number]>();
    graphNodes.forEach((node) => map.set(node.id, node));
    return map;
  }, [graphNodes]);

  const selectedNode =
    selection?.kind === 'node' ? nodesById.get(selection.id) : undefined;
  const selectedEdge =
    selection?.kind === 'edge'
      ? graphEdges.find((edge) => edge.id === selection.id)
      : undefined;

  // A selection that the latest response no longer contains (recompiled graph,
  // different dataset) must not keep the detail panel pointing at nothing.
  useEffect(() => {
    if (!selection) {
      return;
    }
    const exists =
      selection.kind === 'node'
        ? nodesById.has(selection.id)
        : graphEdges.some((edge) => edge.id === selection.id);
    if (!exists) {
      setSelection(undefined);
    }
  }, [graphEdges, nodesById, selection]);

  const highlight = useMemo(
    () =>
      highlightIds(
        visible.edges,
        data?.search?.matched_node_ids ?? [],
        data?.search?.matched_edge_ids ?? [],
        selection,
      ),
    [data?.search, selection, visible.edges],
  );

  const toggleEntityType = useCallback((type: string) => {
    setHiddenEntityTypes((previous) => {
      const next = new Set(previous);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  const toggleRelationType = useCallback((type: string) => {
    setHiddenRelationTypes((previous) => {
      const next = new Set(previous);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  const showAllTypes = useCallback(() => {
    setHiddenEntityTypes(new Set());
    setHiddenRelationTypes(new Set());
  }, []);

  const isEmpty = !!data && data.stats.entities === 0;
  const domainLabel = data?.stats.domain
    ? t(`knowledgeGraph.domains.${data.stats.domain}`)
    : undefined;

  return (
    <section
      className={cn('flex h-full min-h-0 min-w-0 flex-col', className)}
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-border-default px-5 py-3">
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold text-text-primary">
              {t('knowledgeGraph.title')}
            </h1>
            {domainLabel && (
              <span className="rounded-full bg-bg-component px-2 py-0.5 text-[11px] text-text-secondary">
                {domainLabel}
              </span>
            )}
          </div>
          {data && (
            <p className="text-[11px] text-text-secondary">
              {t('knowledgeGraph.summary', {
                entities: data.stats.entities,
                relations: data.stats.relations,
                evidence: data.stats.with_evidence,
              })}
            </p>
          )}
        </div>

        <div className="ms-auto flex flex-1 items-center justify-end gap-2">
          <SearchBox
            value={query}
            mode={searchMode}
            search={data?.search}
            relationTypes={data?.relation_types ?? []}
            nodesById={nodesById}
            edges={visible.edges}
            onValueChange={setQuery}
            onModeChange={setSearchMode}
            onSelect={setSelection}
          />

          <div className="flex items-center rounded-md border border-border-default">
            <button
              type="button"
              onClick={() => setLayoutMode('force')}
              className={cn(
                'flex items-center gap-1 px-2 py-1.5 text-xs',
                layoutMode === 'force'
                  ? 'bg-bg-component text-text-primary'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              <Share2 className="size-3.5" />
              {t('knowledgeGraph.layout.force')}
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode('radial')}
              className={cn(
                'flex items-center gap-1 border-l border-border-default px-2 py-1.5 text-xs',
                layoutMode === 'radial'
                  ? 'bg-bg-component text-text-primary'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              <CircleDot className="size-3.5" />
              {t('knowledgeGraph.layout.radial')}
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setLayoutRunId((id) => id + 1)}
          >
            <RotateCcw />
            {t('knowledgeGraph.layout.reset')}
          </Button>

          {onDelete && (
            <ConfirmDeleteDialog onOk={onDelete}>
              <Button variant="outline" size="sm">
                <Trash2 />
                {t('common.delete')}
              </Button>
            </ConfirmDeleteDialog>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <SidePanel
          entityTypes={data?.entity_types ?? []}
          relationTypes={data?.relation_types ?? []}
          stats={
            data?.stats ?? {
              entities: 0,
              relations: 0,
              with_evidence: 0,
              unnormalized_relations: 0,
              returned_entities: 0,
              returned_relations: 0,
              truncated: false,
              domain: '',
            }
          }
          hiddenEntityTypes={hiddenEntityTypes}
          hiddenRelationTypes={hiddenRelationTypes}
          visibleEntities={visible.nodes.length}
          visibleRelations={visible.edges.length}
          onToggleEntityType={toggleEntityType}
          onToggleRelationType={toggleRelationType}
          onShowAll={showAllTypes}
        />

        <div className="relative min-w-0 flex-1 bg-bg-canvas">
          {loading && !data && (
            <div className="flex h-full items-center justify-center text-sm text-text-secondary">
              {t('knowledgeGraph.loading')}
            </div>
          )}

          {isEmpty && (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
              <p className="text-sm font-medium text-text-primary">
                {t('knowledgeGraph.empty.title')}
              </p>
              <p className="max-w-md text-xs leading-relaxed text-text-secondary">
                {t('knowledgeGraph.empty.hint')}
              </p>
            </div>
          )}

          {!isEmpty && data && (
            <GraphCanvas
              nodes={visible.nodes}
              edges={visible.edges}
              mode={layoutMode}
              selection={selection}
              highlight={highlight}
              runId={layoutRunId}
              onSelect={setSelection}
            />
          )}

          {!isEmpty && !data && !loading && (
            <div className="flex h-full items-center justify-center text-sm text-text-secondary">
              {t('knowledgeGraph.loading')}
            </div>
          )}

          {data && data.stats.truncated && (
            <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-bg-card px-3 py-1 text-[11px] text-text-secondary shadow">
              {t('knowledgeGraph.truncated', {
                entities: data.stats.returned_entities,
                relations: data.stats.returned_relations,
              })}
            </div>
          )}
        </div>

        {selection && (
          <DetailPanel
            selection={selection}
            node={selectedNode}
            edge={selectedEdge}
            nodesById={nodesById}
            edges={visible.edges}
            onSelect={setSelection}
          />
        )}
      </div>
    </section>
  );
}

export default KnowledgeGraphView;
