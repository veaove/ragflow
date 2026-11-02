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
  IKGGraphStats,
  IKGGraphType,
} from '@/interfaces/database/knowledge-graph';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

interface SidePanelProps {
  entityTypes: IKGGraphType[];
  relationTypes: IKGGraphType[];
  stats: IKGGraphStats;
  hiddenEntityTypes: Set<string>;
  hiddenRelationTypes: Set<string>;
  visibleEntities: number;
  visibleRelations: number;
  onToggleEntityType: (type: string) => void;
  onToggleRelationType: (type: string) => void;
  onShowAll: () => void;
}

const SidePanel = ({
  entityTypes,
  relationTypes,
  stats,
  hiddenEntityTypes,
  hiddenRelationTypes,
  visibleEntities,
  visibleRelations,
  onToggleEntityType,
  onToggleRelationType,
  onShowAll,
}: SidePanelProps) => {
  const { t } = useTranslation();

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border-default bg-bg-card">
      <div className="flex items-center justify-between border-b border-border-default px-4 py-3">
        <span className="text-sm font-medium text-text-primary">
          {t('knowledgeGraph.filters')}
        </span>
        <button
          type="button"
          className="text-xs text-text-secondary hover:text-text-primary"
          onClick={onShowAll}
        >
          {t('knowledgeGraph.selectAll')}
        </button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-4 py-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-text-secondary">
            {t('knowledgeGraph.entityTypes')}
          </div>
          <ul className="flex flex-col gap-1">
            {entityTypes.map((item) => {
              const hidden = hiddenEntityTypes.has(item.type);
              return (
                <li key={item.type}>
                  <button
                    type="button"
                    onClick={() => onToggleEntityType(item.type)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-opacity',
                      'hover:bg-bg-component',
                      hidden && 'opacity-40',
                    )}
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: item.color ?? '#9a998f' }}
                    />
                    <span className="min-w-0 flex-1 truncate text-text-primary">
                      {item.icon} {item.label}
                    </span>
                    <span className="text-xs tabular-nums text-text-secondary">
                      {item.count}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-5 mb-2 text-xs font-medium uppercase tracking-wide text-text-secondary">
            {t('knowledgeGraph.relationTypes')}
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {relationTypes.map((item) => {
              const hidden = hiddenRelationTypes.has(item.type);
              return (
                <li key={item.type}>
                  <button
                    type="button"
                    onClick={() => onToggleRelationType(item.type)}
                    className={cn(
                      'flex items-center gap-1 rounded-full border border-border-default px-2 py-0.5 text-xs',
                      'hover:border-border-accent',
                      hidden
                        ? 'opacity-40 line-through'
                        : 'bg-bg-base text-text-primary',
                    )}
                  >
                    <span>{item.label}</span>
                    <span className="tabular-nums text-text-secondary">
                      {item.count}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </ScrollArea>

      <dl className="grid grid-cols-2 gap-2 border-t border-border-default px-4 py-3 text-xs">
        <div>
          <dt className="text-text-secondary">
            {t('knowledgeGraph.stats.entities')}
          </dt>
          <dd className="text-base font-semibold tabular-nums text-text-primary">
            {stats.entities}
          </dd>
        </div>
        <div>
          <dt className="text-text-secondary">
            {t('knowledgeGraph.stats.relations')}
          </dt>
          <dd className="text-base font-semibold tabular-nums text-text-primary">
            {stats.relations}
          </dd>
        </div>
        <div>
          <dt className="text-text-secondary">
            {t('knowledgeGraph.stats.evidence')}
          </dt>
          <dd className="text-base font-semibold tabular-nums text-text-primary">
            {stats.with_evidence}
          </dd>
        </div>
        <div>
          <dt className="text-text-secondary">
            {t('knowledgeGraph.stats.showing')}
          </dt>
          <dd className="text-base font-semibold tabular-nums text-text-primary">
            {visibleEntities}/{visibleRelations}
          </dd>
        </div>
        {stats.unnormalized_relations > 0 && (
          <p className="col-span-2 text-[11px] leading-relaxed text-text-secondary">
            {t('knowledgeGraph.unnormalized', {
              count: stats.unnormalized_relations,
            })}
          </p>
        )}
        {stats.truncated && (
          <p className="col-span-2 rounded-md bg-state-warning-5 px-2 py-1.5 text-[11px] leading-relaxed text-state-warning">
            {t('knowledgeGraph.truncated', {
              entities: stats.returned_entities,
              relations: stats.returned_relations,
            })}
          </p>
        )}
      </dl>
    </aside>
  );
};

export default SidePanel;
