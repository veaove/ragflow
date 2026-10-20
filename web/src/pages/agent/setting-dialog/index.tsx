import { ButtonLoading } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSetAgent } from '@/hooks/use-agent-request';
import { IModalProps } from '@/interfaces/common';
import { QcRuleSelector } from '@/pages/qc/rule-selector';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import {
  AgentSettingId,
  SettingForm,
  SettingFormSchemaType,
} from './setting-form';

export function SettingDialog({ hideModal }: IModalProps<any>) {
  const { t } = useTranslation();
  const { setAgent } = useSetAgent();
  const { id } = useParams();
  const [tab, setTab] = useState<'basic' | 'qc'>('basic');

  const submit = useCallback(
    async (values: SettingFormSchemaType) => {
      const ret = await setAgent(values);
      if (ret?.code === 0) {
        hideModal?.();
      }
    },
    [hideModal, setAgent],
  );

  return (
    <Dialog open onOpenChange={hideModal}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('common.edit')}</DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'basic' | 'qc')}>
          <TabsList>
            <TabsTrigger value="basic">{t('flow.settings.basic')}</TabsTrigger>
            <TabsTrigger value="qc">{t('flow.settings.qcRules')}</TabsTrigger>
          </TabsList>
          <TabsContent value="basic">
            <SettingForm submit={submit}></SettingForm>
          </TabsContent>
          <TabsContent value="qc" className="max-h-[60vh] overflow-y-auto">
            <QcRuleSelector appType="canvas" appId={id ?? ''} />
          </TabsContent>
        </Tabs>
        {tab === 'basic' && (
          <DialogFooter>
            <ButtonLoading type="submit" form={AgentSettingId} loading={false}>
              {t('common.save')}
            </ButtonLoading>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
