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

import message from '@/components/ui/message';
import { IUserInfo } from '@/interfaces/database/user-setting';
import request from '@/utils/request';
import { useQuery } from '@tanstack/react-query';
import { isEmpty, trim } from 'lodash';
import { Search, Sparkles } from 'lucide-react';
import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import './index.less';
import { RAGFlowLogo } from './ragflow-logo';

/**
 * 兜底热门问题：接口没返回数据时才用（新部署、无历史提问）。
 * 正常走 /api/v1/system/hot-questions，取真实聊天记录里的高频提问。
 */
const FALLBACK_HOT_QUESTIONS = [
  '基金净值查询',
  '开户流程',
  '赎回规则',
  '风险评级',
];

/**
 * 相似问题的占位条目。
 *
 * 未发起检索时没有真实候选，这里用示例维持原型的信息结构；
 * 检索发起后由 SearchingPage 渲染真实结果。
 */
const FALLBACK_SIMILAR_QUESTIONS: SimilarQuestion[] = [
  {
    question: '嘉实沪深300ETF的最新净值是多少？',
    score: 96.5,
    tag: '产品净值',
  },
  { question: '如何查询嘉实基金的产品净值？', score: 88.2, tag: '操作指引' },
  { question: '嘉实300ETF联接基金净值查询', score: 82.7, tag: '产品净值' },
];

interface SimilarQuestion {
  question: string;
  score: number;
  tag: string;
}

/** 从 chunk 正文里抽出一句问题用于展示。 */
function extractQuestion(content: string): string {
  const text = content.replace(/<[^>]+>/g, ' ').trim();
  const matched = text.match(/问题\s*[:：]\s*([^\t\n]+)/);
  const raw = (matched?.[1] ?? text).replace(/\s+/g, ' ').trim();
  return raw.length > 40 ? `${raw.slice(0, 40)}…` : raw;
}

export default function SearchHome({
  isSearching,
  setIsSearching,
  searchText,
  setSearchText,
  userInfo,
  canSearch,
  showEmbedLogo,
  kbIds = [],
}: {
  isSearching: boolean;
  setIsSearching: Dispatch<SetStateAction<boolean>>;
  searchText: string;
  setSearchText: Dispatch<SetStateAction<string>>;
  userInfo?: IUserInfo;
  canSearch?: boolean;
  showEmbedLogo?: boolean;
  /** 当前搜索应用绑定的知识库，用于「相似问题」实时检索。 */
  kbIds?: string[];
}) {
  const { t } = useTranslation();

  const handleStartSearch = useCallback(() => {
    if (canSearch === false) {
      message.warning(t('search.chooseDataset'));
      return;
    }
    // Do not enter the searching view with an empty question: it would render
    // the previous search's stale results from the mutation cache.
    if (isEmpty(trim(searchText))) {
      return;
    }
    setIsSearching(!isSearching);
  }, [canSearch, isSearching, searchText, setIsSearching, t]);

  const fillQuestion = (question: string) => {
    setSearchText(question);
  };

  // 热门问题：真实聊天记录里的高频用户提问。
  const { data: hotQuestions } = useQuery({
    queryKey: ['hotQuestions'],
    queryFn: async () => {
      const { data } = await request.get('/api/v1/system/hot-questions', {
        params: { size: 4 },
      });
      return (data?.data ?? []) as string[];
    },
  });

  // 相似问题：输入停顿 500ms 后拿当前问题去检索，取命中的 chunk 作为候选。
  const [debouncedQuestion, setDebouncedQuestion] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuestion(trim(searchText));
    }, 500);
    return () => clearTimeout(timer);
  }, [searchText]);

  const { data: similarQuestions } = useQuery({
    queryKey: ['similarQuestions', debouncedQuestion, kbIds.join(',')],
    enabled: debouncedQuestion.length >= 2 && kbIds.length > 0,
    queryFn: async () => {
      // umi-request 的第二个参数是 options，body 必须放在 data 里；
      // 直接平铺会被当成 options，body 为空 → 后端 ShouldBindJSON 报 EOF（101）。
      const { data } = await request.post('/api/v1/retrieval', {
        data: {
          question: debouncedQuestion,
          dataset_ids: kbIds,
          page: 1,
          page_size: 3,
          similarity_threshold: 0.2,
          vector_similarity_weight: 0.3,
        },
      });
      const chunks = (data?.data?.chunks ?? []) as Array<{
        content?: string;
        similarity?: number;
        document_name?: string;
      }>;
      return chunks.map((chunk) => ({
        // FAQ chunk 的格式是「问题：xxx\t回答：yyy」，优先取「问题：」后面的部分。
        question: extractQuestion(chunk.content ?? ''),
        score: Math.round((chunk.similarity ?? 0) * 1000) / 10,
        tag: chunk.document_name ?? '知识库',
      }));
    },
  });

  const hotList = hotQuestions?.length
    ? hotQuestions
    : FALLBACK_HOT_QUESTIONS;
  const similarList = similarQuestions?.length
    ? similarQuestions
    : FALLBACK_SIMILAR_QUESTIONS;

  return (
    <section className="h-full overflow-y-auto px-6 py-8">
      <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-5">
        {/* 品牌：和君纵达 */}
        <div className="flex flex-col items-center gap-1">
          <RAGFlowLogo showEmbedIcon={showEmbedLogo} />
          {userInfo?.nickname && (
            <p className="text-sm text-text-secondary">
              {t('search.welcomeBack')}，{userInfo.nickname}
            </p>
          )}
        </div>

        {/* 搜索卡片 */}
        <div className="rounded-xl border border-border-default bg-bg-base p-5">
          <div className="flex items-center gap-3 rounded-lg bg-bg-card px-4 py-2.5">
            <Search size={20} className="shrink-0 text-text-secondary" />
            <input
              type="text"
              placeholder="请输入您的问题"
              className="min-w-0 flex-1 bg-transparent text-base text-text-primary outline-none placeholder:text-text-disabled"
              value={searchText}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  handleStartSearch();
                }
              }}
              onChange={(e) => {
                if (canSearch === false) {
                  message.warning(t('search.chooseDataset'));
                  return;
                }
                setSearchText(e.target.value || '');
              }}
            />
            <button
              type="button"
              onClick={handleStartSearch}
              className="flex shrink-0 items-center gap-1.5 rounded-md bg-[#4F46E5] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              <Sparkles size={15} />
              智能问答
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-text-secondary">热门问题：</span>
            {hotList.map((question) => (
              <button
                key={question}
                type="button"
                onClick={() => fillQuestion(question)}
                className="rounded-full border border-border-default px-3 py-1 text-sm text-text-primary transition-colors hover:border-text-secondary"
              >
                {question}
              </button>
            ))}
          </div>
        </div>

        {/* 主体：左 AI 回答 / 右 相似问题 */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* AI 回答（空状态） */}
          <div className="flex min-h-[430px] flex-col rounded-xl border border-border-default bg-bg-base p-6">
            <h2 className="text-base font-semibold text-text-primary">
              AI 回答
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              基于知识库内容智能生成
            </p>

            <div className="flex flex-1 flex-col items-center justify-center gap-3">
              <div className="flex size-16 items-center justify-center rounded-full bg-[#EEF2FF]">
                <Sparkles size={28} className="text-[#4F46E5]" />
              </div>
              <p className="text-lg font-medium text-text-primary">
                开始智能问答
              </p>
              <p className="max-w-[360px] text-center text-sm text-text-secondary">
                输入您的问题，AI 将基于知识库内容为您提供准确、全面的答案
              </p>
            </div>
          </div>

          {/* 相似问题 */}
          <div className="rounded-xl border border-border-default bg-bg-base p-5">
            <h2 className="text-base font-semibold text-text-primary">
              相似问题
            </h2>
            <p className="mt-1 text-sm text-text-secondary">相关度由高到低</p>

            <div className="mt-4 flex flex-col gap-3">
              {similarList.map(({ question, score, tag }) => (
                <button
                  key={question}
                  type="button"
                  onClick={() => fillQuestion(question)}
                  className="rounded-lg border border-border-default p-3 text-left transition-colors hover:border-text-secondary"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium leading-snug text-text-primary">
                      {question}
                    </span>
                    <span className="shrink-0 rounded bg-bg-card px-1.5 py-0.5 text-xs font-semibold text-text-primary">
                      {score}%
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-text-secondary">{tag}</p>
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-border-default">
                    <div
                      className="h-full rounded-full bg-[#2563EB]"
                      style={{ width: `${score}%` }}
                    />
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
