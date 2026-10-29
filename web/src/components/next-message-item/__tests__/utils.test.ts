import {
  IReferenceChunk,
  UploadResponseDataType,
} from '@/interfaces/database/chat';
import { IDocumentInfo } from '@/interfaces/database/document';
import {
  buildReferenceImages,
  getFileMimeType,
  isImageFile,
} from '../utils';

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

describe('buildReferenceImages', () => {
  const chunk = (
    id: string,
    documentId: string,
    documentName: string,
    imageId = '',
  ) =>
    ({
      id,
      content: 'x',
      document_id: documentId,
      document_name: documentName,
      dataset_id: 'kb-1',
      image_id: imageId,
      similarity: 0.5,
      vector_similarity: 0.5,
      term_similarity: 0.5,
      positions: [],
    }) as IReferenceChunk;

  const chunks = [
    chunk('c1', 'doc-1', '公司概览.md', 'img-1'),
    chunk('c2', 'doc-2', '高效服务.md'),
    chunk('c3', 'doc-3', '投研体系.md', 'img-3'),
  ];

  it('maps every citation marker to the picture of the chunk it points at', () => {
    const images = buildReferenceImages(
      chunks,
      '成立于1998年 [ID:c1]，投研体系完备 [ID:c3]。',
    );

    expect(images).toEqual([
      {
        key: 'c1',
        imageId: 'img-1',
        documentId: 'doc-1',
        documentName: '公司概览.md',
        index: 0,
        label: '[1]',
      },
      {
        key: 'c3',
        imageId: 'img-3',
        documentId: 'doc-3',
        documentName: '投研体系.md',
        index: 1,
        label: '[2]',
      },
    ]);
  });

  it('keeps the original numbering for positional chat markers', () => {
    const images = buildReferenceImages(chunks, '答案如下 [0]。');

    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      key: '0',
      documentId: 'doc-1',
      label: '[1]',
    });
  });

  it('skips a cited chunk that carries no picture', () => {
    expect(buildReferenceImages(chunks, '见 [ID:c2]。')).toEqual([]);
  });

  it('draws nothing when the answer cites nothing', () => {
    expect(buildReferenceImages(chunks, '华夏基金成立于1998年。')).toEqual([]);
    expect(buildReferenceImages(undefined, '您好，请讲。')).toEqual([]);
  });
});
