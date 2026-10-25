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
import {
  LucideCalendarClock,
  LucideFileStack,
  LucideGitBranch,
  LucideListTree,
  LucideNetwork,
  LucideSearch,
  LucideWaypoints,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { RAGFlowPagination } from '@/components/ui/ragflow-pagination';
import request from '@/utils/request';

type ArtifactType = 'wiki' | 'tree' | 'graph' | 'mindmap' | 'timeline';

interface ArtifactItem {
  id: string;
  knowledge_base_id: string;
  name: string;
  type: ArtifactType;
  doc_num: number;
  chunk_num: number;
  task_id: string;
  created_at: number;
  updated_at: number;
}

const TYPE_META: Record<
  ArtifactType,
  { label: string; icon: typeof LucideFileStack; variant: 'secondary' }
> = {
  wiki: { label: 'Wiki', icon: LucideFileStack, variant: 'secondary' },
  tree: { label: 'Tree/PageIndex', icon: LucideListTree, variant: 'secondary' },
  graph: { label: 'Graph', icon: LucideNetwork, variant: 'secondary' },
  mindmap: { label: 'Mindmap', icon: LucideGitBranch, variant: 'secondary' },
  timeline: { label: 'Timeline', icon: LucideWaypoints, variant: 'secondary' },
};

const TYPE_FILTERS: Array<{ value: '' | ArtifactType; label: string }> = [
  { value: '', label: '全部' },
  { value: 'wiki', label: 'Wiki' },
  { value: 'tree', label: 'Tree/PageIndex' },
  { value: 'graph', label: 'Graph' },
  { value: 'mindmap', label: 'Mindmap' },
  { value: 'timeline', label: 'Timeline' },
];

function formatTime(ms: number) {
  if (!ms) return '-';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/**
 * Artifacts 面板：把各知识库的编译产物（wiki / tree / graph / mindmap / timeline）
 * 汇总成一张卡片列表。
 *
 * 数据来自 /overview/artifacts —— 后端把 knowledgebase 表上的
 * xxx_task_id / xxx_task_finish_at 展开成「一行一个产物」。
 */
export function ArtifactsPanel({ embedded }: { embedded?: boolean }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [typeFilter, setTypeFilter] = useState<'' | ArtifactType>('');
  const [keyword, setKeyword] = useState('');

  const { data, isFetching } = useQuery({
    queryKey: ['overview', 'artifacts', page, pageSize, typeFilter, keyword],
    queryFn: async () => {
      const { data } = await request.get('/api/v1/overview/artifacts', {
        params: {
          page,
          page_size: pageSize,
          ...(typeFilter ? { type: typeFilter } : {}),
          ...(keyword ? { keyword } : {}),
        },
      });
      return (data?.data ?? { artifacts: [], total: 0 }) as {
        artifacts: ArtifactItem[];
        total: number;
      };
    },
  });

  const rows = useMemo(() => data?.artifacts ?? [], [data]);

  return (
    <div className={embedded ? 'flex flex-col gap-4' : 'flex flex-col gap-4 p-5'}>
      {/* 筛选 */}
      <div className="flex flex-wrap items-center gap-2">
        {TYPE_FILTERS.map((item) => (
          <Button
            key={item.value}
            size="sm"
            variant={typeFilter === item.value ? 'default' : 'outline'}
            onClick={() => {
              setTypeFilter(item.value);
              setPage(1);
            }}
          >
            {item.label}
          </Button>
        ))}
        <div className="relative ml-auto w-[240px]">
          <LucideSearch className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-disabled" />
          <Input
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
            placeholder="搜索知识库名称"
            className="pl-9"
          />
        </div>
      </div>

      {/* 卡片网格 */}
      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-text-secondary">
            {isFetching ? '加载中…' : '暂无 artifacts。知识库解析完成后会自动编译。'}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((item) => {
            const meta = TYPE_META[item.type] ?? TYPE_META.wiki;
            const Icon = meta.icon;
            return (
              <Card key={item.id} className="transition-shadow hover:shadow-md">
                <CardContent className="flex flex-col gap-3 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-bg-card">
                        <Icon className="size-4 text-text-primary" />
                      </span>
                      <span
                        className="truncate text-sm font-medium text-text-primary"
                        title={item.name}
                      >
                        {item.name}
                      </span>
                    </div>
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-text-secondary">
                    <span>{item.doc_num} 个文档</span>
                    <span>{item.chunk_num} 个分块</span>
                  </div>

                  <div className="flex flex-col gap-1 border-t border-border-default pt-3 text-xs text-text-secondary">
                    <span className="flex items-center gap-1.5">
                      <LucideCalendarClock className="size-3.5" />
                      创建 {formatTime(item.created_at)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <LucideCalendarClock className="size-3.5" />
                      更新 {formatTime(item.updated_at)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* 分页 */}
      {(data?.total ?? 0) > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-secondary">
            共 {data?.total ?? 0} 个 artifacts
          </span>
          <RAGFlowPagination
            total={data?.total ?? 0}
            current={page}
            pageSize={pageSize}
            onChange={(nextPage, nextSize) => {
              setPage(nextPage);
              setPageSize(nextSize);
            }}
          />
        </div>
      )}
    </div>
  );
}
