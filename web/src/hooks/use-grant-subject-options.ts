import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { GrantSubjectOptions } from '@/components/grant-dialog';
import { useConsolePermissions } from '@/hooks/use-console-permissions';
import {
  ConsoleMember,
  DepartmentNode,
  fetchConsoleMembers,
  fetchDepartments,
} from '@/services/console-service';

/**
 * 授权弹窗里可选的授予对象：部门（拍平成树序）+ 成员。
 *
 * 部门树归「组织架构」、成员列表归「用户管理」，与「资源授权」分开授权：
 * 只授了资源授权的角色不该为了选主体而吃两个 403 —— 各自无权限时跳过请求，
 * 下拉留空。查询键与控制台页面共用，两处开同一份缓存。
 */
export function useGrantSubjectOptions(tenantId?: string) {
  const { canView } = useConsolePermissions();

  const { data: deptData } = useQuery({
    queryKey: ['console/departments', tenantId],
    enabled: !!tenantId && canView('organization'),
    queryFn: async () => {
      const res = await fetchDepartments(tenantId as string);
      return res?.data?.data ?? { departments: [] as DepartmentNode[] };
    },
  });
  const departments = useMemo(
    () => deptData?.departments ?? [],
    [deptData],
  );

  const { data: memberData } = useQuery({
    queryKey: ['console/members-for-grant', tenantId],
    enabled: !!tenantId && canView('member'),
    queryFn: async () => {
      const res = await fetchConsoleMembers(tenantId as string, {
        page: 1,
        page_size: 200,
      });
      return res?.data?.data ?? { members: [] as ConsoleMember[], total: 0 };
    },
  });
  const members = useMemo(() => memberData?.members ?? [], [memberData]);

  // 层级用全角空格缩进而不是树控件：原生 select 里只有文字，缩进是唯一能表达
  // 从属关系的信号。
  const flatDepartments = useMemo(() => {
    const out: { id: string; name: string }[] = [];
    const walk = (nodes: DepartmentNode[], depth = 0) => {
      nodes.forEach((n) => {
        out.push({ id: n.id, name: `${'　'.repeat(depth)}${n.name}` });
        if (n.children?.length) walk(n.children, depth + 1);
      });
    };
    walk(departments);
    return out;
  }, [departments]);

  const options: GrantSubjectOptions = useMemo(
    () => ({
      departments: flatDepartments,
      members: members.map((m) => ({ id: m.id, name: m.nickname || m.email })),
    }),
    [flatDepartments, members],
  );

  return { members, options };
}
