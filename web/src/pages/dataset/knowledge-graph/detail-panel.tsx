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

import { ScrollArea } from '@/components/ui/scroll-area';
import {
  IKGEvidence,
  IKGGraphEdge,
  IKGGraphNode,
} from '@/interfaces/database/knowledge-graph';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Selection, confidenceLabel } from './layout';

interface DetailPanelProps {
  selection?: Selection;
  node?: IKGGraphNode;
  edge?: IKGGraphEdge;
  nodesById: Map<string, IKGGraphNode>;
  edges: IKGGraphEdge[];
  onSelect: (selection?: Selection) => void;
}

const EvidenceList = ({
  evidence,
  emptyLabel,
}: {
  evidence?: IKGEvidence[];
  emptyLabel: string;
}) => {
  const { t } = useTranslation();
  if (!evidence || evidence.length === 0) {
    return <p className="text-xs text-text-secondary">{emptyLabel}</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {evidence.map((item) => (
        <li
          key={`${item.chunk_id ?? item.doc_id}-${item.page ?? 0}`}
          className="rounded-md border border-border-default bg-bg-base px-2 py-1.5"
        >
          <div className="flex items-center gap-1 text-xs text-text-primary">
            <span className="min-w-0 flex-1 truncate">
              {item.doc_name || item.doc_id}
            </span>
            {typeof item.page === 'number' && item.page > 0 && (
              <span className="shrink-0 text-text-secondary">
                {t('knowledgeGraph.detail.page', { page: item.page })}
              </span>
            )}
          </div>
          {item.snippet && (
            <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-text-secondary">
              {item.snippet}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
};

const DetailPanel = ({
  selection,
  node,
  edge,
  nodesById,
  edges,
  onSelect,
}: DetailPanelProps) => {
  const { t } = useTranslation();

  const relations = useMemo(() => {
    if (!node) {
      return { outgoing: [], incoming: [] };
    }
    return {
      outgoing: edges.filter((item) => item.source === node.id),
      incoming: edges.filter((item) => item.target === node.id),
    };
  }, [edges, node]);

  if (!selection || (!node && !edge)) {
    return (
      <aside className="flex h-full w-80 shrink-0 items-center justify-center border-l border-border-default bg-bg-card p-6 text-center text-sm text-text-secondary">
        {t('knowledgeGraph.detail.empty')}
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-border-default bg-bg-card">
      <div className="flex items-center justify-between border-b border-border-default px-4 py-2.5">
        <span className="text-sm font-medium text-text-primary">
          {node ? t('knowledgeGraph.detail.entity') : t('knowledgeGraph.detail.relation')}
        </span>
        <button
          type="button"
          className="rounded p-1 text-text-secondary hover:bg-bg-component hover:text-text-primary"
          onClick={() => onSelect(undefined)}
          aria-label={t('knowledgeGraph.detail.close')}
        >
          <X className="size-4" />
        </button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 px-4 py-3">
          {node && (
            <>
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: node.color ?? '#9a998f' }}
                  />
                  <span className="rounded-full bg-bg-component px-2 py-0.5 text-[11px] text-text-secondary">
                    {node.icon} {node.type_label}
                  </span>
                </div>
                <h3 className="mt-2 text-base font-semibold break-words text-text-primary">
                  {node.name}
                </h3>
                {node.raw_type && node.raw_type !== node.type_label && (
                  <p className="mt-0.5 text-[11px] text-text-secondary">
                    {t('knowledgeGraph.detail.rawType', { type: node.raw_type })}
                  </p>
                )}
                {node.description && (
                  <p className="mt-2 text-xs leading-relaxed text-text-secondary">
                    {node.description}
                  </p>
                )}
              </div>

              {node.aliases && node.aliases.length > 0 && (
                <section>
                  <h4 className="mb-1 text-xs font-medium text-text-primary">
                    {t('knowledgeGraph.detail.aliases')}
                  </h4>
                  <div className="flex flex-wrap gap-1">
                    {node.aliases.map((alias) => (
                      <span
                        key={alias}
                        className="rounded border border-border-default px-1.5 py-0.5 text-[11px] text-text-secondary"
                      >
                        {alias}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              <section className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md bg-bg-base px-2 py-1.5">
                  <div className="text-text-secondary">
                    {t('knowledgeGraph.detail.degree')}
                  </div>
                  <div className="tabular-nums text-text-primary">
                    {t('knowledgeGraph.detail.degreeValue', {
                      count: node.degree,
                    })}
                  </div>
                </div>
                <div className="rounded-md bg-bg-base px-2 py-1.5">
                  <div className="text-text-secondary">
                    {t('knowledgeGraph.detail.mentions')}
                  </div>
                  <div className="tabular-nums text-text-primary">
                    {t('knowledgeGraph.detail.mentionsValue', {
                      count: node.mention_count,
                    })}
                  </div>
                </div>
              </section>

              <section>
                <h4 className="mb-1 text-xs font-medium text-text-primary">
                  {t('knowledgeGraph.detail.outRelations', {
                    count: relations.outgoing.length,
                  })}
                </h4>
                {relations.outgoing.length === 0 ? (
                  <p className="text-xs text-text-secondary">
                    {t('knowledgeGraph.detail.noRelations')}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {relations.outgoing.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-bg-component"
                          onClick={() => onSelect({ kind: 'edge', id: item.id })}
                        >
                          <span className="text-text-secondary">
                            {item.type_label} →
                          </span>
                          <span className="min-w-0 flex-1 truncate text-text-primary">
                            {nodesById.get(item.target)?.name ?? item.target}
                          </span>
                          <span className="shrink-0 tabular-nums text-text-secondary">
                            {confidenceLabel(item.confidence)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h4 className="mb-1 text-xs font-medium text-text-primary">
                  {t('knowledgeGraph.detail.inRelations', {
                    count: relations.incoming.length,
                  })}
                </h4>
                {relations.incoming.length === 0 ? (
                  <p className="text-xs text-text-secondary">
                    {t('knowledgeGraph.detail.noRelations')}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {relations.incoming.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-bg-component"
                          onClick={() => onSelect({ kind: 'edge', id: item.id })}
                        >
                          <span className="min-w-0 flex-1 truncate text-text-primary">
                            {nodesById.get(item.source)?.name ?? item.source}
                          </span>
                          <span className="text-text-secondary">
                            → {item.type_label}
                          </span>
                          <span className="shrink-0 tabular-nums text-text-secondary">
                            {confidenceLabel(item.confidence)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h4 className="mb-1 text-xs font-medium text-text-primary">
                  {t('knowledgeGraph.detail.evidence')}
                </h4>
                <EvidenceList
                  evidence={node.evidence}
                  emptyLabel={t('knowledgeGraph.detail.noEvidence')}
                />
              </section>
            </>
          )}

          {edge && (
            <>
              <div>
                <span
                  className={cn(
                    'rounded-full bg-bg-component px-2 py-0.5 text-[11px] text-text-secondary',
                  )}
                >
                  {edge.type_label}
                  {!edge.normalized && ` · ${t('knowledgeGraph.detail.unnormalized')}`}
                </span>
                <div className="mt-2 flex flex-col gap-1 text-sm">
                  <button
                    type="button"
                    className="text-left font-medium text-text-primary hover:underline"
                    onClick={() => onSelect({ kind: 'node', id: edge.source })}
                  >
                    {nodesById.get(edge.source)?.name ?? edge.source}
                  </button>
                  <span className="text-xs text-text-secondary">
                    ↓ {edge.type_label}
                  </span>
                  <button
                    type="button"
                    className="text-left font-medium text-text-primary hover:underline"
                    onClick={() => onSelect({ kind: 'node', id: edge.target })}
                  >
                    {nodesById.get(edge.target)?.name ?? edge.target}
                  </button>
                </div>
                {edge.raw_types && edge.raw_types.length > 0 && (
                  <p className="mt-2 text-[11px] text-text-secondary">
                    {t('knowledgeGraph.detail.rawType', {
                      type: edge.raw_types.join(' / '),
                    })}
                  </p>
                )}
                {edge.description && (
                  <p className="mt-2 text-xs leading-relaxed text-text-secondary">
                    {edge.description}
                  </p>
                )}
              </div>

              <section>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-secondary">
                    {t('knowledgeGraph.detail.confidence')}
                  </span>
                  <span className="tabular-nums font-medium text-text-primary">
                    {confidenceLabel(edge.confidence)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-bg-component">
                  <div
                    className="h-full rounded-full bg-accent-primary"
                    style={{
                      width: `${Math.max(
                        2,
                        Math.min(100, Math.round((edge.confidence ?? 0) * 100)),
                      )}%`,
                    }}
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-text-secondary">
                  {t('knowledgeGraph.detail.support', {
                    chunks: edge.support?.chunks ?? 0,
                    docs: edge.support?.docs ?? 0,
                  })}
                </p>
              </section>

              <section>
                <h4 className="mb-1 text-xs font-medium text-text-primary">
                  {t('knowledgeGraph.detail.evidence')}
                </h4>
                <EvidenceList
                  evidence={edge.evidence}
                  emptyLabel={t('knowledgeGraph.detail.noEvidence')}
                />
              </section>
            </>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
};

export default DetailPanel;
