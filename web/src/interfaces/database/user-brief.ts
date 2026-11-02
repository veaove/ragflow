/** 资源 owner 的最小身份信息：昵称 + 邮箱。 */
export interface IUserBrief {
  id: string;
  nickname: string;
  email: string;
}

/** 批量解析结果，key 是 user id。 */
export type IUserBriefMap = Record<string, IUserBrief>;
