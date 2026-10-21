import { IDialog } from '@/interfaces/database/chat';
import {
  EMPTY_LABEL,
  NO_KNOWLEDGE_BASE_LABEL,
  formatKnowledgeBaseCell,
  getKnowledgeBaseNames,
} from '../chat-labels';

// 知识库列的口径：接口成对返回 dataset_ids / kb_names（同一循环内同时 append），
// 展示层按下标换成名称；名称缺失按产品要求兜底 "-"，一个都没有才显示「未关联」。
describe('getKnowledgeBaseNames', () => {
  const row = (dataset_ids: string[], kb_names: string[]) =>
    ({ dataset_ids, kb_names }) as Pick<IDialog, 'dataset_ids' | 'kb_names'>;

  test('按 dataset_ids 的下标取对应名称，顺序保持不变', () => {
    expect(
      getKnowledgeBaseNames(row(['kb-1', 'kb-2'], ['财报知识库', '制度库'])),
    ).toEqual(['财报知识库', '制度库']);
  });

  test('某个 id 没有对应名称时兜底 "-"，绝不回显 id', () => {
    expect(getKnowledgeBaseNames(row(['kb-1', 'kb-2'], ['财报知识库']))).toEqual([
      '财报知识库',
      EMPTY_LABEL,
    ]);
  });

  test('没有关联知识库时返回空数组，由调用方展示「未关联」', () => {
    expect(getKnowledgeBaseNames(row([], []))).toEqual([]);
  });

  test('只有名称没有 id 的旧响应形状照常展示', () => {
    expect(getKnowledgeBaseNames(row([], ['财报知识库']))).toEqual([
      '财报知识库',
    ]);
  });

  test('字段缺失（undefined）不崩', () => {
    expect(
      getKnowledgeBaseNames(
        {} as Pick<IDialog, 'dataset_ids' | 'kb_names'>,
      ),
    ).toEqual([]);
  });
});

describe('formatKnowledgeBaseCell', () => {
  test('未关联时给固定文案，不带 title', () => {
    expect(formatKnowledgeBaseCell([])).toEqual({
      text: NO_KNOWLEDGE_BASE_LABEL,
    });
  });

  test('一两个名称全量平铺', () => {
    expect(formatKnowledgeBaseCell(['A'])).toEqual({ text: 'A', title: 'A' });
    expect(formatKnowledgeBaseCell(['A', 'B'])).toEqual({
      text: 'A、B',
      title: 'A、B',
    });
  });

  test('超过两个收成「等 N 个」，完整列表留在 title 里', () => {
    expect(formatKnowledgeBaseCell(['A', 'B', 'C'])).toEqual({
      text: 'A、B 等 3 个',
      title: 'A、B、C',
    });
  });
});
