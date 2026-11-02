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

export type FilterType = {
  id: string;
  label: string;
  count: number;
};

export function groupListByType<T extends Record<string, any>>(
  list: T[],
  idField: string,
  labelField: string,
) {
  const fileTypeList: FilterType[] = [];
  if (Array.isArray(list)) {
    list.forEach((x) => {
      const item = fileTypeList.find((y) => y.id === x[idField]);
      if (!item) {
        fileTypeList.push({ id: x[idField], label: x[labelField], count: 1 });
      } else {
        item.count += 1;
      }
    });
  }

  return fileTypeList;
}

export function groupListByArray<T extends Record<string, any>>(
  list: T[],
  idField: string,
) {
  const fileTypeList: FilterType[] = [];
  list.forEach((x) => {
    if (Array.isArray(x[idField])) {
      x[idField].forEach((j) => {
        const item = fileTypeList.find((i) => i.id === j);
        if (!item) {
          fileTypeList.push({ id: j, label: j, count: 1 });
        } else {
          item.count += 1;
        }
      });
    }
  });

  return fileTypeList;
}

export function buildOwnersFilter<T extends Record<string, any>>(
  list: T[],
  nickName?: string,
  label?: string,
  // 归属 id 取哪一列：知识搜索按租户分组，知识问答按创建人分组。
  // 必须和列表的 owner 列取自同一字段，否则筛选结果和表格对不上。
  ownerField = 'tenant_id',
) {
  const owners = groupListByType(list, ownerField, nickName || 'nickname');

  return { field: 'owner', list: owners, label: label ?? 'Owner' };
}
