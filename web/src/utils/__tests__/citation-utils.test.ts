import type { IReferenceChunk } from '@/interfaces/database/chat';
import {
  buildCitationDisplayMap,
  citationMarkerReg,
  citationWholeMarkerReg,
  parseCitationIndex,
  resolveCitationChunk,
  stripCitationMarkers,
} from '../citation-utils';

const buildChunk = (id: string): IReferenceChunk => ({
  id,
  content: null,
  document_id: `doc-${id}`,
  document_name: `${id}.txt`,
  dataset_id: 'kb-1',
  image_id: '',
  similarity: 1,
  vector_similarity: 1,
  term_similarity: 1,
  positions: [],
});

const HappyPrince = buildChunk('a2d067519c9e0db1');
const Nightingale = buildChunk('b3e178620da1fc42');

describe('parseCitationIndex', () => {
  it('parses numeric markers as numbers', () => {
    expect(parseCitationIndex('[ID:2]')).toBe(2);
    expect(parseCitationIndex('[3]')).toBe(3);
  });

  it('parses hex chunk-id markers as strings', () => {
    expect(parseCitationIndex('[ID:a2d067519c9e0db1]')).toBe(
      'a2d067519c9e0db1',
    );
  });

  it('parses the full-width markers Chinese models emit', () => {
    expect(parseCitationIndex('【来源：IDa2d067519c9e0db1】')).toBe(
      'a2d067519c9e0db1',
    );
    expect(parseCitationIndex('【ID:2】')).toBe(2);
    expect(parseCitationIndex('【source: b3e178620da1fc42】')).toBe(
      'b3e178620da1fc42',
    );
  });

  it('does not treat an ordinary Chinese bracket as a marker', () => {
    expect(parseCitationIndex('【2024】')).toBeNaN();
  });
});

describe('citationMarkerReg', () => {
  it('matches both marker spellings and strips the whole marker', () => {
    const text = '甲[ID:a2d067519c9e0db1]乙【来源：IDb3e178620da1fc42】丙';
    expect(text.match(citationMarkerReg)).toEqual([
      '[ID:a2d067519c9e0db1]',
      '【来源：IDb3e178620da1fc42】',
    ]);
    expect(text.replace(citationMarkerReg, '')).toBe('甲乙丙');
  });

  it('leaves a plain Chinese bracket alone', () => {
    expect('【2024】'.match(citationMarkerReg)).toBeNull();
  });
});

describe('citationWholeMarkerReg', () => {
  it('captures the whole marker for react-string-replace', () => {
    const text = '参考【来源：IDb3e178620da1fc42】';
    expect(text.match(citationWholeMarkerReg)?.[0]).toBe(
      '【来源：IDb3e178620da1fc42】',
    );
  });
});

describe('resolveCitationChunk', () => {
  // The payload ships in retrieval order: Happy Prince ranked first.
  const chunks = [HappyPrince, Nightingale];

  it('resolves a numeric key positionally', () => {
    expect(resolveCitationChunk(chunks, 0)).toBe(HappyPrince);
    expect(resolveCitationChunk(chunks, 1)).toBe(Nightingale);
  });

  it('returns undefined for an out-of-range numeric key', () => {
    expect(resolveCitationChunk(chunks, 5)).toBeUndefined();
  });

  it('resolves a chunk-id key by id, not by citation order', () => {
    // The answer cites Nightingale first; the chunk must still be the one
    // the marker names, not chunks[0] (the mis-citation regression).
    expect(resolveCitationChunk(chunks, 'b3e178620da1fc42')).toBe(Nightingale);
    expect(resolveCitationChunk(chunks, 'a2d067519c9e0db1')).toBe(HappyPrince);
  });

  it('falls back to chunk_id when the id field is absent', () => {
    const legacy = [
      { chunk_id: 'b3e178620da1fc42' } as unknown as IReferenceChunk,
    ];
    expect(resolveCitationChunk(legacy, 'b3e178620da1fc42')).toBe(legacy[0]);
  });

  it('returns undefined for an unknown chunk id instead of guessing positionally', () => {
    expect(resolveCitationChunk(chunks, 'ffffffffffffffff')).toBeUndefined();
  });

  it('resolves ids inside a Record-shaped payload', () => {
    const record = {
      a2d067519c9e0db1: HappyPrince,
      b3e178620da1fc42: Nightingale,
    };
    expect(resolveCitationChunk(record, 'b3e178620da1fc42')).toBe(Nightingale);
  });

  it('tolerates an empty payload', () => {
    expect(resolveCitationChunk(undefined, 0)).toBeUndefined();
    expect(resolveCitationChunk(null, 'a2d067519c9e0db1')).toBeUndefined();
  });
});

describe('buildCitationDisplayMap', () => {
  it('numbers unique markers by first occurrence, whatever their key', () => {
    const map = buildCitationDisplayMap(
      'nightingale [ID:b3e178620da1fc42] then happy prince [ID:a2d067519c9e0db1] again [ID:b3e178620da1fc42]',
    );
    expect(map.get('b3e178620da1fc42')).toBe(0);
    expect(map.get('a2d067519c9e0db1')).toBe(1);
    expect(map.size).toBe(2);
  });
});

describe('stripCitationMarkers', () => {
  it('drops agent [ID:…] markers so TTS does not read them out', () => {
    expect(
      stripCitationMarkers(
        '公司成立于1998年 [ID:498309038b007c6e]。热线 400-818-6666 [ID:7f21]。',
      ),
    ).toBe('公司成立于1998年。热线 400-818-6666。');
  });

  it('drops positional and full-width markers too', () => {
    expect(stripCitationMarkers('答案如下 [1][2]。')).toBe('答案如下。');
    expect(stripCitationMarkers('见资料【ID:0ab3】。')).toBe('见资料。');
  });

  it('leaves an answer without markers untouched', () => {
    expect(stripCitationMarkers('您好，请讲。')).toBe('您好，请讲。');
    expect(stripCitationMarkers('')).toBe('');
  });
});
