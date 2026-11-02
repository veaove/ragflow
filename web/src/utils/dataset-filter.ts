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

import { FilterValue } from '@/components/list-filter-bar/interface';
import { IFetchKnowledgeListRequestParams } from '@/interfaces/request/knowledge';
import dayjs from 'dayjs';

/** 筛选条里各维度的 key。 */
export const DatasetCategoryFilter = 'category';
export const DatasetStatusFilter = 'status';
export const DatasetCreateTimeFilter = 'create_time';
export const DatasetUpdateTimeFilter = 'update_time';

/** 时间范围在 FilterValue 里存成 [起, 止]，任一端可缺省表示不设边界。 */
export type DatasetListFilterParams = Pick<
  IFetchKnowledgeListRequestParams,
  | 'category'
  | 'enabled'
  | 'create_time_from'
  | 'create_time_to'
  | 'update_time_from'
  | 'update_time_to'
>;

/** 与后端 *_from / *_to 约定一致：日期到分钟，接口另外接受秒与 ISO 写法。 */
const FilterDateFormat = 'YYYY-MM-DD';
const FilterDateTimeFormat = 'YYYY-MM-DD HH:mm';
/** 区间取整天：下界 00:00:00，上界 23:59:59。 */
const FilterDayStartTime = '00:00';
const FilterDayEndTime = '23:59:59';

const asStringList = (value?: FilterValue[string]): string[] =>
  Array.isArray(value) ? value : [];

const enabledFromStatus = (status?: string): boolean | undefined => {
  if (status === 'enabled') {
    return true;
  }
  if (status === 'disabled') {
    return false;
  }
  return undefined;
};

/**
 * 把列表筛选条的状态翻译成接口参数。
 *
 * 维度之间是 AND；未设置的维度不出现在结果里（undefined 会被 axios 丢掉），
 * 所以「全部」状态、空分类、没选时间都不会缩小结果集。
 */
export function buildDatasetListFilterParams(
  filterValue?: FilterValue,
): DatasetListFilterParams {
  const category = asStringList(filterValue?.[DatasetCategoryFilter]).filter(
    Boolean,
  );
  const status = asStringList(filterValue?.[DatasetStatusFilter])[0];
  const createTime = asStringList(
    filterValue?.[DatasetCreateTimeFilter],
  ).filter(Boolean);
  const updateTime = asStringList(
    filterValue?.[DatasetUpdateTimeFilter],
  ).filter(Boolean);

  return {
    category: category.length ? category : undefined,
    enabled: enabledFromStatus(status),
    create_time_from: createTime[0],
    create_time_to: createTime[1],
    update_time_from: updateTime[0],
    update_time_to: updateTime[1],
  };
}

/**
 * 日历范围 → 筛选值（`YYYY-MM-DD HH:mm` 起止）。
 *
 * 日历选的是"日"，接口要的是"时刻"，所以下界补 00:00、上界补 23:59:59：
 * 只发日期会让上界丢掉当天最后一分钟的数据。只选了一端时保留单值，后端按
 * 「从该天起」/「截止该天」处理，不会伪造结束时间。反向选择（起晚于止）统一
 * 成 [早, 晚]，否则后端会拒绝。
 */
export function buildDateRangeFilterValue(
  from?: Date,
  to?: Date,
): string[] | undefined {
  const [start, end] = from && to && from > to ? [to, from] : [from, to];
  if (!start) {
    return undefined;
  }
  const startValue = `${dayjs(start).format(FilterDateFormat)} ${FilterDayStartTime}`;
  if (!end) {
    return [startValue];
  }
  return [
    startValue,
    `${dayjs(end).format(FilterDateFormat)} ${FilterDayEndTime}`,
  ];
}

/** 控件里展示的时间：`YYYY-MM-DD HH:mm`，创建时间与更新时间共用。 */
export function formatFilterDateTime(date?: Date): string {
  return date ? dayjs(date).format(FilterDateTimeFormat) : '';
}

/** 筛选值（`YYYY-MM-DD HH:mm[:ss]` 起止）→ 日历的 DateRange，用于回填。 */
export function parseDateRangeFilterValue(
  value?: string[],
): { from: Date; to?: Date } | undefined {
  if (!value?.length || !value[0]) {
    return undefined;
  }
  const from = dayjs(value[0]);
  if (!from.isValid()) {
    return undefined;
  }
  const to = value[1] ? dayjs(value[1]) : undefined;
  return {
    from: from.toDate(),
    to: to?.isValid() ? to.toDate() : undefined,
  };
}
