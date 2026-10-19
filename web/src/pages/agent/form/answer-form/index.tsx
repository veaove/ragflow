import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
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
  content: z.string().optional(),
  stream: z.boolean().optional(),
  with_citation: z.boolean().optional(),
  markdown: z.boolean().optional(),
});

function useValues(node?: RAGFlowNodeType) {
  const formData = node?.data?.form as any;
  if (isEmpty(formData)) {
    return { content: '', stream: true, with_citation: true, markdown: true };
  }
  const content = Array.isArray(formData.content)
    ? formData.content.map((c: any) => c.value).join('')
    : (formData.content ?? '');
  return {
    content,
    stream: formData.stream ?? true,
    with_citation: formData.with_citation ?? true,
    markdown: formData.markdown ?? true,
  };
}

export default function AnswerForm({ node }: INextOperatorForm) {
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
          name="content"
          render={({ field }) => (
            <FormItem>
              <FormLabel>回答内容</FormLabel>
              <FormControl>
                <PromptEditor
                  value={field.value}
                  onChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="stream"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between">
              <FormLabel>流式输出</FormLabel>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="with_citation"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between">
              <FormLabel>携带引用</FormLabel>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />
      </FormWrapper>
    </Form>
  );
}
