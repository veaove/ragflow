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
  IKGGraphSearch,
  IKGGraphType,
} from '@/interfaces/database/knowledge-graph';
import { cn } from '@/lib/utils';
import { Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Selection } from './layout';

export type SearchMode = 'auto' | 'entity' | 'relation';

interface SearchBoxProps {
  value: string;
  mode: SearchMode;
  search?: IKGGraphSearch;
  relationTypes: IKGGraphType[];
  nodesById: Map<string, IKGGraphNode>;
  edges: IKGGraphEdge[];
  onValueChange: (value: string) => void;
  onModeChange: (mode: SearchMode) => void;
  onSelect: (selection?: Selection) => void;
}

const SEARCH_MODES: SearchMode[] = ['auto', 'entity', 'relation'];
const MATCH_LIMIT = 6;

const SearchBox = ({
  value,
  mode,
  search,
  relationTypes,
  nodesById,
  edges,
  onValueChange,
  onModeChange,
  onSelect,
}: SearchBoxProps) => {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);

  const relationLabel = useMemo(() => {
    const map = new Map<string, string>();
    relationTypes.forEach((item) => map.set(item.type, item.label));
    return map;
  }, [relationTypes]);

  const matchedNodes = useMemo(() => {
    const ids = search?.matched_node_ids ?? [];
    return ids
      .map((id) => nodesById.get(id))
      .filter((node): node is IKGGraphNode => !!node)
      .slice(0, MATCH_LIMIT);
  }, [nodesById, search]);

  const matchedEdges = useMemo(() => {
    const wanted = new Set(search?.matched_edge_ids ?? []);
    if (wanted.size === 0) {
      return [];
    }
    return edges.filter((edge) => wanted.has(edge.id)).slice(0, MATCH_LIMIT);
  }, [edges, search]);

  const intent = search?.intent;
  const open = focused && value.trim().length > 0;
  const hasResult = matchedNodes.length > 0 || matchedEdges.length > 0;

  // Picking a suggestion ends the search interaction: keep the dropdown from
  // covering the detail panel it just opened.
  const select = (next: Selection) => {
    setFocused(false);
    onSelect(next);
  };

  return (
    <div className="relative w-full max-w-xl">
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border border-border-default bg-bg-base px-2.5 py-1.5',
          focused && 'border-border-accent',
        )}
      >
        <Search className="size-4 shrink-0 text-text-secondary" />
        <input
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setFocused(false);
            }
          }}
          placeholder={t('knowledgeGraph.searchPlaceholder')}
          className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-disabled"
        />
        {value && (
          <button
            type="button"
            className="rounded p-0.5 text-text-secondary hover:text-text-primary"
            onClick={() => onValueChange('')}
            aria-label={t('knowledgeGraph.clearSearch')}
          >
            <X className="size-3.5" />
          </button>
        )}
        <div className="flex shrink-0 items-center gap-0.5 border-l border-border-default pl-1.5">
          {SEARCH_MODES.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onModeChange(item)}
              className={cn(
                'rounded px-1.5 py-0.5 text-[11px]',
                mode === item
                  ? 'bg-bg-component font-medium text-text-primary'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              {t(`knowledgeGraph.searchModes.${item}`)}
            </button>
          ))}
        </div>
      </div>

      {open && (
        <div
          className="absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-md border border-border-default bg-bg-card p-1.5 shadow-lg"
          // Keep the input focused while the user clicks a suggestion.
          onMouseDown={(event) => event.preventDefault()}
        >
          {intent && (intent.entity_ids.length > 0 || intent.relation_types.length > 0) && (
            <div className="mb-1 rounded bg-bg-base px-2 py-1.5 text-[11px] leading-relaxed text-text-secondary">
              <span className="text-text-primary">
                {t('knowledgeGraph.intentTitle')}
              </span>{' '}
              {intent.entity_ids.length > 0 && (
                <span>
                  {t('knowledgeGraph.intentEntity', {
                    names: intent.entity_ids
                      .map((id) => nodesById.get(id)?.name ?? id)
                      .join('、'),
                  })}
                </span>
              )}{' '}
              {intent.relation_types.length > 0 && (
                <span>
                  {t('knowledgeGraph.intentRelation', {
                    relations: intent.relation_types
                      .map((type) => relationLabel.get(type) ?? type)
                      .join('、'),
                  })}
                </span>
              )}
            </div>
          )}

          {matchedNodes.length > 0 && (
            <div className="mb-1">
              <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-text-secondary">
                {t('knowledgeGraph.matchedEntities')}
              </div>
              <ul>
                {matchedNodes.map((node) => (
                  <li key={node.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-bg-component"
                      onClick={() => select({ kind: 'node', id: node.id })}
                    >
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: node.color ?? '#9a998f' }}
                      />
                      <span className="min-w-0 flex-1 truncate text-text-primary">
                        {node.name}
                      </span>
                      <span className="shrink-0 text-[11px] text-text-secondary">
                        {node.type_label}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {matchedEdges.length > 0 && (
            <div>
              <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-text-secondary">
                {t('knowledgeGraph.matchedRelations')}
              </div>
              <ul>
                {matchedEdges.map((edge) => (
                  <li key={edge.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs hover:bg-bg-component"
                      onClick={() => select({ kind: 'edge', id: edge.id })}
                    >
                      <span className="min-w-0 flex-1 truncate text-text-primary">
                        {nodesById.get(edge.source)?.name ?? edge.source}
                      </span>
                      <span className="shrink-0 text-text-secondary">
                        {edge.type_label}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-right text-text-primary">
                        {nodesById.get(edge.target)?.name ?? edge.target}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!hasResult && !intent && (
            <p className="px-2 py-3 text-center text-xs text-text-secondary">
              {t('knowledgeGraph.noMatch')}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default SearchBox;
