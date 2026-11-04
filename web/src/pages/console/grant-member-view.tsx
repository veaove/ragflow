import { useQuery } from '@tanstack/react-query';
import { LucideSearch, LucideUserRound } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ConsoleMember,
  GrantSubjectRow,
  fetchGrantsBySubject,
} from '@/services/console-service';

import { GrantKeys } from './grant-keys';

/** 来源标签：直接授权是主证据，部门 / 团队是解释「为什么他也能看到」。 */
const VIA_LABEL: Record<string, string> = {
  direct: '直接授权',
  department: '部门',
  team: '全团队',
};

const VIA_CLASS: Record<string, string> = {
  direct: 'bg-accent-primary/10 text-accent-primary',
  department: 'bg-background-second text-text-secondary',
  team: 'bg-state-warning/10 text-state-warning',
};

function ViaChip({ row }: { row: GrantSubjectRow }) {
  const label =
    row.via === 'direct'
      ? VIA_LABEL.direct
      : row.via === 'department'
        ? `${VIA_LABEL.department}「${row.via_name ?? ''}」`
        : VIA_LABEL.team;
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[11px] leading-4 ${
        VIA_CLASS[row.via] ?? VIA_CLASS.department
      }`}
    >
      {label}
    </span>
  );
}

interface GrantMemberViewProps {
  tenantId: string;
  members: ConsoleMember[];
}

/**
 * 按成员视角：他为什么能看到这些东西。
 *
 * 同一个资源可能同时经直接授权、部门、全团队到达同一个人，三类来源必须分行，
 * 否则「我没给过他」这类问题在页面上永远解释不清。
 */
export function GrantMemberView({ tenantId, members }: GrantMemberViewProps) {
  const [selectedId, setSelectedId] = useState('');
  const [keywords, setKeywords] = useState('');

  const activeId = selectedId || members[0]?.id || '';

  const filtered = useMemo(() => {
    const kw = keywords.trim().toLowerCase();
    if (!kw) return members;
    return members.filter((m) =>
      (m.nickname || m.email || '').toLowerCase().includes(kw),
    );
  }, [keywords, members]);

  const { data, isFetching } = useQuery({
    queryKey: GrantKeys.subject(tenantId, activeId),
    enabled: !!tenantId && !!activeId,
    queryFn: async () => {
      const res = await fetchGrantsBySubject(tenantId, {
        subject_kind: 'user',
        subject_id: activeId,
      });
      return (
        res?.data?.data ?? {
          subject_kind: 'user',
          subject_id: activeId,
          subject_name: '',
          rows: [],
          direct: 0,
          department: 0,
          team: 0,
        }
      );
    },
  });

  const rows = data?.rows ?? [];

  const handleKeywordsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setKeywords(e.target.value),
    [],
  );

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <aside className="flex w-[220px] shrink-0 flex-col rounded-lg border border-border-default bg-bg-base">
        <div className="relative border-b border-border-default p-2">
          <LucideSearch className="absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-text-secondary" />
          <Input
            value={keywords}
            onChange={handleKeywordsChange}
            placeholder="搜索成员"
            className="h-8 pl-7 text-xs"
          />
        </div>
        <ul className="min-h-0 flex-1 overflow-auto p-1">
          {filtered.length === 0 && (
            <li className="px-2 py-6 text-center text-xs text-text-secondary">
              没有匹配的成员
            </li>
          )}
          {filtered.map((member) => {
            const active = member.id === activeId;
            return (
              <li key={member.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(member.id)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                    active
                      ? 'bg-accent-primary/10 text-accent-primary'
                      : 'text-text-primary hover:bg-background-second'
                  }`}
                >
                  <LucideUserRound className="size-3.5 shrink-0 text-text-secondary" />
                  <span className="min-w-0 flex-1 truncate">
                    {member.nickname || member.email}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-border-default pb-3">
          <h2 className="text-lg font-medium text-text-primary">
            {data?.subject_name || '选择左侧成员'}
          </h2>
          {data && (
            <span className="flex items-center gap-1.5 text-xs text-text-secondary">
              <span className="rounded bg-accent-primary/10 px-1.5 py-0.5 text-accent-primary">
                直接授权 {data.direct}
              </span>
              <span className="rounded bg-background-second px-1.5 py-0.5">
                部门 {data.department}
              </span>
              <span className="rounded bg-state-warning/10 px-1.5 py-0.5 text-state-warning">
                全团队 {data.team}
              </span>
            </span>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-auto pt-3">
          {rows.length === 0 ? (
            <p className="rounded-md border border-dashed border-border-default p-4 text-xs text-text-secondary">
              {isFetching
                ? '…'
                : '该成员没有通过授权获得的资源：他只能看到自己的资源，以及可见范围内对他开放的资源。'}
            </p>
          ) : (
            <Table rootClassName="max-h-full">
              <TableHeader>
                <TableRow>
                  <TableHead>资源</TableHead>
                  <TableHead>权限</TableHead>
                  <TableHead>来源</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={`${row.via}-${row.resource_kind}-${row.resource_id}`}>
                    <TableCell className="text-sm text-text-primary">
                      <div className="truncate" title={row.resource_name}>
                        {row.resource_name || row.resource_id}
                      </div>
                      {row.parent_name && (
                        <div className="truncate text-[11px] text-text-secondary">
                          {row.parent_name}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.effect === 'deny' ? (
                        <span className="rounded bg-state-error/10 px-1.5 py-0.5 text-state-error">
                          已排除
                        </span>
                      ) : (
                        <span className="text-text-secondary">
                          {row.permission === 'edit' ? '可编辑' : '可查看'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <ViaChip row={row} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </section>
    </div>
  );
}
