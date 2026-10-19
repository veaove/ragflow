import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { zodResolver } from '@hookform/resolvers/zod';
import { isEmpty } from 'lodash';
import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { RAGFlowNodeType } from '@/interfaces/database/agent';
import { INextOperatorForm } from '../../interface';
import { FormWrapper } from '../components/form-wrapper';
import { PromptEditor } from '../components/prompt-editor';
import useGraphStore from '../../store';

const FormSchema = z.object({
  model_id: z.string().optional(),
  system_prompt: z.string().optional(),
  user_prompt: z.string().optional(),
  temperature: z.coerce.number().optional(),
  max_tokens: z.coerce.number().optional(),
});

function useValues(node?: RAGFlowNodeType) {
  const formData = node?.data?.form as any;
  if (isEmpty(formData)) {
    return {
      model_id: '',
      system_prompt: '',
      user_prompt: '',
      temperature: 0.7,
      max_tokens: 1024,
    };
  }
  return {
    model_id: formData.model_id ?? '',
    system_prompt: formData.system_prompt ?? '',
    user_prompt: formData.user_prompt ?? '',
    temperature: formData.temperature ?? 0.7,
    max_tokens: formData.max_tokens ?? 1024,
  };
}

export default function LLMForm({ node }: INextOperatorForm) {
  const values = useValues(node);
  const form = useForm({
    defaultValues: values,
    resolver: zodResolver(FormSchema),
  });

  const updateNodeForm = useGraphStore((state) => state.updateNodeForm);
  const watched = useWatch({ control: form.control });
  useEffect(() => {
    if (node?.id && form.formState.isDirty) {
      updateNodeForm(node.id, { ...form.getValues() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watched, node?.id]);

  return (
    <Form {...form}>
      <FormWrapper>
        <FormField
          control={form.control}
          name="model_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>模型</FormLabel>
              <FormControl>
                <Input placeholder="模型 ID，如 deepseek-chat" {...field} />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="system_prompt"
          render={({ field }) => (
            <FormItem>
              <FormLabel>系统提示词</FormLabel>
              <FormControl>
                <PromptEditor value={field.value} onChange={field.onChange} />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="user_prompt"
          render={({ field }) => (
            <FormItem>
              <FormLabel>用户提示词</FormLabel>
              <FormControl>
                <PromptEditor value={field.value} onChange={field.onChange} />
              </FormControl>
            </FormItem>
          )}
        />
        <div className="flex gap-2">
          <FormField
            control={form.control}
            name="temperature"
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormLabel>温度</FormLabel>
                <FormControl>
                  <Input type="number" step="0.1" {...field} />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="max_tokens"
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormLabel>最大 token</FormLabel>
                <FormControl>
                  <Input type="number" {...field} />
                </FormControl>
              </FormItem>
            )}
          />
        </div>
      </FormWrapper>
    </Form>
  );
}
