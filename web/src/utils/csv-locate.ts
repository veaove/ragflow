/*
 *  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

/** 0-based row/column range over `CSVData.rows`, header row already excluded. */
export interface CsvLocateRange {
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
}

/**
 * Translate a citation position into a 0-based range over the CSV data rows.
 *
 * `positions` entries are `[page, rowStart, rowEnd, colStart, colEnd]`, all
 * 1-based, and the row numbers count *physical* CSV rows — row 1 is the header.
 * The viewer slices the header off (`rows.slice(1)`), so a physical row N maps
 * to index N - 2. That is one less than the xlsx case, where the spreadsheet
 * grid keeps its header at index 0 and the same conversion is N - 1.
 *
 * Only the first position is used: a CSV is a single logical page, so a chunk
 * carries one range. Ranges that start on the header have no data row of their
 * own and degrade to the first data row rather than highlighting nothing.
 */
export const resolveCsvLocate = (
  positions?: number[][],
): CsvLocateRange | null => {
  const pos = positions?.[0];
  if (!pos || pos.length < 5) return null;

  // Each fallback chain tolerates 0 / undefined entries by falling back to the
  // range start, which is the tightest valid range instead of a negative index.
  const rowStart = Math.max(0, (pos[1] || 1) - 2);
  const rowEnd = Math.max(rowStart, (pos[2] || pos[1] || 1) - 2);
  const colStart = Math.max(0, (pos[3] || 1) - 1);
  const colEnd = Math.max(colStart, (pos[4] || pos[3] || 1) - 1);

  return { rowStart, rowEnd, colStart, colEnd };
};
