import {
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  clampColumnWidth,
  columnWidthsStorageKey,
  parseStoredColumnWidths,
  serializeColumnWidths,
} from '../table-resize';

describe('clampColumnWidth', () => {
  it('keeps a width inside the usable range', () => {
    expect(clampColumnWidth(180)).toBe(180);
  });

  it('never shrinks a column past the point where its header fits', () => {
    expect(clampColumnWidth(10)).toBe(MIN_COLUMN_WIDTH);
    expect(clampColumnWidth(-40)).toBe(MIN_COLUMN_WIDTH);
  });

  it('caps runaway drags so one column cannot blow up the table', () => {
    expect(clampColumnWidth(99999)).toBe(MAX_COLUMN_WIDTH);
  });

  it('rounds sub-pixel widths and survives NaN', () => {
    expect(clampColumnWidth(120.6)).toBe(121);
    expect(clampColumnWidth(Number.NaN)).toBe(MIN_COLUMN_WIDTH);
  });
});

describe('columnWidthsStorageKey', () => {
  it('distinguishes tables by their headers, not by page alone', () => {
    const first = columnWidthsStorageKey('/qc', ['规则名称', '状态']);
    const second = columnWidthsStorageKey('/qc', ['会话', '命中时间']);

    expect(first).not.toBe(second);
  });

  it('normalises whitespace so reformatting a header keeps stored widths', () => {
    expect(columnWidthsStorageKey('/x', ['  任务\n  ID '])).toBe(
      columnWidthsStorageKey('/x', ['任务 ID']),
    );
  });

  it('scopes the key to the route', () => {
    expect(columnWidthsStorageKey('/a', ['H'])).not.toBe(
      columnWidthsStorageKey('/b', ['H']),
    );
  });
});

describe('parseStoredColumnWidths', () => {
  it('round-trips serialized widths', () => {
    const widths = [120, null, 240];

    expect(
      parseStoredColumnWidths(serializeColumnWidths(widths), widths.length),
    ).toEqual(widths);
  });

  it('drops the whole record when the column count changed', () => {
    // 列增删过再套旧宽度会错位，宁可全部重来。
    expect(parseStoredColumnWidths('[120,240]', 3)).toBeNull();
  });

  it('ignores corrupt or non-array payloads', () => {
    expect(parseStoredColumnWidths('not json', 2)).toBeNull();
    expect(parseStoredColumnWidths('{"0":120}', 2)).toBeNull();
    expect(parseStoredColumnWidths(null, 2)).toBeNull();
  });

  it('treats junk entries as untouched columns and clamps the rest', () => {
    expect(parseStoredColumnWidths('[10,"x",null,5000]', 4)).toEqual([
      MIN_COLUMN_WIDTH,
      null,
      null,
      MAX_COLUMN_WIDTH,
    ]);
  });
});
