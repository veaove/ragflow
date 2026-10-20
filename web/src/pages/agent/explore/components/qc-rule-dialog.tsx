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

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { IModalProps } from '@/interfaces/common';
import { QcRuleSelector } from '@/pages/qc/rule-selector';
import { useTranslation } from 'react-i18next';

interface QcRuleDialogProps {
  appId: string;
}

/**
 * 探索会话页的质检规则入口。
 *
 * 规则在画布编辑器的「管理 → 设置 → 质检规则」里也能配，但用户是在这个页面
 * 聊天的：答案被拦截或提示之后，想马上弄清「哪几条规则管这轮对话、要不要关
 * 掉」，不应该被要求先退回编辑器。
 *
 * 这里复用同一个 QcRuleSelector —— 勾选即落库即生效，没有第二份本地状态，
 * 所以从哪个入口进来看见的都是同一份选择。
 */
export function QcRuleDialog({
  hideModal,
  appId,
}: IModalProps<QcRuleDialogProps> & QcRuleDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open onOpenChange={hideModal}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('flow.settings.qcRules')}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          <QcRuleSelector appType="canvas" appId={appId} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default QcRuleDialog;
