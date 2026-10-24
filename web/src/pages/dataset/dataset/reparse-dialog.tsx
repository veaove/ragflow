import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { DynamicForm, DynamicFormRef } from '@/components/dynamic-form';
import { DialogProps } from '@radix-ui/react-dialog';
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export const ReparseDialog = memo(
  ({
    handleOperationIconClick,
    visible = true,
    hideModal,
  }: DialogProps & {
    handleOperationIconClick: (options?: {
      delete: boolean;
      apply_kb: boolean;
    }) => void;
    visible: boolean;
    hideModal: () => void;
  }) => {
    const { t } = useTranslation();
    // A file only carries a snapshot of the dataset config taken at upload
    // time, so re-parsing applies the dataset's current settings by default —
    // that is what an operator expects after editing them. Files with their own
    // tuned settings can opt out here.
    const [applyKb, setApplyKb] = useState(true);

    // Existing chunks are always dropped on re-ingest, so the dialog only
    // needs a plain confirmation with no checkboxes. Seed delete: true so the
    // click payload keeps the drop behavior.
    const defaultValues = {
      delete: true,
      apply_kb: true,
    };

    const formCallbackRef = useRef<DynamicFormRef>(null);

    const handleCancel = useCallback(() => {
      hideModal?.();
      formCallbackRef?.current?.reset();
    }, [formCallbackRef, hideModal]);

    const handleSave = useCallback(async () => {
      const instance = formCallbackRef?.current;
      if (!instance) {
        console.error('Form instance is null');
        return;
      }

      const check = await instance.trigger();
      if (check) {
        instance.submit();
        const formValues = instance.getValues();
        handleOperationIconClick({
          delete: formValues.delete,
          apply_kb: applyKb,
        });
      }
    }, [applyKb, formCallbackRef, handleOperationIconClick]);

    return (
      <ConfirmDeleteDialog
        title={t(`knowledgeDetails.parseFile`)}
        onOk={() => handleSave()}
        onCancel={() => handleCancel()}
        open={visible}
        okButtonText={t('common.confirm')}
        content={{
          title: t(`knowledgeDetails.clearChunksReparseTip`),
          node: (
            <div className="flex flex-col gap-4">
              <DynamicForm.Root
                onSubmit={(data) => {
                  console.log('submit', data);
                }}
                ref={formCallbackRef}
                fields={[]}
                defaultValues={defaultValues}
              ></DynamicForm.Root>
              <label className="flex items-start gap-2 text-sm text-text-primary">
                <Checkbox
                  checked={applyKb}
                  onCheckedChange={(checked) => setApplyKb(checked === true)}
                  className="mt-0.5"
                  data-testid="reparse-apply-kb"
                />
                <span>
                  {t('knowledgeDetails.applyDatasetConfig')}
                  <span className="mt-0.5 block text-xs text-text-secondary">
                    {t('knowledgeDetails.applyDatasetConfigTip')}
                  </span>
                </span>
              </label>
            </div>
          ),
        }}
      ></ConfirmDeleteDialog>
    );
  },
);

ReparseDialog.displayName = 'ReparseDialog';
