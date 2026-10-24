import { fireEvent, render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { FileType } from '@/constants/file';
import { AudioFormFields } from './audio-form-fields';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/components/ragflow-form', () => ({
  RAGFlowFormItem: ({ name, children }: any) => {
    const {
      Controller,
      useFormContext,
    }: typeof import('react-hook-form') = require('react-hook-form');
    const { control } = useFormContext();
    return (
      <Controller
        name={name}
        control={control}
        render={({ field }) =>
          typeof children === 'function' ? children(field) : children
        }
      />
    );
  },
}));

// The ASR model picker needs a provider context and a model dictionary; the
// dual-track controls do not, so it is stubbed out.
jest.mock('@/components/model-tree-select', () => ({
  ModelTreeSelectFormField: () => <div data-testid="asr-model-field" />,
  ModelTypeMap: { asr_id: 'asr_id' },
}));

jest.mock('../../context', () => ({
  useOwnerTenantId: () => 'tenant-1',
}));

function ParserAudioForm({
  dialogueSplit = false,
  leftSpeaker = '',
  rightSpeaker = '',
}: {
  dialogueSplit?: boolean;
  leftSpeaker?: string;
  rightSpeaker?: string;
}) {
  const form = useForm({
    defaultValues: {
      setups: [
        {
          fileFormat: FileType.Audio,
          output_format: 'text',
          dialogue_split: dialogueSplit,
          left_speaker: leftSpeaker,
          right_speaker: rightSpeaker,
        },
      ],
    },
  });
  return (
    <FormProvider {...form}>
      <AudioFormFields prefix="setups.0" fileType={FileType.Audio} />
    </FormProvider>
  );
}

describe('audio dual-track fields', () => {
  it('hides the role inputs until the switch is on', () => {
    render(<ParserAudioForm />);

    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByPlaceholderText('flow.audioLeftSpeaker')).toBeNull();
    expect(screen.queryByPlaceholderText('flow.audioRightSpeaker')).toBeNull();
  });

  it('shows the role inputs once the switch is on', () => {
    render(<ParserAudioForm dialogueSplit />);

    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByPlaceholderText('flow.audioLeftSpeaker')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('flow.audioRightSpeaker')).toBeInTheDocument();
  });

  it('toggling the switch reveals and hides the role inputs', () => {
    render(<ParserAudioForm />);

    fireEvent.click(screen.getByRole('switch'));
    expect(screen.getByPlaceholderText('flow.audioLeftSpeaker')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch'));
    expect(screen.queryByPlaceholderText('flow.audioLeftSpeaker')).toBeNull();
  });

  it('keeps the configured roles in the inputs', () => {
    render(
      <ParserAudioForm dialogueSplit leftSpeaker="客服" rightSpeaker="用户" />,
    );

    expect(screen.getByPlaceholderText('flow.audioLeftSpeaker')).toHaveValue('客服');
    expect(screen.getByPlaceholderText('flow.audioRightSpeaker')).toHaveValue('用户');
  });
});
