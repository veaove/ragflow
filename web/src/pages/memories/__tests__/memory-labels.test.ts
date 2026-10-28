import { memoryTypeLabelKey, storageTypeLabelKey } from '../memory-labels';

/**
 * 记忆列表的「记忆类型 / 存储类型」列和筛选器都吃后端的原始枚举
 * （raw / semantic / table / graph），中文界面会直接摆出英文。
 * 这两条用例钉住「枚举 → i18n key」的映射，以及未知枚举不外泄原始值。
 */
describe('memoryTypeLabelKey', () => {
  it('maps every bit-flag name to a translatable label', () => {
    expect(memoryTypeLabelKey('raw')).toBe('memories.raw');
    expect(memoryTypeLabelKey('semantic')).toBe('memories.semantic');
    expect(memoryTypeLabelKey('episodic')).toBe('memories.episodic');
    expect(memoryTypeLabelKey('procedural')).toBe('memories.procedural');
  });

  it('returns undefined instead of leaking a raw value or key name', () => {
    expect(memoryTypeLabelKey(undefined)).toBeUndefined();
    expect(memoryTypeLabelKey('')).toBeUndefined();
    expect(memoryTypeLabelKey('summary')).toBeUndefined();
  });
});

describe('storageTypeLabelKey', () => {
  it('maps the storage backend to a translatable label', () => {
    expect(storageTypeLabelKey('table')).toBe('memories.storageTable');
    expect(storageTypeLabelKey('graph')).toBe('memories.storageGraph');
  });

  it('returns undefined instead of leaking a raw value or key name', () => {
    expect(storageTypeLabelKey(undefined)).toBeUndefined();
    expect(storageTypeLabelKey('')).toBeUndefined();
    expect(storageTypeLabelKey('vector')).toBeUndefined();
  });
});
