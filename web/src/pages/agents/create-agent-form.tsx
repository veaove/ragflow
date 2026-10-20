'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { isEmpty } from 'lodash';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { KnowledgeBaseFormField } from '@/components/knowledge-base-item';
import { ModelTreeSelectFormField } from '@/components/model-tree-select';
import { MemoriesFormField } from '@/components/memories-form-field';
import { RAGFlowFormItem } from '@/components/ragflow-form';
import { Button, ButtonLoading } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DialogFooter } from '@/components/ui/dialog';
import { Form } from '@/components/ui/form';
import { TagRenameId } from '@/constants/knowledge';
import { IModalProps } from '@/interfaces/common';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FlowType, FlowTypeConfig } from './constant';
import { NameFormField, NameFormSchema } from './name-form-field';
import {
  ModelBindingCount,
  RetrievalBindings,
} from './template-retrieval-binding';

export type CreateAgentFormProps = IModalProps<any> & {
  loading?: boolean;
  showTypeCards?: boolean;
  // Templates may ship retrieval steps without any dataset/memory bound. When
  // set, the form asks the user to bind them before creating the agent, so
  // the canvas never ends up with a retrieval that fails at runtime.
  retrievalBindings?: RetrievalBindings;
  modelBindings?: ModelBindingCount;
};

type FlowTypeCardProps = {
  value?: FlowType;
  onChange?: (value: FlowType) => void;
};

function FlowTypeCards({ value, onChange }: FlowTypeCardProps) {
  const { t } = useTranslation();
  const handleChange = useCallback(
    (value: FlowType) => () => {
      onChange?.(value);
    },
    [onChange],
  );

  return (
    <section className="flex gap-10">
      // 只保留两个原生项（产品文档 6.1 定稿）：Chatflow / Workflow 已迁到
      // 「工作室」模块独立入口，编译算子移到列表页 + 下拉。弹窗回到原生比例，
      // 中文标签不再被四个卡片挤压换行。
      {[FlowType.Agent, FlowType.Flow].map((val) => {
        const isActive = value === val;
        const config = FlowTypeConfig[val];
        const Icon = config.icon;
        return (
          <Card
            key={val}
            className={cn('flex-1 rounded-lg  border bg-transparent', {
              'border-text-primary': isActive,
              'border-border-default': !isActive,
            })}
          >
            <CardContent
              onClick={handleChange(val)}
              className={cn(
                'cursor-pointer p-5 text-text-secondary flex justify-between items-center',
                {
                  'text-text-primary': isActive,
                },
              )}
            >
              <div className="flex gap-2">
                <Icon className="size-6" />
                <p>{t(`flow.${config.labelKey}`)}</p>
              </div>
              {isActive && <Check />}
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}

export const FormSchema = z.object({
  ...NameFormSchema,
  tag: z.string().trim().optional(),
  description: z.string().trim().optional(),
  type: z.nativeEnum(FlowType).optional(),
  dataset_ids: z.array(z.string()).optional(),
  dataset_bindings: z.array(z.array(z.string())).optional(),
  memory_ids: z.array(z.string()).optional(),
  llm_id: z.string().optional(),
});

export type FormSchemaType = z.infer<typeof FormSchema>;

export function CreateAgentForm({
  hideModal,
  onOk,
  loading,
  showTypeCards = false,
  retrievalBindings,
  modelBindings,
}: CreateAgentFormProps) {
  const { t } = useTranslation();

  const form = useForm<FormSchemaType>({
    resolver: zodResolver(FormSchema),
    defaultValues: { name: '', type: FlowType.Agent },
  });

  const modelRequired = (modelBindings?.modelCount ?? 0) > 0;

  async function onSubmit(data: FormSchemaType) {
    if (modelRequired && !data.llm_id) {
      form.setError('llm_id', {
        type: 'manual',
        message: t('common.pleaseSelect'),
      });
      return;
    }
    const datasetBlocks = retrievalBindings?.datasetBlocks ?? [];
    if (datasetBlocks.length === 1 && isEmpty(data.dataset_ids)) {
      form.setError('dataset_ids', {
        type: 'manual',
        message: t('flow.retrievalDatasetRequired'),
      });
      return;
    }
    if (datasetBlocks.length > 1) {
      const missingIndex = datasetBlocks.findIndex((_, index) =>
        isEmpty(data.dataset_bindings?.[index]),
      );
      if (missingIndex >= 0) {
        form.setError(`dataset_bindings.${missingIndex}`, {
          type: 'manual',
          message: t('flow.retrievalDatasetRequired'),
        });
        return;
      }
    }
    if ((retrievalBindings?.memoryCount ?? 0) > 0 && isEmpty(data.memory_ids)) {
      form.setError('memory_ids', {
        type: 'manual',
        message: t('flow.retrievalMemoryRequired'),
      });
      return;
    }
    const ret = await onOk?.(data);
    if (ret) {
      hideModal?.();
    }
  }

  const datasetBlocks = retrievalBindings?.datasetBlocks ?? [];
  const datasetHint =
    datasetBlocks.length === 1
      ? t('flow.retrievalTemplateDatasetHint', {
          num: 1,
        })
      : undefined;
  const memoryHint = retrievalBindings?.memoryCount
    ? t('flow.retrievalTemplateMemoryHint', {
        num: retrievalBindings.memoryCount,
      })
    : undefined;

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-6"
        id={TagRenameId}
      >
        {showTypeCards && (
          <RAGFlowFormItem
            required
            name="type"
            label={t('flow.chooseAgentType')}
          >
            <FlowTypeCards></FlowTypeCards>
          </RAGFlowFormItem>
        )}
        <NameFormField></NameFormField>
        {modelRequired && (
          <ModelTreeSelectFormField
            name="llm_id"
            label={t('chat.model')}
            modelTypes={modelBindings?.modelTypes}
            required
          />
        )}
        {datasetBlocks.length === 1 && (
          <section className="space-y-4">
            <p className="text-sm text-text-secondary">{datasetHint}</p>
            <KnowledgeBaseFormField required showVariable={false} />
          </section>
        )}
        {datasetBlocks.length > 1 && (
          <section className="space-y-4">
            {datasetBlocks.map((block, index) => (
              <KnowledgeBaseFormField
                key={block.blockId}
                required
                showVariable={false}
                name={`dataset_bindings.${index}`}
                label={block.displayName}
              />
            ))}
          </section>
        )}
        {memoryHint && (
          <section className="space-y-4">
            <p className="text-sm text-text-secondary">{memoryHint}</p>
            <MemoriesFormField label={t('header.memories')} required />
          </section>
        )}
      </form>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={hideModal}
          data-testid="agent-cancel"
        >
          {t('common.cancel')}
        </Button>
        <ButtonLoading
          data-testid="agent-save"
          type="submit"
          form={TagRenameId}
          loading={loading}
        >
          {t('common.confirm')}
        </ButtonLoading>
      </DialogFooter>
    </Form>
  );
}
