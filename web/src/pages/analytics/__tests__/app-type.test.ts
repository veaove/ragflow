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

import { APP_TYPE_LABEL_KEYS, appTypeLabelKey } from '../app-type';

/**
 * The consultation log shows the application type next to the application
 * name. The backend reports the raw type; this maps it to a label.
 *
 * A pure-function test on purpose: importing the panel would pull in the
 * router (routes.tsx calls createBrowserRouter() at module scope), which
 * needs a Request that the node test environment does not have.
 */
describe('appTypeLabelKey', () => {
  it('maps every known application type to its own label', () => {
    const keys = Object.values(APP_TYPE_LABEL_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
    expect(appTypeLabelKey('chat')).toBe('analytics.appTypeChat');
    expect(appTypeLabelKey('search')).toBe('analytics.appTypeSearch');
    expect(appTypeLabelKey('evaluation')).toBe('analytics.appTypeEvaluation');
    expect(appTypeLabelKey('agent_canvas')).toBe('analytics.appTypeAgent');
    expect(appTypeLabelKey('chatflow_canvas')).toBe(
      'analytics.appTypeChatflow',
    );
    expect(appTypeLabelKey('workflow_canvas')).toBe(
      'analytics.appTypeWorkflow',
    );
    expect(appTypeLabelKey('dataflow_canvas')).toBe(
      'analytics.appTypeDataflow',
    );
  });

  it('falls back to the unknown label for a missing or unrecognised type', () => {
    expect(appTypeLabelKey('')).toBe('analytics.appTypeUnknown');
    expect(appTypeLabelKey(undefined)).toBe('analytics.appTypeUnknown');
    expect(appTypeLabelKey('something_new')).toBe('analytics.appTypeUnknown');
  });
});
