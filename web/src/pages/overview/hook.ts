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

import agentService from '@/services/agent-service';
import {
  documentFilter,
  getSystemStats,
  listDataset,
} from '@/services/knowledge-service';
import type { IDocumentInfoFilter } from '@/interfaces/database/document';
import type { IStats } from '@/interfaces/database/chat';
import request from '@/utils/request';
import { POLL_INTERVAL_MS } from './constants';
import type { IUserActivity } from './interface';
import { useQueries } from '@tanstack/react-query';

/** 单页最大条数，与后端 page_size 上限一致。 */
const PAGE_SIZE = 100;
/** 翻页安全上限，避免后端返回异常 total 时无限循环。 */
const MAX_PAGES = 50;

/** 趋势覆盖天数需与后端 from_date 的回溯窗口对齐。 */
export function buildStatsRange(days: number) {
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  return {
    from_date: `${fmt(from)} 00:00:00`,
    to_date: `${fmt(to)} 23:59:59`,
  };
}

/** 拉取全部知识库，翻页聚合以突破单页限制。 */
async function fetchAllDatasets() {
  const all: any[] = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;

  while (all.length < total && page <= MAX_PAGES) {
    const { data } = await listDataset({ page, page_size: PAGE_SIZE } as any);
    const list: any[] = Array.isArray(data?.data) ? data.data : [];
    all.push(...list);
    total = data?.total_datasets ?? all.length;
    if (list.length === 0) break;
    page += 1;
  }

  return all;
}

/**
 * 统计 Agent 数量。
 *
 * 不指定 canvas_category 时后端会混入编译模板组，这里显式传 'agent'，
 * 并再次按 item.type 过滤一次，双重保险。
 */
async function fetchAgentTotal(): Promise<number> {
  let count = 0;
  let page = 1;
  let total = Number.POSITIVE_INFINITY;

  while (count < total && page <= MAX_PAGES) {
    const { data } = await agentService.listAgents(
      { params: { page, page_size: PAGE_SIZE, canvas_category: 'agent' } },
      true,
    );
    const canvas: any[] = data?.data?.canvas ?? [];
    if (canvas.length === 0) break;
    count += canvas.filter((item) => item?.type === 'agent').length;
    total = data?.data?.total ?? count;
    page += 1;
  }

  return count;
}

/**
 * 聚合全部知识库的文档后缀分布。
 *
 * 后端 filter 接口只支持单知识库查询，因此逐库调用。用并发上限 5 控制对后端的
 * 压力，单个库失败只损失该库的数据，不影响整体统计（Promise.allSettled）。
 */
async function fetchGlobalSuffixCounter(): Promise<Record<string, number>> {
  const datasets = await fetchAllDatasets();
  if (datasets.length === 0) return {};

  const merged: Record<string, number> = {};
  const CONCURRENCY = 5;

  for (let i = 0; i < datasets.length; i += CONCURRENCY) {
    const batch = datasets.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((ds) => documentFilter(ds.id)),
    );

    results.forEach((result) => {
      if (result.status !== 'fulfilled') return;
      // 解包层级与 useGetDocumentFilter 保持一致：
      // await 后是 { data: jsonBody }，jsonBody.data 才是 { total, filter }。
      const jsonBody = result.value?.data as
        | { data?: { filter?: IDocumentInfoFilter } }
        | undefined;
      const filter = jsonBody?.data?.filter;
      if (!filter?.suffix) return;
      Object.entries(filter.suffix).forEach(([suffix, count]) => {
        merged[suffix] = (merged[suffix] ?? 0) + (Number(count) || 0);
      });
    });
  }

  return merged;
}

/**
 * 总览页数据源。
 *
 * 五组数据并行拉取。任意一组失败都不会让整页白屏——组件层按各自的 isError
 * 渲染降级内容，因此这里不做整体串行等待。
 */
export function useOverviewQueries(days = 7) {
  return useQueries({
    queries: [
      {
        queryKey: ['overview', 'datasets'],
        queryFn: fetchAllDatasets,
        refetchInterval: POLL_INTERVAL_MS,
        retry: 1,
      },
      {
        queryKey: ['overview', 'agentTotal'],
        queryFn: fetchAgentTotal,
        refetchInterval: POLL_INTERVAL_MS,
        retry: 1,
      },
      {
        queryKey: ['overview', 'stats', days],
        // 解包层级与 useSystemConfig 一致：
        // await 后是 { data: jsonBody }，jsonBody.data 才是 StatsResponse。
        queryFn: async () => {
          const { data: jsonBody } = await getSystemStats(buildStatsRange(days));
          return jsonBody?.data as IStats;
        },
        refetchInterval: POLL_INTERVAL_MS,
        retry: 1,
      },
      {
        queryKey: ['overview', 'suffixCounter'],
        queryFn: fetchGlobalSuffixCounter,
        refetchInterval: POLL_INTERVAL_MS,
        retry: 1,
      },
      {
        // 用户活跃度：口径由后端定义（登录或发起会话），前端只负责展示。
        queryKey: ['overview', 'userActivity', days],
        queryFn: async () => {
          const { data: jsonBody } = await request.get(
            `/api/v1/system/user-activity?days=${days}`,
          );
          return jsonBody?.data as IUserActivity | undefined;
        },
        refetchInterval: POLL_INTERVAL_MS,
        retry: 1,
      },
    ],
  });
}
