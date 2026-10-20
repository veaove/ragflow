import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button, ButtonLoading } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RAGFlowFormItem } from '@/components/ragflow-form';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Check } from 'lucide-react';
import { MessageSquareText, Workflow } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AgentCategory } from '@/constants/agent';
import { useSetAgent } from '@/hooks/use-agent-request';
import { initialEmptyDsl } from '@/pages/agent/utils/dsl-bridge';

export type StudioCreateKind = 'chatflow' | 'workflow';

type Props = {
  /** 从类型卡进入时预选类型（产品文档第三节：点哪张建哪种）。 */
  initialType?: StudioCreateKind;
  hideModal: () => void;
};

const FormSchema = z.object({
  name: z.string().trim().min(1, '请输入名称'),
  description: z.string().trim().optional(),
  type: z.enum(['chatflow', 'workflow']),
});

type FormValues = z.infer<typeof FormSchema>;

const TYPE_META: Record<
  StudioCreateKind,
  { icon: typeof Workflow; category: AgentCategory }
> = {
  chatflow: { icon: MessageSquareText, category: AgentCategory.ChatflowCanvas },
  workflow: { icon: Workflow, category: AgentCategory.WorkflowCanvas },
};

/**
 * 工作室创建弹窗。
 *
 * 与「创建智能体」弹窗的差别（产品文档 4.2）：大卡片必须回答三个问题——
 * 它是什么、图长什么样、输出是什么，并给出适用场景；同时说明类型创建后
 * 不可更改，因为它决定可用节点、是否有会话、以及发布契约。
 */
export function CreateStudioDialog({ initialType = 'chatflow', hideModal }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { loading, setAgent } = useSetAgent();
  const [selected, setSelected] = useState<StudioCreateKind>(initialType);

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { name: '', description: '', type: initialType },
  });

  async function onSubmit(values: FormValues) {
    const meta = TYPE_META[selected];
    // chatflow 走 agent 形态的空图（有 Begin/Answer 起步），workflow 同理；
    // initialEmptyDsl(isAgent) 的 isAgent 只决定空图种子，与 canvas_category
    // 解耦，这里显式传形态。
    const ret = await setAgent({
      title: values.name,
      description: values.description || '',
      dsl: initialEmptyDsl(true),
      canvas_category: meta.category,
    });
    if (ret.code === 0) {
      hideModal();
      const id = ret.data?.id;
      if (id) {
        navigate(`/agent/${id}`);
      }
    }
  }

  const kinds: StudioCreateKind[] = ['chatflow', 'workflow'];

  return (
    <Dialog open onOpenChange={hideModal}>
      <DialogContent className="max-w-[860px]">
        <DialogHeader>
          <DialogTitle>{t('studio.createAppTitle')}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-5"
            id="studio-create-form"
          >
            {/* 类型大卡：一张卡回答「它是什么 / 图长什么样 / 输出什么 / 适合谁」 */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {kinds.map((kind) => {
                const active = selected === kind;
                const Icon = TYPE_META[kind].icon;
                return (
                  <Card
                    key={kind}
                    className={cn(
                      'rounded-lg border bg-transparent',
                      active ? 'border-text-primary' : 'border-border-default',
                    )}
                  >
                    <CardContent
                      onClick={() => {
                        setSelected(kind);
                        form.setValue('type', kind, { shouldDirty: true });
                      }}
                      className="cursor-pointer p-5"
                      data-testid={`studio-create-type-${kind}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-text-primary">
                          <Icon className="size-5" />
                          <span className="font-medium">
                            {kind === 'chatflow'
                              ? t('flow.chatflow')
                              : t('flow.taskFlow')}
                          </span>
                        </div>
                        {active && <Check className="size-4" />}
                      </div>
                      <p className="mt-2 text-sm text-text-secondary">
                        {kind === 'chatflow'
                          ? t('studio.chatflowWhat')
                          : t('studio.workflowWhat')}
                      </p>
                      <p className="mt-1 text-xs text-text-secondary">
                        {kind === 'chatflow'
                          ? t('studio.chatflowShape')
                          : t('studio.workflowShape')}
                      </p>
                      <p className="mt-1 text-xs text-text-secondary">
                        {kind === 'chatflow'
                          ? t('studio.chatflowOutput')
                          : t('studio.workflowOutput')}
                      </p>
                      <p className="mt-2 text-xs text-accent-primary">
                        {kind === 'chatflow'
                          ? t('studio.chatflowFit')
                          : t('studio.workflowFit')}
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <p className="text-xs text-text-secondary">
              {t('studio.typeImmutable')}
            </p>

            <RAGFlowFormItem required name="name" label={t('common.name')}>
              <Input placeholder={t('common.namePlaceholder')} />
            </RAGFlowFormItem>

            <RAGFlowFormItem name="description" label={t('common.description')}>
              <Textarea rows={3} placeholder={t('common.description')} />
            </RAGFlowFormItem>
          </form>
        </Form>

        {/* 边界兜底：避免用户在工作室里找 Agent / 数据管道（产品文档 4.2 第 3 点） */}
        <p className="text-xs text-text-secondary">
          {t('studio.belongHint')}
        </p>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={hideModal}>
            {t('common.cancel')}
          </Button>
          <ButtonLoading
            type="submit"
            form="studio-create-form"
            loading={loading}
            data-testid="studio-create-save"
          >
            {t('common.confirm')}
          </ButtonLoading>
        </div>
      </DialogContent>
    </Dialog>
  );
}
