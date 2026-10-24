export type DocumentIngestOption = {
  delete: boolean;
  apply_kb: boolean;
};

export type DocumentIngestPayload = {
  doc_ids: string[];
  run: number;
  delete?: boolean;
  apply_kb?: boolean;
};

export const buildDocumentIngestPayload = ({
  documentIds,
  run,
  option,
}: {
  documentIds: string[];
  run: number;
  option?: DocumentIngestOption;
}): DocumentIngestPayload => {
  const payload = {
    doc_ids: documentIds,
    run,
    ...(option || {}),
  };

  if (run !== 1) {
    return payload;
  }

  // A document's parser_config is a snapshot of the dataset config taken when
  // the file was uploaded, and the pipeline runs that snapshot. Without
  // apply_kb, dataset settings edited afterwards never reach existing files,
  // so a re-parse reproduces the old chunks (e.g. a whole audio transcript as
  // one chunk). Callers that must preserve a file's own settings opt out.
  return {
    ...payload,
    delete: true,
    apply_kb: option?.apply_kb ?? true,
  };
};
