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

import { SliderInputFormField } from '@/components/slider-input-form-field';
import { Form } from '@/components/ui/form';
import { zodResolver } from '@hookform/resolvers/zod';
import { memo } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { initialAudioChunkerValues } from '../../constant/pipeline';
import { useFormChangeCallback } from '../../hooks/use-form-change-callback';
import { useFormValues } from '../../hooks/use-form-values';
import { useWatchFormChange } from '../../hooks/use-watch-form-change';
import { INextOperatorForm } from '../../interface';
import { FormWrapper } from '../components/form-wrapper';

// The Audio pipeline's chunker is a OneChunker (one chunk per file). The two
// fields below are its opt-in split: chunk_token_size 0 keeps the historical
// single-chunk behaviour.
export const FormSchema = z.object({
  chunk_token_size: z.number().min(0).max(2048),
  overlapped_percent: z.number().min(0).max(30),
});

export type AudioChunkerFormSchemaType = z.infer<typeof FormSchema>;

const AudioChunkerForm = ({ node, onValuesChange }: INextOperatorForm) => {
  const { t } = useTranslation();
  const defaultValues = useFormValues(initialAudioChunkerValues, node);

  // The Audio template node bakes only `outputs`, so a chunker saved before
  // these params existed has neither key. Seed them from the defaults —
  // otherwise the sliders mount uncontrolled.
  const formDefaultValues = {
    ...initialAudioChunkerValues,
    ...defaultValues,
    chunk_token_size:
      defaultValues.chunk_token_size ??
      initialAudioChunkerValues.chunk_token_size,
    overlapped_percent:
      defaultValues.overlapped_percent ??
      initialAudioChunkerValues.overlapped_percent,
  };

  const form = useForm<AudioChunkerFormSchemaType>({
    defaultValues: formDefaultValues,
    resolver: zodResolver(FormSchema),
    mode: 'onChange',
  });

  useWatchFormChange(node?.id, form);
  useFormChangeCallback(form, onValuesChange);

  return (
    <Form {...form}>
      <FormWrapper>
        <p className="text-sm text-text-secondary">
          {t('knowledgeConfiguration.audioChunkerTip')}
        </p>
        <SliderInputFormField
          name="chunk_token_size"
          min={0}
          max={2048}
          integer
          label={t('knowledgeConfiguration.chunkTokenNumber')}
          tooltip={t('knowledgeConfiguration.audioChunkTokenSizeTip')}
        />
        <SliderInputFormField
          name="overlapped_percent"
          min={0}
          max={30}
          integer
          label={t('flow.overlappedPercent')}
          tooltip={t('knowledgeConfiguration.audioOverlappedPercentTip')}
        />
      </FormWrapper>
    </Form>
  );
};

export default memo(AudioChunkerForm);
