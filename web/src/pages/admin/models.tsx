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

import { useQuery } from '@tanstack/react-query';
import { LucideRefreshCw, LucideSearch } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RAGFlowPagination } from '@/components/ui/ragflow-pagination';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  listPlatformModels,
  type ModelReference,
  type PlatformModelItem,
} from '@/services/admin-service';

/** 模型类型 → i18n key。后端只给 chat/embedding 这类英文枚举。 */
const MODEL_TYPE_KEYS: Record<string, string> = {
  chat: 'chat',
  embedding: 'embedding',
  asr: 'asr',
  vision: 'vision',
  rerank: 'rerank',
  tts: 'tts',
  ocr: 'ocr',
  doc_parse: 'docParse',
  unknown: 'unknown',
};

/** 表格里最多平铺几个租户，超过折成 +N，避免把行高撑成一片。 */
const MAX_INLINE_TENANTS = 3;

function formatTokens(value?: number | null) {
  if (value === null || value === undefined || value <= 0) return '-';
  return value.toLocaleString();
}

/**
 * 平台模型配置。
 *
 * 数据分两块：
 * 1. 平台模型目录 —— 随二进制发版的 conf/models（76 个厂商 / 900+ 模型），
 *    这是「平台上有哪些模型」的权威口径。目录不落库，所以筛选和分页在
 *    服务端做，前端只传条件。
 * 2. 租户引用 —— tenant_model（现行）+ tenant_llm（历史表）里「哪个租户在
 *    用哪个模型、走哪个接入实例」的事实。
 *
 * 刻意不把 llm 表当目录：它只记录「平台登记过的模型」，现网为空，拿它做
 * 列表会得到空页面。反过来，租户自建 provider 能加目录外的模型名，所以
 * 列表里会补这类条目并打「目录外」标记。
 */
export default function AdminModels() {
  const { t } = useTranslation();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [modelType, setModelType] = useState('');
  const [factory, setFactory] = useState('');
  const [referencedOnly, setReferencedOnly] = useState(false);

  const { data, isFetching, refetch } = useQuery({
    queryKey: [
      'admin/models',
      page,
      pageSize,
      keyword,
      modelType,
      factory,
      referencedOnly,
    ],
    queryFn: async () => {
      const { data } = await listPlatformModels({
        page,
        page_size: pageSize,
        keyword: keyword.trim() || undefined,
        model_type: modelType || undefined,
        factory: factory || undefined,
        referenced: referencedOnly ? '1' : undefined,
      });
      return data?.data;
    },
  });

  const rows = useMemo(() => data?.list ?? [], [data?.list]);
  const summary = data?.summary;

  /** 任何一个筛选条件变化都要回到第 1 页，否则会停在越界页看到空列表。 */
  const resetTo = useCallback((apply: () => void) => {
    apply();
    setPage(1);
  }, []);

  const typeLabel = useCallback(
    (value: string) => {
      const key = MODEL_TYPE_KEYS[value];
      return key
        ? t(`admin.modelManagementPage.modelType.${key}`)
        : value || '-';
    },
    [t],
  );

  const renderTenants = (row: PlatformModelItem) => {
    if (row.references.length === 0) {
      return (
        <span className="text-text-disabled">
          {t('admin.modelManagementPage.noReference')}
        </span>
      );
    }
    const shown = row.references.slice(0, MAX_INLINE_TENANTS);
    const rest = row.references.length - shown.length;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {shown.map((ref: ModelReference) => (
          <Badge
            key={`${ref.tenant_id}-${ref.source}-${ref.instance_name}-${ref.model_type}`}
            variant="secondary"
            className="max-w-[220px] truncate"
            title={[
              ref.tenant_name,
              ref.provider_name,
              ref.instance_name,
              ref.model_type,
              ref.source === 'tenant_llm'
                ? t('admin.modelManagementPage.sourceLegacy')
                : t('admin.modelManagementPage.sourceCurrent'),
            ]
              .filter(Boolean)
              .join(' · ')}
          >
            {ref.tenant_name}
            {ref.model_type ? ` · ${typeLabel(ref.model_type)}` : ''}
          </Badge>
        ))}
        {rest > 0 && (
          <span
            className="text-xs text-text-secondary"
            title={row.references
              .slice(MAX_INLINE_TENANTS)
              .map((ref) => ref.tenant_name)
              .join('、')}
          >
            +{rest}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="size-full min-w-0 overflow-auto px-5 py-4">
      <header className="mb-4 flex flex-col gap-1">
        <h1 className="text-2xl font-medium text-text-primary">
          {t('admin.modelManagement')}
        </h1>
        <p className="text-sm text-text-secondary">
          {t('admin.modelManagementPage.description')}
        </p>
      </header>

      {/* 平台全量统计：不随筛选变化，避免用户误以为「筛完只剩 2 个模型」 */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            label: t('admin.modelManagementPage.summaryModels'),
            value: summary?.model_total ?? 0,
            hint: t('admin.modelManagementPage.summaryModelsHint'),
          },
          {
            label: t('admin.modelManagementPage.summaryReferenced'),
            value: summary?.referenced_model_total ?? 0,
            hint: t('admin.modelManagementPage.summaryReferencedHint'),
          },
          {
            label: t('admin.modelManagementPage.summaryTenants'),
            value: summary?.tenant_with_model_total ?? 0,
            hint: t('admin.modelManagementPage.summaryTenantsHint', {
              n: summary?.tenant_total ?? 0,
            }),
          },
          {
            label: t('admin.modelManagementPage.summaryFactories'),
            value: summary?.factory_total ?? 0,
            hint: t('admin.modelManagementPage.summaryFactoriesHint'),
          },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-lg border border-border-light bg-bg-base px-4 py-3"
          >
            <div className="text-xs text-text-secondary">{card.label}</div>
            <div className="mt-1 text-2xl font-medium text-text-primary">
              {card.value}
            </div>
            <div className="mt-1 truncate text-xs text-text-disabled">
              {card.hint}
            </div>
          </div>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative w-[260px]">
          <LucideSearch className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-disabled" />
          <Input
            value={keyword}
            onChange={(e) => {
              const value = e.target.value;
              resetTo(() => setKeyword(value));
            }}
            placeholder={t('admin.modelManagementPage.searchPlaceholder')}
            className="pl-9"
          />
        </div>

        <select
          value={modelType}
          onChange={(e) => {
            const value = e.target.value;
            resetTo(() => setModelType(value));
          }}
          className="h-9 rounded-md border border-border-default bg-bg-base px-3 text-sm text-text-primary outline-none"
          aria-label={t('admin.modelManagementPage.colTypes')}
        >
          <option value="">
            {t('admin.modelManagementPage.allTypes')}
          </option>
          {(data?.model_types ?? []).map((item) => (
            <option key={item.value} value={item.value}>
              {typeLabel(item.value)} ({item.count})
            </option>
          ))}
        </select>

        <select
          value={factory}
          onChange={(e) => {
            const value = e.target.value;
            resetTo(() => setFactory(value));
          }}
          className="h-9 max-w-[260px] rounded-md border border-border-default bg-bg-base px-3 text-sm text-text-primary outline-none"
          aria-label={t('admin.modelManagementPage.colFactory')}
        >
          <option value="">
            {t('admin.modelManagementPage.allFactories')}
          </option>
          {(data?.factories ?? []).map((item) => (
            <option key={item.name} value={item.name}>
              {item.name} ({item.model_count})
            </option>
          ))}
        </select>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
          <Switch
            checked={referencedOnly}
            onCheckedChange={(checked) =>
              resetTo(() => setReferencedOnly(checked))
            }
          />
          {t('admin.modelManagementPage.referencedOnly')}
        </label>

        <div className="flex-1" aria-hidden />

        <Button variant="outline" onClick={() => refetch()}>
          <LucideRefreshCw className="mr-1 size-4" />
          {t('admin.refresh')}
        </Button>
      </div>

      <Table rootClassName="max-h-[calc(100vh-360px)]">
        <TableHeader>
          <TableRow>
            <TableHead>{t('admin.modelManagementPage.colModel')}</TableHead>
            <TableHead className="w-[1%] whitespace-nowrap">
              {t('admin.modelManagementPage.colFactory')}
            </TableHead>
            <TableHead className="w-[1%] whitespace-nowrap">
              {t('admin.modelManagementPage.colTypes')}
            </TableHead>
            <TableHead className="w-[1%] whitespace-nowrap">
              {t('admin.modelManagementPage.colContext')}
            </TableHead>
            <TableHead className="w-[1%] whitespace-nowrap">
              {t('admin.modelManagementPage.colRefCount')}
            </TableHead>
            <TableHead>{t('admin.modelManagementPage.colTenants')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={6}
                className="py-10 text-center text-sm text-text-secondary"
              >
                {isFetching
                  ? t('admin.modelManagementPage.loading')
                  : t('admin.modelManagementPage.empty')}
              </TableCell>
            </TableRow>
          )}
          {rows.map((row) => (
            <TableRow key={`${row.llm_factory}::${row.llm_name}`}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-text-primary">
                    {row.llm_name}
                  </span>
                  {!row.in_catalog && (
                    <Badge
                      variant="secondary"
                      title={t('admin.modelManagementPage.notInCatalogHint')}
                    >
                      {t('admin.modelManagementPage.notInCatalog')}
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="whitespace-nowrap text-text-secondary">
                {row.llm_factory || '-'}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {(row.model_types.length > 0
                    ? row.model_types
                    : ['unknown']
                  ).map((mt) => (
                    <Badge key={mt} variant="secondary">
                      {typeLabel(mt)}
                    </Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell className="whitespace-nowrap text-text-secondary">
                {formatTokens(row.context_length)}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {row.reference_count > 0 ? (
                  <span className="text-text-primary">
                    {t('admin.modelManagementPage.tenantCount', {
                      n: row.tenant_count,
                    })}
                  </span>
                ) : (
                  <span className="text-text-disabled">0</span>
                )}
              </TableCell>
              <TableCell>{renderTenants(row)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex items-center justify-end pt-3">
        <RAGFlowPagination
          total={data?.total ?? 0}
          current={page}
          pageSize={pageSize}
          onChange={(nextPage, nextPageSize) => {
            setPage(nextPage);
            setPageSize(nextPageSize);
          }}
        />
      </div>
    </div>
  );
}
