import { searchStatusLabelKey } from '../search-status';

/**
 * 知识搜索列表的「状态」列曾经直接把库里的 "1" 渲染出来，用户看不懂。
 * 这条用例钉住「只给 i18n key、不给原始值」的契约。
 */
describe('searchStatusLabelKey', () => {
  it('maps the raw database status to a translatable label', () => {
    expect(searchStatusLabelKey('1')).toBe('common.statusActive');
    expect(searchStatusLabelKey('0')).toBe('common.statusInactive');
  });

  it('returns undefined instead of leaking a raw value or key name', () => {
    expect(searchStatusLabelKey(undefined)).toBeUndefined();
    expect(searchStatusLabelKey('')).toBeUndefined();
    expect(searchStatusLabelKey('2')).toBeUndefined();
  });
});
