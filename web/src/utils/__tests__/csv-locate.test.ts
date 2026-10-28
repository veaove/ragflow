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

import { resolveCsvLocate } from '../csv-locate';

describe('resolveCsvLocate', () => {
  it('maps the real table-parser range to the first data row', () => {
    // `财务数据长表_2025Q3.csv` chunk: page 1, physical row 2, columns 1-6.
    // Row 2 is the first row below the header, so it lands on index 0.
    expect(resolveCsvLocate([[1, 2, 2, 1, 6]])).toEqual({
      rowStart: 0,
      rowEnd: 0,
      colStart: 0,
      colEnd: 5,
    });
  });

  it('keeps a multi-row range offset by the header row', () => {
    // Physical rows 3-5 are data rows 2-4 once the header is sliced off.
    expect(resolveCsvLocate([[1, 3, 5, 2, 4]])).toEqual({
      rowStart: 1,
      rowEnd: 3,
      colStart: 1,
      colEnd: 3,
    });
  });

  it('degrades a header-only range to the first data row', () => {
    // Row 1 is the header, which `data.rows` does not contain. Highlighting
    // the first data row is a better failure mode than highlighting nothing.
    expect(resolveCsvLocate([[1, 1, 2, 1, 3]])).toEqual({
      rowStart: 0,
      rowEnd: 0,
      colStart: 0,
      colEnd: 2,
    });
  });

  it('clamps zero or missing bounds to the range start', () => {
    expect(resolveCsvLocate([[1, 0, 0, 0, 0]])).toEqual({
      rowStart: 0,
      rowEnd: 0,
      colStart: 0,
      colEnd: 0,
    });
    expect(resolveCsvLocate([[1, 4, 0, 0, 0]])).toEqual({
      rowStart: 2,
      rowEnd: 2,
      colStart: 0,
      colEnd: 0,
    });
  });

  it('returns null when there is no usable position', () => {
    expect(resolveCsvLocate(undefined)).toBeNull();
    expect(resolveCsvLocate([])).toBeNull();
    expect(resolveCsvLocate([[]])).toBeNull();
    // Legacy four-element positions (page + x/y box) cannot address a cell.
    expect(resolveCsvLocate([[1, 2, 2, 1]])).toBeNull();
  });
});
