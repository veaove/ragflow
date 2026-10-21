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

import { useTranslation } from 'react-i18next';

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs-underlined';
import { PageContainer } from '@/layouts/components/page-container';
import { ConsultationsPanel } from '@/pages/analytics/consultations';
import { AnalyticsStatsPanel } from '@/pages/analytics/stats';

import { Applications } from './applications';
import { NextBanner } from './banner';
import { Datasets } from './datasets';

// The home page hosts three sheets: the original landing content, the report
// dashboard and the consultation log. The analytics panels are the same
// components their standalone routes render, so both entry points stay in sync.
const TAB_TRIGGER_CLASS =
  'h-10 flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-4 text-sm font-normal shadow-none data-[state=active]:border-text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none';

const Home = () => {
  const { t } = useTranslation();

  return (
    <PageContainer>
      <Tabs defaultValue="home" className="gap-6">
        <TabsList className="h-10 w-fit gap-1 rounded-none border-b border-border-default bg-transparent p-0">
          <TabsTrigger value="home" className={TAB_TRIGGER_CLASS}>
            {t('header.home')}
          </TabsTrigger>
          <TabsTrigger value="stats" className={TAB_TRIGGER_CLASS}>
            {t('analytics.report')}
          </TabsTrigger>
          <TabsTrigger value="consultations" className={TAB_TRIGGER_CLASS}>
            {t('analytics.consultationLog')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="home">
          <article>
            <header className="mb-8">
              <NextBanner />
            </header>

            <Datasets />
            <Applications />
          </article>
        </TabsContent>

        <TabsContent value="stats">
          <AnalyticsStatsPanel embedded />
        </TabsContent>

        <TabsContent value="consultations">
          <ConsultationsPanel embedded />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
};

export default Home;
