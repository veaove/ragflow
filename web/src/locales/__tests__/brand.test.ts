import en from '../en';
import zhTraditional from '../zh-traditional';
import zh from '../zh';

/**
 * 界面上只允许出现白标名「和君知识库」。
 *
 * 上游项目的名字会从三处漏出来：这段文案照抄上游、从上游 doc 里复制示例、
 * 以及个别 key 被品牌名覆盖（`translation.title` 曾经就是 'RAGFlow'，
 * 智能体设置里的「标题」字段因此显示成品牌名）。这里把三语字典整体扫一遍，
 * 任何一个值里出现上游名就让测试失败。
 */
const UPSTREAM_NAME = /ragflow/i;

function collectHits(value: unknown, path: string[] = []): string[] {
  if (typeof value === 'string') {
    return UPSTREAM_NAME.test(value) ? [path.join('.')] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectHits(item, [...path, String(index)]));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
      collectHits(item, [...path, key]),
    );
  }
  return [];
}

describe.each([
  { name: 'zh', copy: zh },
  { name: 'zh-traditional', copy: zhTraditional },
  { name: 'en', copy: en },
])('$name locale', ({ copy }) => {
  it('contains no upstream product name', () => {
    expect(collectHits(copy)).toEqual([]);
  });
});
