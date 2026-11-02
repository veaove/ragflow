/** 资源授权页的 query key 工厂：资源列表与「展开后的文件列表」各一组。 */
export const GrantKeys = {
  /** 资源列表前缀，用于整体失效。 */
  resourcesRoot: ['console/grants'] as const,
  /** 文件列表前缀，用于整体失效（与资源列表不同前缀，需分别失效）。 */
  documentsRoot: ['console/grant-documents'] as const,
  resources: (
    tenantId: string,
    kind: string,
    page: number,
    pageSize: number,
    keywords: string,
  ) => ['console/grants', tenantId, kind, page, pageSize, keywords] as const,
  documents: (
    tenantId: string,
    datasetId: string,
    page: number,
    pageSize: number,
    keywords: string,
  ) =>
    [
      'console/grant-documents',
      tenantId,
      datasetId,
      page,
      pageSize,
      keywords,
    ] as const,
};
