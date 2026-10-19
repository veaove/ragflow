import {
  Form,
  FormControl,
  FormField,
  FormItem,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { zodResolver } from '@hookform/resolvers/zod';
import { isEmpty } from 'lodash';
import { useEffect } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { INextOperatorForm } from '../../interface';
import { FormWrapper } from '../components/form-wrapper';
import useGraphStore from '../../store';
import { RAGFlowNodeType } from '@/interfaces/database/agent';

const FormSchema = z.object({
  outputs: z
    .array(z.object({ name: z.string(), type: z.string(), value: z.string() }))
    .optional(),
});

function useValues(node?: RAGFlowNodeType) {
  const formData = node?.data?.form as any;
  if (isEmpty(formData?.outputs)) {
    return { outputs: [] };
  }
  const raw = formData.outputs;
  const outputs = Object.entries(raw as Record<string, any>).map(
    ([name, def]: [string, any]) => ({
      name,
      type: def?.type ?? 'string',
      value: def?.value ?? '',
    }),
  );
  return { outputs };
}

export default function EndForm({ node }: INextOperatorForm) {
  const values = useValues(node);
  const form = useForm({
    defaultValues: values,
    resolver: zodResolver(FormSchema),
  });

  const updateNodeForm = useGraphStore((state) => state.updateNodeForm);
  const watched = useWatch({ control: form.control });
  useEffect(() => {
    if (node?.id && form.formState.isDirty) {
      const list = form.getValues().outputs ?? [];
      const outputs: Record<string, any> = {};
      list.forEach((f) => {
        if (f.name) outputs[f.name] = { type: f.type, value: f.value };
      });
      updateNodeForm(node.id, { outputs });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watched, node?.id]);

  const { fields, append, remove } = useFieldArray({
    name: 'outputs',
    control: form.control,
  });

  return (
    <Form {...form}>
      <FormWrapper>
        <div className="text-sm text-text-secondary">
          声明 Workflow 的输出字段；发布后这些字段构成 API 响应体。
        </div>
        {fields.map((field, index) => (
          <div key={field.id} className="flex items-center gap-2">
            <FormField
              control={form.control}
              name={`outputs.${index}.name`}
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
              name={`outputs.${index}.type`}
              render={({ field }) => (
                <FormItem className="w-28">
                  <FormControl>
                    <select
                      className="h-9 w-full rounded-md border border-border-base bg-background-content px-2 text-sm"
                      {...field}
                    >
                      <option value="string">string</option>
                      <option value="number">number</option>
                      <option value="boolean">boolean</option>
                      <option value="object">object</option>
                      <option value="array">array</option>
                    </select>
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={`outputs.${index}.value`}
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormControl>
                    <Input placeholder="值，如 {llm@answer}" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
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
          onClick={() => append({ name: '', type: 'string', value: '' })}
        >
          + 添加输出字段
        </button>
      </FormWrapper>
    </Form>
  );
}
