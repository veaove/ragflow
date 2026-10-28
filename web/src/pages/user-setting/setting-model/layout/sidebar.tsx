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

import { LlmIcon } from '@/components/svg-icon';
import { SearchInput } from '@/components/ui/input';
import {
  LlmKeys,
  useFetchAddedProviders,
  useFetchAvailableProviders,
} from '@/hooks/use-llm-request';
import { cn } from '@/lib/utils';
import { restAPIv1 } from '@/utils/api';
import request from '@/utils/request';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Plus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AddCustomProviderModal from '../add-custom-provider-modal';
import { filterVisibleProviders } from '../domestic-providers';

/**
 * Sidebar selection type for the right pane.
 * - 'default': show the system default models view.
 * - any string: a provider (LLM factory) name; show its instance list.
 */
export type SidebarSelection = 'default' | string;

interface SidebarProps {
  selection: SidebarSelection;
  onSelect: (v: SidebarSelection) => void;
}

/**
 * Left column of the v2 settings page.
 *
 * Layout (top -> bottom):
 *  1. "Default models" entry — highlighted when `selection === 'default'`,
 *     with a chevron on the right.
 *  2. "Available models" section header.
 *  3. Search input — case-insensitive filter over provider names.
 *  4. Scrollable list of available providers — clicking a row highlights
 *     it and triggers `onSelect(providerName)`. Providers that already
 *     have at least one configured instance show a green dot on the
 *     right.
 */
export function Sidebar({ selection, onSelect }: SidebarProps) {
  const { t } = useTranslation();
  const { data: providers } = useFetchAvailableProviders();
  const { data: addedProviders } = useFetchAddedProviders();
  const [search, setSearch] = useState('');
  const [addCustomVisible, setAddCustomVisible] = useState(false);
  const queryClient = useQueryClient();

  // Any provider present in `addedProviders` is treated as "added" and
  // sorted first in the list. We deliberately do NOT fetch each added
  // provider's instance list on mount — instance details are fetched
  // lazily by the right pane only when the user clicks a provider.
  const addedSet = useMemo(() => {
    return new Set(
      addedProviders.filter((p) => p.has_instance).map((p) => p.name),
    );
  }, [addedProviders]);

  // 只要服务商在租户里存在过就保持可见（不管有没有实例）：白名单难免遗漏，
  // 而把一个已有配置的服务商藏起来，它就彻底没法在界面上管理了。
  const configuredNames = useMemo(() => {
    return new Set(addedProviders.map((p) => p.name));
  }, [addedProviders]);

  const filteredProviders = useMemo(() => {
    const q = search.trim().toLowerCase();
    // 只展示国内服务商；已经配置过的即使不在名单里也照常显示。
    const visible = filterVisibleProviders(providers, configuredNames);
    const list = q
      ? visible.filter((p) => p.name.toLowerCase().includes(q))
      : visible;
    // Stable partition: added providers first, then unadded.
    const added = list.filter((p) => addedSet.has(p.name));
    const others = list.filter((p) => !addedSet.has(p.name));
    return [...added, ...others];
  }, [providers, search, addedSet, configuredNames]);

  /**
   * Creates the provider first, then its first instance carrying the endpoint
   * and model list. Two calls because the backend models them as separate
   * resources: a provider may own several instances later.
   */
  const handleCreateCustomProvider = useCallback(
    async ({
      providerName,
      driver,
      baseUrl,
      apiKey,
      models,
    }: {
      providerName: string;
      driver: string;
      baseUrl: string;
      apiKey: string;
      models: { name: string; type: string }[];
    }) => {
      await request.put(`${restAPIv1}/providers`, {
        provider_name: providerName,
        driver,
      });
      await request.post(
        `${restAPIv1}/providers/${encodeURIComponent(providerName)}/instances`,
        {
          instance_name: providerName,
          api_key: apiKey,
          base_url: baseUrl,
          model_info: models.map((m) => ({
            model_name: m.name,
            model_type: [m.type],
          })),
        },
      );
      await queryClient.invalidateQueries({
        queryKey: LlmKeys.availableProviders(),
      });
      await queryClient.invalidateQueries({
        queryKey: LlmKeys.addedProviders(),
      });
      onSelect(providerName);
    },
    [queryClient, onSelect],
  );

  return (
    <div className="flex flex-col gap-3 py-4 text-text-primary h-full min-h-0">
      <button
        type="button"
        className={cn(
          'flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors border border-border-button',
          selection === 'default'
            ? 'bg-bg-input text-text-primary'
            : 'text-text-secondary hover:bg-bg-input hover:text-text-primary',
        )}
        onClick={() => onSelect('default')}
        data-testid="sidebar-default-models"
      >
        <span className="font-medium">{t('setting.systemModelSettings')}</span>
        <ChevronRight className="size-4" />
      </button>

      <div className="text-base font-medium text-text-primary px-1">
        {t('setting.availableModels')}
      </div>

      <SearchInput
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('setting.search')}
        data-testid="sidebar-provider-search"
        className="w-full border-none"
      />

      <div className="flex flex-col gap-1 flex-1 min-h-0 overflow-y-auto scrollbar-auto">
        {filteredProviders.map((provider) => {
          const isActive = selection === provider.name;
          const isAdded = addedSet.has(provider.name);
          return (
            <button
              key={provider.name}
              type="button"
              onClick={() => onSelect(provider.name)}
              data-testid={`sidebar-provider-${provider.name}`}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors',
                isActive
                  ? 'bg-bg-input text-text-primary'
                  : 'text-text-secondary hover:bg-bg-input hover:text-text-primary',
              )}
            >
              <LlmIcon
                name={provider.name}
                width={24}
                height={24}
                imgClass="size-6 text-text-primary"
              />
              <span className="truncate text-sm flex-1">{provider.name}</span>
              {isAdded && (
                <span
                  aria-label="configured"
                  className="size-2 rounded-full bg-state-success shrink-0"
                  data-testid={`sidebar-provider-dot-${provider.name}`}
                />
              )}
            </button>
          );
        })}
        {filteredProviders.length === 0 && (
          <div className="text-xs text-text-secondary px-3 py-2">
            {t('setting.empty')}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border-button pt-2">
        <button
          type="button"
          onClick={() => setAddCustomVisible(true)}
          data-testid="add-custom-provider-btn"
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-input hover:text-text-primary"
        >
          <Plus className="size-4" />
          <span className="truncate">{t('setting.addCustomProvider')}</span>
        </button>
      </div>

      {addCustomVisible && (
        <AddCustomProviderModal
          visible
          hideModal={() => setAddCustomVisible(false)}
          onSubmit={handleCreateCustomProvider}
        />
      )}
    </div>
  );
}

export default Sidebar;
