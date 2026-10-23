import { MessageType, WebSearchProvider } from '@/constants/chat';
import { IAttachment } from '@/hooks/use-send-message';

export interface IDocumentDownloadInfo {
  doc_id: string;
  filename: string;
  mime_type: string;
  size?: number;
}

export interface PromptConfig {
  empty_response: string;
  parameters: Parameter[];
  prologue: string;
  system: string;
  tts?: boolean;
  quote: boolean;
  keyword: boolean;
  refine_multiturn: boolean;
  use_kg: boolean;
  reasoning?: boolean;
  cross_languages?: Array<string>;
  brave_api_key?: string;
  exa_api_key?: string;
  firecrawl_api_key?: string;
  linkup_api_key?: string;
  parallel_api_key?: string;
  querit_api_key?: string;
  search1api_api_key?: string;
  serply_api_key?: string;
  tavily_api_key?: string;
  youcom_api_key?: string;
  web_search_provider?: WebSearchProvider;
  toc_enhance?: boolean;
}

export interface Parameter {
  key: string;
  optional: boolean;
}

export interface LlmSetting {
  Creative: Variable;
  Custom: Variable;
  Evenly: Variable;
  Precise: Variable;
}

export interface Variable {
  frequency_penalty?: number;
  max_tokens?: number;
  presence_penalty?: number;
  temperature?: number;
  top_p?: number;
  thinking?: 'default' | 'enabled' | 'disabled';
  tenant_llm_id?: string;
  model_type?: string;
}

export interface IDialog {
  create_date: string;
  create_time: number;
  description: string;
  icon: string;
  id: string;
  dialog_id?: string;
  dataset_ids: string[];
  kb_names: string[];
  language: string;
  llm_id: string;
  tenant_llm_id?: string;
  llm_setting: Variable;
  llm_setting_type?: string;
  name: string;
  prompt_config: PromptConfig;
  prompt_type: string;
  status: string;
  tenant_id: string;
  update_date: string;
  update_time: number;
  keywords_similarity_weight?: number;
  similarity_threshold: number;
  top_k: number;
  top_n: number;
  rerank_candidates_count: number;
  rerank_id?: string;
  tenant_rerank_id?: string;
  meta_data_filter: MetaDataFilter;
}

interface MetaDataFilter {
  manual: Manual[];
  method: string;
}

interface Manual {
  key: string;
  op: string;
  value: string;
}

export interface IConversation {
  create_date: string;
  create_time: number;
  chat_id: string;
  id: string;
  avatar: string;
  messages: Message[];
  reference: IReference[];
  name: string;
  update_date: string;
  update_time: number;
  is_new: true;
}

export interface Message {
  content: string;
  role: MessageType;
  doc_ids?: string[];
  prompt?: string;
  id?: string;
  audio_binary?: string;
  data?: any;
  files?: (File | UploadResponseDataType)[];
  chatBoxId?: string;
  attachment?: IAttachment;
  downloads?: IDocumentDownloadInfo[];
}

export interface IReferenceChunk {
  id: string;
  content: null;
  document_id: string;
  document_name: string;
  dataset_id: string;
  image_id: string;
  similarity: number;
  vector_similarity: number;
  term_similarity: number;
  positions: number[][];
  doc_type?: string;
}

export interface IReference {
  chunks: IReferenceChunk[];
  doc_aggs: Docagg[];
  total: number;
}

export interface IReferenceObject {
  chunks: Record<string, IReferenceChunk>;
  doc_aggs: Record<string, Docagg>;
}

export interface IAnswer {
  answer: string;
  attachment?: IAttachment;
  downloads?: IDocumentDownloadInfo[];
  reference?: IReference;
  conversationId?: string;
  prompt?: string;
  id?: string;
  audio_binary?: string;
  data?: any;
  chatBoxId?: string;
  // Quality-inspection hint that produced this answer. Live-stream only: it is
  // not persisted, so a reloaded conversation shows the replacement text
  // without the banner.
  qc_event?: IQcEvent;
}

export interface Docagg {
  count: number;
  doc_id: string;
  doc_name: string;
  url?: string;
}

// interface Chunk {
//   chunk_id: string;
//   content_ltks: string;
//   content_with_weight: string;
//   doc_id: string;
//   docnm_kwd: string;
//   img_id: string;
//   important_kwd: any[];
//   kb_id: string;
//   similarity: number;
//   term_similarity: number;
//   vector_similarity: number;
// }

export interface IToken {
  create_date: string;
  create_time: number;
  tenant_id: string;
  token: string;
  update_date?: any;
  update_time?: any;
  beta: string;
}

export interface IStats {
  pv: [string, number][];
  uv: [string, number][];
  speed: [string, number][];
  tokens: [string, number][];
  round: [string, number][];
  thumb_up: [string, number][];
}

export interface IExternalChatInfo {
  avatar?: string;
  title: string;
  prologue?: string;
  has_tavily_key?: boolean;
  has_web_search_provider?: boolean;
  llm_id?: string;
}

export interface IMessage extends Message {
  id: string;
  /**
   * 该条回答的点赞状态。后端 conversation_message.thumb_up 持久化，
   * 重新进入会话时必须用它回显高亮，否则会「点完看不到、下次还能再点」。
   */
  thumbup?: boolean;
  /** 差评原因。非空且 thumbup=false 表示这条回答被差评。 */
  feedback?: string;
  awaitingServerId?: boolean;
  reference?: IReference; // the latest news has reference
  conversationId?: string; // To distinguish which conversation the message belongs to
  // Quality-inspection hint carried by the SSE chunk that produced this
  // answer. Live-stream only: it is not persisted server-side.
  qc_event?: IQcEvent;
}

/**
 * Quality-inspection hint attached to an answer chunk (`QcEvent` in
 * internal/service/chat_pipeline.go — the JSON tags there are the client
 * contract). Only warn / block hits fill it; info hits are persisted without a
 * client hint.
 *
 * When `blocked` is true the backend has already replaced the answer with the
 * replacement message, so the client must REPLACE its accumulated text rather
 * than append: a block that fires after clean text has streamed would
 * otherwise render as "half original answer + replacement".
 */
export interface IQcEvent {
  rule_id?: string;
  rule_name?: string;
  severity?: string;
  matched_text?: string;
  prompt_message?: string;
  blocked?: boolean;
}

export interface IClientConversation extends IConversation {
  messages: IMessage[];
}

export interface UploadResponseDataType {
  created_at: number;
  created_by: string;
  extension: string;
  id: string;
  mime_type: string;
  name: string;
  preview_url: null;
  size: number;
}
