import { RAGFlowFormItem } from '@/components/ragflow-form';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  ModelTreeSelectFormField,
  ModelTypeMap,
} from '@/components/model-tree-select';
import { useTranslation } from 'react-i18next';
import { useFormContext, useWatch } from 'react-hook-form';
import { useOwnerTenantId } from '../../context';
import { OutputFormatFormFieldProps } from './common-form-fields';
import { buildFieldNameWithPrefix } from './utils';

// Dual-track ("一问一答") transcription. A contact-centre recorder exports a
// stereo WAV with the agent on one channel and the customer on the other; the
// backend splits the channels, transcribes each on its own and re-interleaves
// them by time into labelled turns. Every other shape (mono, compressed
// container, unsupported bit depth) is transcribed whole, so turning the
// switch on never loses a file.
export function AudioFormFields({ prefix }: OutputFormatFormFieldProps) {
  const { t } = useTranslation();
  const ownerTenantId = useOwnerTenantId();
  // The form is untyped here on purpose: a per-setup field name is built at
  // runtime, so it cannot satisfy the schema's literal path union (same
  // pattern as TcadpFormFields).
  const form = useFormContext();
  const dialogueSplit = useWatch({
    control: form.control,
    name: buildFieldNameWithPrefix('dialogue_split', prefix),
  });

  return (
    <>
      {/* Multimodal Model */}
      <ModelTreeSelectFormField
        name={buildFieldNameWithPrefix('vlm.llm_id', prefix)}
        label={t('chat.model')}
        modelTypes={ModelTypeMap.asr_id}
        allowClear
        ownerTenantId={ownerTenantId}
      />

      <RAGFlowFormItem
        name={buildFieldNameWithPrefix('dialogue_split', prefix)}
        label={t('flow.audioDialogueSplit')}
        tooltip={t('flow.audioDialogueSplitTip')}
        horizontal={true}
        labelClassName="w-full"
        valueClassName="w-8"
      >
        {(field) => (
          <Switch
            checked={!!field.value}
            onCheckedChange={(checked) => {
              field.onChange?.(checked);
            }}
          />
        )}
      </RAGFlowFormItem>

      {dialogueSplit && (
        <>
          <RAGFlowFormItem
            name={buildFieldNameWithPrefix('left_speaker', prefix)}
            label={t('flow.audioLeftSpeaker')}
            tooltip={t('flow.audioLeftSpeakerTip')}
          >
            {(field) => (
              <Input
                value={field.value ?? ''}
                onChange={(event) => field.onChange?.(event.target.value)}
                placeholder={t('flow.audioLeftSpeaker')}
              />
            )}
          </RAGFlowFormItem>
          <RAGFlowFormItem
            name={buildFieldNameWithPrefix('right_speaker', prefix)}
            label={t('flow.audioRightSpeaker')}
            tooltip={t('flow.audioRightSpeakerTip')}
          >
            {(field) => (
              <Input
                value={field.value ?? ''}
                onChange={(event) => field.onChange?.(event.target.value)}
                placeholder={t('flow.audioRightSpeaker')}
              />
            )}
          </RAGFlowFormItem>
        </>
      )}
    </>
  );
}
