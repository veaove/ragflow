import { IUserBriefMap } from '@/interfaces/database/user-brief';
import { batchUserBrief } from '@/services/user-service';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

/**
 * 批量把 user id 解析成昵称 + 邮箱。
 *
 * 列表页按「整页的人」查一次，而不是每个单元格查一次：queryKey 用 id 集合，
 * 相同的一批 id 会命中同一份缓存，翻页时只补新增的那些。
 */
export const useUserBriefMap = (userIds: Array<string | null | undefined>) => {
  const unique = useMemo(() => {
    const set = new Set<string>();
    userIds.forEach((id) => {
      if (id) {
        set.add(id);
      }
    });
    return Array.from(set).sort();
  }, [userIds]);

  const { data, isFetching } = useQuery<IUserBriefMap>({
    queryKey: ['user-briefs', unique],
    enabled: unique.length > 0,
    // 人员昵称/邮箱不会在几分钟内变，避免翻页时反复请求。
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await batchUserBrief(unique);
      return (data?.data ?? {}) as IUserBriefMap;
    },
  });

  return { briefs: data ?? {}, loading: isFetching };
};
