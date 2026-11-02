import {
  buildDatasetListFilterParams,
  buildDateRangeFilterValue,
  parseDateRangeFilterValue,
} from '@/utils/dataset-filter';

describe('buildDatasetListFilterParams', () => {
  it('leaves every dimension unset when nothing is filtered', () => {
    expect(buildDatasetListFilterParams()).toEqual({
      category: undefined,
      enabled: undefined,
      create_time_from: undefined,
      create_time_to: undefined,
      update_time_from: undefined,
      update_time_to: undefined,
    });
  });

  it('maps category, status and both date ranges onto query params', () => {
    expect(
      buildDatasetListFilterParams({
        category: ['产品资料', '合规制度'],
        status: ['disabled'],
        create_time: ['2026-01-01', '2026-01-31'],
        update_time: ['2026-02-01'],
      }),
    ).toEqual({
      category: ['产品资料', '合规制度'],
      enabled: false,
      create_time_from: '2026-01-01',
      create_time_to: '2026-01-31',
      update_time_from: '2026-02-01',
      update_time_to: undefined,
    });
  });

  it('treats "all" status and an empty category list as no filter', () => {
    const params = buildDatasetListFilterParams({
      status: ['all'],
      category: [],
    });

    expect(params.enabled).toBeUndefined();
    expect(params.category).toBeUndefined();
  });

  it('maps the enabled status to enabled=true', () => {
    expect(buildDatasetListFilterParams({ status: ['enabled'] }).enabled).toBe(
      true,
    );
  });
});

describe('buildDateRangeFilterValue', () => {
  it('keeps a single bound when only the start is picked', () => {
    expect(buildDateRangeFilterValue(new Date(2026, 0, 5))).toEqual([
      '2026-01-05',
    ]);
  });

  it('normalises a reversed range to [earlier, later]', () => {
    expect(
      buildDateRangeFilterValue(new Date(2026, 1, 1), new Date(2026, 0, 1)),
    ).toEqual(['2026-01-01', '2026-02-01']);
  });

  it('returns undefined without a start date', () => {
    expect(
      buildDateRangeFilterValue(undefined, new Date(2026, 0, 1)),
    ).toBeUndefined();
  });
});

describe('parseDateRangeFilterValue', () => {
  it('round-trips an applied range back into the picker', () => {
    const range = parseDateRangeFilterValue(['2026-01-01', '2026-01-31']);

    expect(range?.from.getFullYear()).toBe(2026);
    expect(range?.from.getMonth()).toBe(0);
    expect(range?.to?.getDate()).toBe(31);
  });

  it('ignores empty and malformed values', () => {
    expect(parseDateRangeFilterValue([])).toBeUndefined();
    expect(parseDateRangeFilterValue(['not-a-date'])).toBeUndefined();
  });
});
