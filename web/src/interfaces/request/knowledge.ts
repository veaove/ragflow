export interface ITestRetrievalRequestBody {
  question: string;
  page_size: number;
  rerank_candidates_count: number;
  similarity_threshold: number;
  keywords_similarity_weight: number;
  rerank_id?: string;
  use_kg?: boolean;
  highlight?: boolean;
  kb_id?: string[];
  meta_data_filter?: {
    logic?: string;
    method?: string;
    manual?: Array<{
      key: string;
      op: string;
      value: string;
    }>;
    semi_auto?: string[];
  };
}

export interface IFetchKnowledgeListRequestBody {
  owner_ids?: string[];
}

export interface IFetchKnowledgeListRequestParams {
  id?: string;
  page?: number;
  page_size?: number;
  keywords?: string;
  owner_ids?: string[];
  parser_id?: string;
  // Filter to datasets usable by both the canvas owner and the current user.
  canvas_id?: string;
  // 服务端筛选维度，与后端 GET /datasets 的 querystring 一一对应：
  // 分类多选（IN）、启用状态、创建/更新时间闭区间（YYYY-MM-DD）。
  category?: string[];
  enabled?: boolean;
  create_time_from?: string;
  create_time_to?: string;
  update_time_from?: string;
  update_time_to?: string;
}

export interface IFetchDocumentListRequestBody {
  suffix?: string[];
  run_status?: string[];
  return_empty_metadata?: boolean;
  metadata?: Record<string, string[]>;
  ids?: string[];
}

export interface IFetchArtifactListRequestParams {
  page?: number;
  page_size?: number;
  keywords?: string;
  page_type?: string;
  topic?: string;
}

export interface IFetchArtifactTopicListRequestParams {
  page?: number;
  page_size?: number;
  keywords?: string;
}

export interface IFetchArtifactGraphRequestParams {
  node?: string;
  keywords?: string;
  top_n?: number;
}

/** Knowledge graph browse/search. `keywords` drives one of the three entries. */
export interface IFetchKnowledgeGraphRequestParams {
  keywords?: string;
  mode?: 'auto' | 'entity' | 'relation' | 'nl';
  max_nodes?: number;
  max_edges?: number;
}

export interface IUpdateArtifactPageRequestBody {
  content_md: string;
  comments: string;
  title?: string;
}

export interface IUpdateArtifactPageRequestParams {
  pageType: string;
  slug: string;
  body: IUpdateArtifactPageRequestBody;
}
