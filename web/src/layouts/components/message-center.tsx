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
  LucideBot,
  LucideDatabaseZap,
  LucideFileText,
  LucideShieldAlert,
} from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import request from '@/utils/request';

export interface IRecentActivity {
  kind: 'document' | 'knowledgebase' | 'canvas' | 'qc_block';
  title: string;
  time: number;
}

const activityMeta: Record<
  IRecentActivity['kind'],
  { label: string; icon: typeof LucideFileText; className: string }
> = {
  document: {
    label: '上传文件',
    icon: LucideFileText,
    className: 'text-text-secondary',
  },
  knowledgebase: {
    label: '新建知识库',
    icon: LucideDatabaseZap,
    className: 'text-text-secondary',
  },
  canvas: {
    label: '编辑智能体',
    icon: LucideBot,
    className: 'text-text-secondary',
  },
  qc_block: {
    label: '质检拦截',
    icon: LucideShieldAlert,
    className: 'text-text-secondary',
  },
};

function formatTime(ts: number) {
  if (!ts) return '-';
  // 后端 time 是毫秒
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/**
 * 消息中心。
 *
 * 数据复用总览页的「最近动态」接口（/overview/activities），
 * 后端已按调用者所属租户过滤，所以这里天然只拿得到当前用户有权看的数据。
 * 分页用 page / page_size，返回 has_more 判断是否还有下一页。
 */
export function MessageCenterDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [page, setPage] = useState(1);

  const { data, isFetching } = useQuery({
    queryKey: ['message-center', page],
    enabled: open,
    queryFn: async () => {
      const { data } = await request.get('/api/v1/overview/activities', {
        params: { page, page_size: 20 },
      });
      return (data?.data ?? {}) as {
        activities?: IRecentActivity[];
        has_more?: boolean;
      };
    },
  });

  const rows = data?.activities ?? [];
  const hasMore = !!data?.has_more;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setPage(1);
        onOpenChange(next);
      }}
    >
      <DialogContent className="!w-[560px]">
        <DialogHeader>
          <DialogTitle>消息中心</DialogTitle>
        </DialogHeader>

        <div className="max-h-[480px] min-h-[200px] overflow-y-auto">
          {isFetching && rows.length === 0 && (
            <p className="py-10 text-center text-sm text-text-secondary">
              加载中…
            </p>
          )}
          {!isFetching && rows.length === 0 && (
            <p className="py-10 text-center text-sm text-text-secondary">
              暂无消息
            </p>
          )}
          {rows.map((item, index) => {
            const meta = activityMeta[item.kind] ?? activityMeta.document;
            const Icon = meta.icon;
            return (
              <div
                key={`${item.kind}-${item.time}-${index}`}
                className="flex items-start gap-3 border-b border-border-default py-3 last:border-b-0"
              >
                <Icon className={`mt-0.5 size-4 shrink-0 ${meta.className}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-text-primary">
                    {item.title || '（未命名）'}
                  </div>
                  <div className="mt-1 text-xs text-text-secondary">
                    {meta.label} · {formatTime(item.time)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-border-default pt-3">
          <span className="text-xs text-text-secondary">第 {page} 页</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasMore || isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
