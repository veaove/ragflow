import { DataSourceKey, DOMESTIC_DATA_SOURCE_KEYS } from './constant';

export const getAvailableDataSourceKeys = (): DataSourceKey[] => [
  ...DOMESTIC_DATA_SOURCE_KEYS,
];
