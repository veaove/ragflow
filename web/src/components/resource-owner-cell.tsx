import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useUserBriefMap } from '@/hooks/use-user-brief';
import { IUserBriefMap } from '@/interfaces/database/user-brief';
import { createContext, ReactNode, useContext } from 'react';

const ResourceOwnerContext = createContext<IUserBriefMap>({});

/**
 * 表格级批量解析。
 *
 * 每个单元格各自调 hook 会变成「一行一个请求」；用 Provider 把整页的 owner id
 * 收齐查一次，单元格只从 context 取。表格渲染外层包一层即可。
 */
export function ResourceOwnerProvider({
  userIds,
  children,
}: {
  userIds: Array<string | null | undefined>;
  children: ReactNode;
}) {
  const { briefs } = useUserBriefMap(userIds);
  return (
    <ResourceOwnerContext.Provider value={briefs}>
      {children}
    </ResourceOwnerContext.Provider>
  );
}

/**
 * 资源 owner 单元格：显示创建人昵称，点击弹出昵称 + 邮箱。
 *
 * 解析不到时有三种情况要区分开，否则用户会以为数据丢了：
 * 没有创建人（历史数据）、跨租户或被删除（后端不返回）、还在加载。
 */
export function ResourceOwnerCell({
  userId,
  emptyText = '—',
}: {
  userId?: string | null;
  emptyText?: string;
}) {
  const briefs = useContext(ResourceOwnerContext);

  if (!userId) {
    return <span className="text-text-secondary">{emptyText}</span>;
  }

  const brief = briefs[userId];
  if (!brief) {
    return (
      <span className="text-text-secondary" title={`用户 ${userId}`}>
        {emptyText}
      </span>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="max-w-[160px] cursor-pointer truncate text-left hover:text-text-accent hover:underline"
          title="查看人员信息"
        >
          {brief.nickname}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <div className="text-sm font-medium">{brief.nickname}</div>
        <div className="mt-1 break-all text-xs text-text-secondary">
          {brief.email || '未填写邮箱'}
        </div>
      </PopoverContent>
    </Popover>
  );
}
