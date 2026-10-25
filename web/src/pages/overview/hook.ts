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
import { fetchDepartments } from '@/services/console-service';
import {
  documentFilter,
  getSystemStats,
  listDataset,
} from '@/services/knowledge-service';
import type { IStats } from '@/interfaces/database/chat';
import type { IDocumentInfoFilter } from '@/interfaces/database/document';
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
  // 回溯 (days - 1) 天，而不是 days 天。
  //
  // from_date 会被截断到 00:00:00，若再减整天数，窗口就横跨 8 个自然日
  // （今天再往前 7 天的那一天也算进来），「近7日」的图上会出现 8 个点、
  // 周X 标签重复（如「周六 … 周六」）。减 days-1 天后正好覆盖 days 个自然日。
  const from = new Date(to.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

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
 * 统计 Agent 数量，并顺带数出本月新建的数量。
 *
 * 不指定 canvas_category 时后端会混入编译模板组，这里显式传 'agent'，
 * 并再次按 item.type 过滤一次，双重保险。
 */
async function fetchAgentSummary(): Promise<{
  total: number;
  thisMonth: number;
}> {
  const monthStart = firstDayOfMonth();
  let total = 0;
  let thisMonth = 0;
  let page = 1;
  let upperBound = Number.POSITIVE_INFINITY;

  while (total < upperBound && page <= MAX_PAGES) {
    const { data } = await agentService.listAgents(
      { params: { page, page_size: PAGE_SIZE, canvas_category: 'agent' } },
      true,
    );
    const canvas: any[] = data?.data?.canvas ?? [];
    if (canvas.length === 0) break;

    const agents = canvas.filter((item) => item?.type === 'agent');
    total += agents.length;
    thisMonth += agents.filter(
      (item) => toMillis(item?.create_time) >= monthStart,
    ).length;

    upperBound = data?.data?.total ?? total;
    page += 1;
  }

  return { total, thisMonth };
}

/**
 * 时间戳统一成毫秒。
 *
 * canvas.create_time 在历史数据里有毫秒也有秒（早期表用秒），
 * 直接比较会把 2020 年的记录算成「本月新增」。13 位即毫秒是可靠判据。
 */
function toMillis(ts: unknown): number {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1e12 ? n * 1000 : n;
}

/** 本月 1 日 00:00 的毫秒时间戳（本地时区，与用户看到的「本月」一致）。 */
function firstDayOfMonth(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

/**
 * 部门树 → 部门总数 + 子部门数。
 *
 * 后端返回邻接表拼好的树，根节点就是没有父级的顶层部门；
 * 「子部门」= 排除顶层之后的节点数，与组织架构页的层级一致。
 */
function countDepartments(nodes: any[]): { total: number; children: number } {
  let total = 0;
  let children = 0;

  const walk = (list: any[], isRootLevel: boolean) => {
    for (const node of list) {
      total += 1;
      if (!isRootLevel) children += 1;
      if (Array.isArray(node?.children)) walk(node.children, false);
    }
  };

  walk(nodes, true);
  return { total, children };
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
 * 六组数据并行拉取。任意一组失败都不会让整页白屏——组件层按各自的 isError
 * 渲染降级内容，因此这里不做整体串行等待。
 *
 * tenantId 只给「部门数」用：控制台接口路径里带租户，缺了它就不发请求。
 */
export function useOverviewQueries(days = 7, tenantId?: string) {
  return useQueries({
    queries: [
      {
        queryKey: ['overview', 'datasets'],
        queryFn: fetchAllDatasets,
        refetchInterval: POLL_INTERVAL_MS,
        retry: 1,
      },
      {
        queryKey: ['overview', 'agentSummary'],
        queryFn: fetchAgentSummary,
        refetchInterval: POLL_INTERVAL_MS,
        retry: 1,
      },
      {
        queryKey: ['overview', 'stats', days],
        // 解包层级与 useSystemConfig 一致：
        // await 后是 { data: jsonBody }，jsonBody.data 才是 StatsResponse。
        queryFn: async () => {
          const { data: jsonBody } = await getSystemStats(
            buildStatsRange(days),
          );
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
      {
        // 部门数：控制台接口要 tenant_id，而 tenant_id 来自租户信息接口，
        // 因此这里按「拿不到 tenantId 就不发请求」处理，卡片显示 —。
        queryKey: ['overview', 'departments', tenantId],
        enabled: !!tenantId,
        queryFn: async () => {
          const res = await fetchDepartments(tenantId as string);
          const tree = res?.data?.data?.departments ?? [];
          return countDepartments(tree);
        },
        refetchInterval: POLL_INTERVAL_MS,
        retry: 1,
      },
    ],
  });
}
