import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { zodResolver } from '@hookform/resolvers/zod';
import { isEmpty } from 'lodash';
import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { RAGFlowNodeType } from '@/interfaces/database/agent';
import { INextOperatorForm } from '../../interface';
import { FormWrapper } from '../components/form-wrapper';
import useGraphStore from '../../store';

const FormSchema = z.object({
  template: z.string().optional(),
  variables: z.record(z.string()).optional(),
});

function useValues(node?: RAGFlowNodeType) {
  const formData = node?.data?.form as any;
  if (isEmpty(formData)) {
    return { template: '', variables: {} };
  }
  return {
    template: formData.template ?? '',
    variables: formData.variables ?? {},
  };
}

export default function TemplateTransformForm({ node }: INextOperatorForm) {
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
          name="template"
          render={({ field }) => (
            <FormItem>
              <FormLabel>模板（支持 {'{{ name }}'} 变量）</FormLabel>
              <FormControl>
                <Textarea rows={5} {...field} />
              </FormControl>
            </FormItem>
          )}
        />
        <div className="text-xs text-text-secondary">
          变量绑定：变量名 → 画布引用（如 {'{start@user_name}'}）。变量通过
          「variables」字段以 JSON 形式配置。
        </div>
        <FormField
          control={form.control}
          name="variables"
          render={({ field }) => (
            <FormItem>
              <FormLabel>变量（JSON，可选）</FormLabel>
              <FormControl>
                <Textarea
                  rows={3}
                  placeholder='{"name": "{start@user_name}"}'
                  value={JSON.stringify(field.value ?? {})}
                  onChange={(e) => {
                    try {
                      field.onChange(JSON.parse(e.target.value));
                    } catch {
                      // ignore incomplete JSON while typing
                    }
                  }}
                />
              </FormControl>
            </FormItem>
          )}
        />
      </FormWrapper>
    </Form>
  );
}
