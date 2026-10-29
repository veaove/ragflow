import {
  IReferenceChunk,
  UploadResponseDataType,
} from '@/interfaces/database/chat';
import { IDocumentInfo } from '@/interfaces/database/document';
import { aggregateReferenceDocs, getFileMimeType, isImageFile } from '../utils';

describe('getFileMimeType', () => {
  it('uses the browser-provided type for local File objects', () => {
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    expect(getFileMimeType(file)).toBe('image/png');
  });

  it('reads mime_type from uploaded file metadata', () => {
    const file = {
      name: 'photo.webp',
      mime_type: 'image/webp',
    } as UploadResponseDataType;
    expect(getFileMimeType(file)).toBe('image/webp');
  });

  it('returns an empty string when no MIME metadata exists', () => {
    const file = { name: 'scan.png' } as IDocumentInfo;
    expect(getFileMimeType(file)).toBe('');
  });
});

describe('isImageFile', () => {
  it('detects images by MIME type', () => {
    const file = new File(['x'], 'photo', { type: 'image/png' });
    expect(isImageFile(file)).toBe(true);
  });

  it('falls back to the filename extension when MIME metadata is missing', () => {
    const file = new File(['x'], 'photo.png', { type: '' });
    expect(isImageFile(file)).toBe(true);
  });

  it('matches extensions case-insensitively', () => {
    const file = { name: 'diagram.SVG' } as IDocumentInfo;
    expect(isImageFile(file)).toBe(true);
  });

  it('detects uploaded files through their mime_type', () => {
    const file = {
      name: 'photo.avif',
      mime_type: 'image/avif',
    } as UploadResponseDataType;
    expect(isImageFile(file)).toBe(true);
  });

  it('lets explicit MIME metadata win over the filename extension', () => {
    const file = {
      name: 'fake.png',
      mime_type: 'application/pdf',
    } as UploadResponseDataType;
    expect(isImageFile(file)).toBe(false);
  });

  it('passes non-image files through as non-image', () => {
    expect(
      isImageFile(new File(['x'], 'notes.txt', { type: 'text/plain' })),
    ).toBe(false);
    expect(isImageFile({ name: 'report.docx' } as IDocumentInfo)).toBe(false);
    expect(isImageFile(new File(['x'], 'archive.bin', { type: '' }))).toBe(
      false,
    );
  });
});

describe('aggregateReferenceDocs', () => {
  const chunk = (documentId: string, documentName: string, id: string) =>
    ({
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
    }) as IReferenceChunk;

  it('groups the chunks of one document under a single entry', () => {
    const docs = aggregateReferenceDocs([
      chunk('doc-1', '公司概览.md', 'c1'),
      chunk('doc-1', '公司概览.md', 'c2'),
      chunk('doc-2', '联系我们.md', 'c3'),
    ]);

    expect(docs).toEqual([
      { count: 2, doc_id: 'doc-1', doc_name: '公司概览.md' },
      { count: 1, doc_id: 'doc-2', doc_name: '联系我们.md' },
    ]);
  });

  it('accepts the keyed shape an agent message ships', () => {
    const docs = aggregateReferenceDocs({
      '498309038b007c6e': chunk('doc-1', '公司概览.md', 'c1'),
    });

    expect(docs).toEqual([
      { count: 1, doc_id: 'doc-1', doc_name: '公司概览.md' },
    ]);
  });

  it('drops chunks that lost their document reference', () => {
    expect(aggregateReferenceDocs([chunk('', '', 'c1')])).toEqual([]);
  });

  it('returns an empty list for a run without a reference', () => {
    expect(aggregateReferenceDocs(undefined)).toEqual([]);
  });
});
