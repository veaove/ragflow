/**
 * 资源授权页的 query key 工厂。
 *
 * 三组前缀分开：资源树（有层级的类型）、平铺资源列表（无层级的类型）、
 * 成员视角。写操作要同时失效树与列表，所以各自都有 root。
 */
export const GrantKeys = {
  /** 资源列表前缀，用于整体失效。 */
  resourcesRoot: ['console/grants'] as const,
  /** 资源树前缀。 */
  treeRoot: ['console/grant-tree'] as const,
  /** 子项例外（某个节点下的文件 / 文件夹）。 */
  exceptionsRoot: ['console/grant-exceptions'] as const,
  /** 成员视角。 */
  subjectRoot: ['console/grants-by-subject'] as const,
  /** 授权图谱前缀：一次取全成员 / 团队 / 资源，写操作后整份失效。 */
  graphRoot: ['console/grant-graph'] as const,
  resources: (
    tenantId: string,
    kind: string,
    page: number,
    pageSize: number,
    keywords: string,
  ) => ['console/grants', tenantId, kind, page, pageSize, keywords] as const,
  tree: (tenantId: string, kind: string, keywords: string) =>
    ['console/grant-tree', tenantId, kind, keywords] as const,
  exceptions: (
    tenantId: string,
    kind: string,
    datasetId: string,
    folderId: string,
    keywords: string,
    includeAll: boolean,
    page: number,
    pageSize: number,
  ) =>
    [
      'console/grant-exceptions',
      tenantId,
      kind,
      datasetId,
      folderId,
      keywords,
      includeAll,
      page,
      pageSize,
    ] as const,
  subject: (tenantId: string, subjectId: string) =>
    ['console/grants-by-subject', tenantId, subjectId] as const,
  graph: (tenantId: string) => ['console/grant-graph', tenantId] as const,
};
