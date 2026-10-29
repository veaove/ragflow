import { render, screen } from '@testing-library/react';
import { ReferenceFileList } from '../reference-file-list';

jest.mock('@/hooks/common-hooks', () => ({
  useTranslate: () => ({
    t: (key: string, options?: { num?: number }) =>
      `${key}#${options?.num ?? ''}`,
  }),
}));

jest.mock('../reference-document-list', () => ({
  ReferenceDocumentList: ({
    list,
  }: {
    list: { doc_name: string; count: number }[];
  }) => (
    <div data-testid="documents">
      {list.map((doc) => `${doc.doc_name}x${doc.count}`).join('|')}
    </div>
  ),
}));

// Mirrors IReferenceChunk field-for-field. The type is declared here rather than
// imported because this file carries jest.mock: those files are compiled through
// babel, which refuses an imported binding that is also used as a type.
type Chunk = {
  id: string;
  content: string;
  document_id: string;
  document_name: string;
  dataset_id: string;
  image_id: string;
  similarity: number;
  vector_similarity: number;
  term_similarity: number;
  positions: number[][];
};

const buildChunk = (
  id: string,
  documentId: string,
  documentName: string,
): Chunk => ({
  id,
  content: 'x',
  document_id: documentId,
  document_name: documentName,
  dataset_id: 'kb-1',
  image_id: '',
  similarity: 0.5,
  vector_similarity: 0.5,
  term_similarity: 0.5,
  positions: [],
});

const chunks = [
  buildChunk('c1', 'doc-1', '公司概览.md'),
  buildChunk('c2', 'doc-1', '公司概览.md'),
  buildChunk('c3', 'doc-2', '联系我们.md'),
];

describe('ReferenceFileList', () => {
  it('lists each hit document once, with its hit count', () => {
    render(<ReferenceFileList chunks={chunks} content="华夏基金成立于1998年。" />);

    expect(screen.getByTestId('documents').textContent).toBe(
      '公司概览.mdx2|联系我们.mdx1',
    );
    expect(screen.getByText('referenceFiles#2')).toBeTruthy();
  });

  it('stays hidden when the answer already cites its chunks by id', () => {
    render(
      <ReferenceFileList
        chunks={chunks}
        content="华夏基金成立于1998年 [ID:498309038b007c6e]。"
      />,
    );

    expect(screen.queryByTestId('documents')).toBeNull();
  });

  it('stays hidden when a chat answer cites chunks by position', () => {
    render(<ReferenceFileList chunks={chunks} content="答案如下 [1][2]。" />);

    expect(screen.queryByTestId('documents')).toBeNull();
  });

  it('renders nothing when the run retrieved no chunk', () => {
    render(<ReferenceFileList chunks={[]} content="您好，请讲。" />);

    expect(screen.queryByTestId('documents')).toBeNull();
  });
});
