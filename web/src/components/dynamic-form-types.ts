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

/**
 * 表单字段类型的枚举单独放在这里，不跟 dynamic-form.tsx 放一起。
 *
 * 原因：provider-schema 的字段配置（generic-api-key-config 等）需要这份枚举，
 * 而 dynamic-form 组件链路又会反向依赖这些配置。枚举若留在组件文件里，就构成
 * 循环引用 —— ESM 打包时能容忍，但 Jest 的 CommonJS 转换会在模块求值前就读取，
 * 于是 `FormFieldType` 是 undefined，整个测试套件直接跑不起来。
 *
 * dynamic-form.tsx 仍然 re-export 这个枚举，历史上从那里导入的调用方不用改。
 */
export enum FormFieldType {
  Text = 'text',
  Email = 'email',
  Password = 'password',
  Number = 'number',
  Textarea = 'textarea',
  Select = 'select',
  MultiSelect = 'multi-select',
  Checkbox = 'checkbox',
  Switch = 'switch',
  Tag = 'tag',
  Segmented = 'segmented',
  Custom = 'custom',
}
