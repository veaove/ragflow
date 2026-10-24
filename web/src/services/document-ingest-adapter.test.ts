import { buildDocumentIngestPayload } from './document-ingest-adapter';

describe('buildDocumentIngestPayload', () => {
  it('forces delete for a parse request', () => {
    expect(
      buildDocumentIngestPayload({
        documentIds: ['doc-1'],
        run: 1,
        option: { delete: false, apply_kb: true },
      }),
    ).toEqual({
      doc_ids: ['doc-1'],
      run: 1,
      delete: true,
      apply_kb: true,
    });
  });

  it('applies the dataset config when a parse request has no options', () => {
    expect(
      buildDocumentIngestPayload({ documentIds: ['doc-1'], run: 1 }),
    ).toEqual({ doc_ids: ['doc-1'], run: 1, delete: true, apply_kb: true });
  });

  it('honours an explicit opt-out of the dataset config', () => {
    expect(
      buildDocumentIngestPayload({
        documentIds: ['doc-1'],
        run: 1,
        option: { delete: true, apply_kb: false },
      }),
    ).toEqual({ doc_ids: ['doc-1'], run: 1, delete: true, apply_kb: false });
  });

  it('does not add delete or apply_kb to a cancel request', () => {
    expect(
      buildDocumentIngestPayload({ documentIds: ['doc-1'], run: 2 }),
    ).toEqual({ doc_ids: ['doc-1'], run: 2 });
  });
});
