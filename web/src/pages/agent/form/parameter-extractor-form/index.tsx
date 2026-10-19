import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { zodResolver } from '@hookform/resolvers/zod';
import { isEmpty } from 'lodash';
import { useEffect } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { RAGFlowNodeType } from '@/interfaces/database/agent';
import { INextOperatorForm } from '../../interface';
import { FormWrapper } from '../components/form-wrapper';
import useGraphStore from '../../store';

const FormSchema = z.object({
  input: z.string().optional(),
  model_id: z.string().optional(),
  instruction: z.string().optional(),
  fields: z
    .array(
      z.object({
        name: z.string(),
        type: z.string(),
        required: z.boolean().optional(),
        description: z.string().optional(),
      }),
    )
    .optional(),
});

function useValues(node?: RAGFlowNodeType) {
  const formData = node?.data?.form as any;
  if (isEmpty(formData)) {
    return { input: '{sys.query}', model_id: '', instruction: '', fields: [] };
  }
  return {
    input: formData.input ?? '{sys.query}',
    model_id: formData.model_id ?? '',
    instruction: formData.instruction ?? '',
    fields: formData.fields ?? [],
  };
}

export default function ParameterExtractorForm({ node }: INextOperatorForm) {
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

  const { fields, append, remove } = useFieldArray({
    name: 'fields',
    control: form.control,
  });

  return (
    <Form {...form}>
      <FormWrapper>
        <FormField
          control={form.control}
          name="input"
          render={({ field }) => (
            <FormItem>
              <FormLabel>输入文本</FormLabel>
              <FormControl>
                <Input placeholder="{sys.query}" {...field} />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="model_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>模型</FormLabel>
              <FormControl>
                <Input placeholder="模型 ID" {...field} />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="instruction"
          render={({ field }) => (
            <FormItem>
              <FormLabel>抽取说明（可选）</FormLabel>
              <FormControl>
                <Textarea rows={2} {...field} />
              </FormControl>
            </FormItem>
          )}
        />
        <div className="text-sm text-text-secondary">抽取字段：</div>
        {fields.map((field, index) => (
          <div key={field.id} className="flex items-center gap-2">
            <FormField
              control={form.control}
              name={`fields.${index}.name`}
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormControl>
                    <Input placeholder="字段名" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={`fields.${index}.type`}
              render={({ field }) => (
                <FormItem className="w-24">
                  <FormControl>
                    <select
                      className="h-9 w-full rounded-md border border-border-base bg-background-content px-2 text-sm"
                      {...field}
                    >
                      <option value="string">string</option>
                      <option value="number">number</option>
                      <option value="boolean">boolean</option>
                    </select>
                  </FormControl>
                </FormItem>
              )}
            />
            <label className="flex items-center gap-1 text-xs text-text-secondary">
              <FormField
                control={form.control}
                name={`fields.${index}.required`}
                render={({ field }) => (
                  <input
                    type="checkbox"
                    checked={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
              必填
            </label>
            <button
              type="button"
              className="text-text-secondary"
              onClick={() => remove(index)}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          className="text-accent-primary"
          onClick={() =>
            append({ name: '', type: 'string', required: false, description: '' })
          }
        >
          + 添加字段
        </button>
      </FormWrapper>
    </Form>
  );
}
