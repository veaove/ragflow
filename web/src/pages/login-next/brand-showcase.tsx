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

import {
  LanguageAbbreviation,
  LanguageAbbreviationMap,
} from '@/constants/common';
import { changeLanguageAsync } from '@/locales/config';
import { cn } from '@/lib/utils';
import { Globe, Headphones, Languages, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** 左侧品牌区的三张能力卡片，对应设计稿中的图标 + 文案。 */
export type BrandHighlight = {
  icon: LucideIcon;
  title: string;
  desc: string;
};

/**
 * 登录页左侧品牌展示区。
 *
 * 仅在 lg断点以上展示；窄屏由调用方隐藏，登录卡片独占整屏。
 */
export function BrandShowcase({
  className,
  productName,
  tagline,
  highlights,
}: {
  className?: string;
  productName: string;
  tagline: string;
  highlights: BrandHighlight[];
}) {
  return (
    <section
      className={cn(
        // 注意：这里曾用 flex-1（= flex:1 1 0%）。flex-basis 为 0 会让本区块
        // 在 flex-row 中可分配到 0 宽度，标题与副标题随即按 CJK 逐字换行规则
        // 一行一个字地竖排。改为 min-w-0 + flex-shrink，让浏览器按 min-content
        // 撑开实际需要的宽度。
        'flex min-w-0 shrink flex-col justify-center px-6 py-10 sm:px-8 xl:px-16',
        className,
      )}
    >
      <h1 className="text-[32px] font-bold leading-tight tracking-tight text-[#0B4DA2] sm:text-[40px] xl:text-[48px]">
        {productName}
      </h1>

      <p className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[15px] font-medium text-[#3F4A5C] sm:text-[17px]">
        {tagline.split('·').map((item, index) => (
          <span
            key={item}
            // whitespace-nowrap：整块文案是一个语义单元，中点分隔时不应被拆断
            className="flex items-center gap-3 whitespace-nowrap"
          >
            {index > 0 && (
              <span aria-hidden className="text-[#B4BDC9]">
                ·
              </span>
            )}
            {item.trim()}
          </span>
        ))}
      </p>

      <ul className="mt-10 grid w-full max-w-[640px] grid-cols-1 gap-5 sm:mt-12 sm:grid-cols-3">
        {highlights.map(({ icon: Icon, title, desc }) => (
          <li
            key={title}
            className="flex min-w-0 flex-col items-center gap-3 rounded-2xl border border-[#E7ECF3] bg-white px-4 py-7 text-center shadow-[0_1px_2px_rgba(16,42,84,0.04)]"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#EEF4FD] text-[#1B6DD6]">
              <Icon className="size-5" strokeWidth={2} />
            </span>
            <span className="text-[15px] font-semibold text-[#1B2431]">
              {title}
            </span>
            <span className="text-xs leading-relaxed text-[#8A93A2]">
              {desc}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 顶栏右侧的「开发环境」「中英文切换」「帮助中心」入口。 */
export function TopBarMeta({
  envLabel,
  helpLabel,
  helpHref,
  className,
}: {
  envLabel: string;
  helpLabel: string;
  helpHref?: string;
  className?: string;
}) {
  // useTranslation 会让组件在语言切换后重新渲染，isZh 随之更新。
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');
  // 与站内 header 保持同一套语义：按钮显示「当前语言」，点击切到另一种。
  // 旧实现显示的是「切换目标」——英文页上写「中文」，与登录后 header 里的
  // 「简体中文」正好相反，看起来就像显示反了。
  const currentLabel =
    (LanguageAbbreviationMap as Record<string, string>)[i18n.language] ??
    i18n.language;
  const targetLanguage = isZh ? LanguageAbbreviation.En : LanguageAbbreviation.Zh;
  const targetLabel = LanguageAbbreviationMap[targetLanguage];

  return (
    <div className={cn('flex shrink-0 items-center gap-4 sm:gap-6', className)}>
      <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[#EEF4FD] px-3.5 py-1.5 text-[13px] font-medium text-[#1B6DD6]">
        <Languages className="size-3.5 shrink-0" strokeWidth={2} />
        {envLabel}
      </span>
      <button
        type="button"
        onClick={() => void changeLanguageAsync(targetLanguage)}
        // 标签显示当前语言，title/aria-label 说明点击后会发生什么，
        // 避免"点了才知道切到哪"的歧义。
        title={`切换为${targetLabel}`}
        aria-label={`切换为${targetLabel}`}
        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-[#5A6474] transition-colors hover:text-[#1B6DD6]"
      >
        <Globe className="size-3.5 shrink-0" strokeWidth={2} />
        {currentLabel}
      </button>
      <a
        href={helpHref}
        onClick={(event) => {
          // 暂未提供帮助中心地址，避免跳转到无效链接
          if (!helpHref) event.preventDefault();
        }}
        target={helpHref ? '_blank' : undefined}
        rel={helpHref ? 'noreferrer noopener' : undefined}
        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-[#5A6474] transition-colors hover:text-[#1B6DD6]"
      >
        <Headphones className="size-3.5 shrink-0" strokeWidth={2} />
        {helpLabel}
      </a>
    </div>
  );
}
