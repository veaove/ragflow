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

import { useIsDarkTheme } from '@/components/theme-provider';
import { Button } from '@/components/ui/button';
import { useSetModalState, useTranslate } from '@/hooks/common-hooks';
import { useTranslation } from 'react-i18next';
import { LangfuseCard } from '@/pages/user-setting/setting-model/langfuse';
import apiDoc from '@parent/docs/references/http_api_reference.md?raw';
import { Loader2 } from 'lucide-react';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ChatApiKeyModal from '../chat-api-key-modal';
import BackendServiceApi from './backend-service-api';
import MarkdownToc from './markdown-toc';

const LazyMarkdownPreview = lazy(() => import('@uiw/react-markdown-preview'));

const removeFrontmatter = (content: string): string => {
  const lines = content.split('\n');
  if (lines[0]?.trim() === '---') {
    const endIndex = lines.slice(1).findIndex((line) => line.trim() === '---');
    if (endIndex !== -1) {
      return lines.slice(endIndex + 2).join('\n');
    }
  }
  return content;
};

const ApiContent = ({ id, idKey }: { id?: string; idKey: string }) => {
  const { t } = useTranslate('setting');

  const {
    visible: apiKeyVisible,
    hideModal: hideApiKeyModal,
    showModal: showApiKeyModal,
  } = useSetModalState();

  const {
    visible: tocVisible,
    hideModal: hideToc,
    showModal: showToc,
  } = useSetModalState();

  const isDarkTheme = useIsDarkTheme();
  const { i18n } = useTranslation();

  // The Chinese reference is a separate file loaded on demand: it roughly
  // doubles the markdown payload, so English users should not download it.
  // Falls back to the English original if the chunk fails to load.
  const [rawDoc, setRawDoc] = useState<string>(apiDoc);
  useEffect(() => {
    if (!(i18n.language || '').toLowerCase().startsWith('zh')) {
      setRawDoc(apiDoc);
      return;
    }
    let cancelled = false;
    import('@parent/docs/references/http_api_reference.zh.md?raw')
      .then((m) => {
        if (!cancelled) setRawDoc(m.default);
      })
      .catch(() => {
        // Keep the English doc rather than showing an empty page.
      });
    return () => {
      cancelled = true;
    };
  }, [i18n.language]);

  const cleanDoc = useMemo(
    () => applyProductBrand(removeFrontmatter(rawDoc)),
    [rawDoc],
  );

  // Defer the heavy 230KB markdown rendering so the page paints immediately.
  const [docReady, setDocReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDocReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Ref wrapping the lazily-mounted markdown preview. The TOC scopes its heading
  // queries to this element, and only mounts once the preview is actually in the
  // DOM (not while its lazy chunk is still suspended).
  const previewRef = useRef<HTMLElement | null>(null);
  const [previewMounted, setPreviewMounted] = useState(false);
  const setPreviewRef = useCallback((el: HTMLDivElement | null) => {
    previewRef.current = el;
    setPreviewMounted(el !== null);
  }, []);

  return (
    <div className="flex flex-col w-full">
      <BackendServiceApi show={showApiKeyModal} />

      <div className="text-left py-4">
        <Button onClick={tocVisible ? hideToc : showToc}>
          {tocVisible ? t('hideToc') : t('showToc')}
        </Button>
      </div>
      <section className="flex flex-col gap-2 pb-5 flex-1 min-h-0 overflow-auto mb-4">
        {tocVisible && previewMounted && <MarkdownToc container={previewRef} />}
        {docReady ? (
          <Suspense
            fallback={
              <div className="flex justify-center py-10">
                <Loader2 className="size-5 animate-spin text-text-secondary" />
              </div>
            }
          >
            <div ref={setPreviewRef}>
              <LazyMarkdownPreview
                source={cleanDoc}
                wrapperElement={{
                  'data-color-mode': isDarkTheme ? 'dark' : 'light',
                }}
              />
            </div>
          </Suspense>
        ) : (
          <div className="flex justify-center py-10">
            <Loader2 className="size-5 animate-spin text-text-secondary" />
          </div>
        )}
      </section>
      <LangfuseCard></LangfuseCard>
      {apiKeyVisible && (
        <ChatApiKeyModal
          hideModal={hideApiKeyModal}
          dialogId={id}
          idKey={idKey}
        ></ChatApiKeyModal>
      )}
    </div>
  );
};

export default ApiContent;

/**
 * 把文档正文里的上游产品名换成当前产品的名称。
 *
 * 只改正文、**不碰代码块**：代码块里出现的是 URL、字段值、示例变量，
 * 改掉会让示例直接失效（比如 ragflow.io、ragflow_api_key）。
 * 小写域名不会被匹配，因为这里只替换首字母大写的品牌名。
 */
function applyProductBrand(markdown: string): string {
  const PRODUCT_NAME = '和君知识库';
  const segments = markdown.split(/(```[\s\S]*?```)/g);
  return segments
    .map((segment, index) => {
      // 奇数下标是代码块，原样保留。
      if (index % 2 === 1) {
        return segment;
      }
      return segment
        .replace(/RAGFlow/g, PRODUCT_NAME)
        .replace(/RagFlow/g, PRODUCT_NAME);
    })
    .join('');
}
