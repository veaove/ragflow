import { render } from '@testing-library/react';
import { RehypeSanitizeAssistantMarkdown } from '@/constants/markdown-rehype-plugins';
import React from 'react';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';

import HighLightMarkdown from '..';

jest.mock('@/constants/markdown-remark-plugins', () => ({
  MarkdownRemarkPlugins: [],
}));

// 真实模块从 'hast-util-sanitize' 取 defaultSchema，那是纯 ESM 包，jest 默认
// 不转换 node_modules 会直接报 SyntaxError。给一个可识别的哨兵，用来断言组件
// 把它挂到了 rehypePlugins 上、且位置满足下面的顺序不变量。
jest.mock('@/constants/markdown-rehype-plugins', () => ({
  MarkdownSanitizeSchema: {},
  RehypeSanitizeAssistantMarkdown: ['__assistant-sanitize__', {}],
}));

// 真实清洗发生在 react-markdown 内部的 unified pipeline（rehype 插件链）里，
// 把 react-markdown 整体替换成假组件就等于把清洗也一起挖掉——那样断言「不安全
// HTML 没进 DOM」只能证明 mock 什么都没做。这里改为记录组件交给 pipeline 的
// props，直接锁住「先 rehype-raw、再 sanitize、最后 katex」这个顺序不变量。
const mockMarkdownProps: any[] = [];
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: (props: any) => {
    mockMarkdownProps.push(props);
    const ReactLib = jest.requireActual('react');
    return ReactLib.createElement('div', null, props.children);
  },
}));

jest.mock('react-syntax-highlighter', () => ({
  Prism: ({ children }: any) => {
    const react = jest.requireActual('react');
    return react.createElement('pre', null, children);
  },
}));

jest.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({
  oneDark: {},
  oneLight: {},
}));

jest.mock('rehype-katex', () => jest.fn());
jest.mock('rehype-raw', () => jest.fn());

jest.mock('../../theme-provider', () => ({
  useIsDarkTheme: () => false,
}));

const lastMarkdownProps = () => mockMarkdownProps[mockMarkdownProps.length - 1];

describe('HighLightMarkdown', () => {
  beforeEach(() => {
    mockMarkdownProps.length = 0;
  });

  it('runs the sanitize plugin after rehype-raw and before rehype-katex', () => {
    render(React.createElement(HighLightMarkdown, null, 'hello <b>safe</b>'));

    const { rehypePlugins } = lastMarkdownProps();
    // 顺序就是安全不变量：rehype-raw 先把原始 HTML 解析成真实节点，sanitize
    // 才有东西可清洗；katex 必须排在后面，否则它生成的大量标记会被 allow-list
    // 剥掉，公式直接消失。
    expect(rehypePlugins[0]).toBe(rehypeRaw);
    expect(rehypePlugins[1]).toBe(RehypeSanitizeAssistantMarkdown);
    expect(rehypePlugins[2]).toBe(rehypeKatex);
  });

  it('hands over the post-preprocessLaTeX string, not the raw entities', () => {
    // preprocessLaTeX() 会把 &lt;/&gt;/&amp; 解回真实 HTML，所以实体编码的
    // payload 只有清洗发生在它之后才拦得住——组件必须先做这一步再交给 pipeline。
    render(
      React.createElement(
        HighLightMarkdown,
        null,
        '&lt;img src=x onerror="alert(1)" /&gt;safe',
      ),
    );

    const { children } = lastMarkdownProps();
    expect(children).toContain('<img src=x onerror="alert(1)" />');
    expect(children).toContain('safe');
  });
});
