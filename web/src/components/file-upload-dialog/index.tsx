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

import { ButtonLoading } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  LucideDatabase,
  LucideFileText,
  LucideShieldCheck,
  LucideUpload,
  LucideZap,
} from 'lucide-react';
import { IModalProps } from '@/interfaces/common';
import { extractTableColumns, isTableFile } from '@/utils/table-column-extract';
import { zodResolver } from '@hookform/resolvers/zod';
import { TFunction } from 'i18next';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { FileUploader } from '../file-uploader';
import { RAGFlowFormItem } from '../ragflow-form';
import { Form } from '../ui/form';
import { Label } from '../ui/label';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Switch } from '../ui/switch';

const ROLE_OPTIONS = [
  { value: 'both', labelKey: 'knowledgeConfiguration.tableColumnRoleBoth' },
  {
    value: 'indexing',
    labelKey: 'knowledgeConfiguration.tableColumnRoleIndexing',
  },
  {
    value: 'metadata',
    labelKey: 'knowledgeConfiguration.tableColumnRoleMetadata',
  },
] as const;

export type TableColumnRoles = Record<string, 'indexing' | 'metadata' | 'both'>;

function buildUploadFormSchema(t: TFunction) {
  const FormSchema = z.object({
    parseOnCreation: z.boolean().optional(),
    // Update schema to allow files with path property to handle folder uploads
    fileList: z
      .array(
        z.instanceof(File).or(
          z.object({
            file: z.instanceof(File),
            path: z.string(), // Store the relative path for files in folders
          }),
        ),
      )
      .min(1, { message: t('fileManager.pleaseUploadAtLeastOneFile') }),
    tableColumnMode: z.enum(['auto', 'manual']).optional(),
    tableColumnRoles: z
      .record(z.enum(['indexing', 'metadata', 'both']))
      .optional(),
  });

  return FormSchema;
}

export type UploadFormSchemaType = z.infer<
  ReturnType<typeof buildUploadFormSchema>
>;

const UploadFormId = 'UploadFormId';

/**
 * 格式标签。纯展示用途——真正校验上传类型的是 FileUploader 的 `accept`。
 * 这里按设计稿列全支持的类型，与 accept 解耦以免两处漂移后互相矛盾。
 */
const SUPPORTED_FORMATS = [
  { key: 'fileManager.formatPdf' },
  { key: 'fileManager.formatWord' },
  { key: 'fileManager.formatExcel' },
  { key: 'fileManager.formatPpt' },
  { key: 'fileManager.formatImage' },
  { key: 'fileManager.formatVideo' },
  { key: 'fileManager.formatAudio' },
];

/** 数据接入流程步骤条，纯示意，不承载交互。 */
const FLOW_STEPS = [
  { key: 'fileManager.flowStepUpload', icon: LucideUpload },
  { key: 'fileManager.flowStepParse', icon: LucideZap },
  { key: 'fileManager.flowStepGenerate', icon: LucideFileText },
  { key: 'fileManager.flowStepReview', icon: LucideShieldCheck },
  { key: 'fileManager.flowStepSync', icon: LucideDatabase },
];

function DataIngestionFlow() {
  const { t } = useTranslation();

  return (
    <div className="flex items-start justify-between">
      {FLOW_STEPS.map(({ key, icon: Icon }, index) => (
        <Fragment key={key}>
          <div className="flex flex-col items-center gap-2">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-primary/10 text-accent-primary">
              <Icon className="size-5" strokeWidth={2} />
            </span>
            <span className="text-center text-xs font-medium text-text-secondary">
              {t(key)}
            </span>
          </div>

          {/* 连接线：最后一步不画，避免溢出容器 */}
          {index < FLOW_STEPS.length - 1 && (
            <span
              aria-hidden
              className="mt-5 h-px flex-1 bg-border-button"
            />
          )}
        </Fragment>
      ))}
    </div>
  );
}

type UploadFormProps = {
  submit: (values?: UploadFormSchemaType) => void;
  showParseOnCreation?: boolean;
  isTableParser?: boolean;
};
function UploadForm({
  submit,
  showParseOnCreation,
  isTableParser,
}: UploadFormProps) {
  const { t } = useTranslation();
  const FormSchema = buildUploadFormSchema(t);

  type UploadFormSchemaType = z.infer<typeof FormSchema>;
  const form = useForm<UploadFormSchemaType>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      parseOnCreation: false,
      fileList: [],
      tableColumnMode: 'auto',
      tableColumnRoles: {},
    },
  });

  const [extractedColumns, setExtractedColumns] = useState<string[]>([]);
  const [columnMode, setColumnMode] = useState<'auto' | 'manual'>('auto');
  const [columnRoles, setColumnRoles] = useState<TableColumnRoles>({});

  const handleFilesChange = useCallback(
    async (files: any[]) => {
      if (!isTableParser || !files || files.length === 0) {
        setExtractedColumns([]);
        return;
      }

      // Extract columns from the first table file
      const allColumns = new Set<string>();
      for (const f of files) {
        const file = f instanceof File ? f : f.file;
        if (file && isTableFile(file)) {
          const cols = await extractTableColumns(file);
          cols.forEach((c) => allColumns.add(c));
        }
      }
      setExtractedColumns(Array.from(allColumns));
    },
    [isTableParser],
  );

  const handleModeChange = (value: 'auto' | 'manual') => {
    setColumnMode(value);
    form.setValue('tableColumnMode', value);
  };

  const handleRoleChange = (col: string, role: string) => {
    const updated = {
      ...columnRoles,
      [col]: role as 'indexing' | 'metadata' | 'both',
    };
    setColumnRoles(updated);
    form.setValue('tableColumnRoles', updated);
  };

  // Sync column roles to form when columns are extracted
  useEffect(() => {
    if (columnMode === 'manual' && extractedColumns.length > 0) {
      const roles: TableColumnRoles = {};
      extractedColumns.forEach((col) => {
        roles[col] = columnRoles[col] || 'both';
      });
      setColumnRoles(roles);
      form.setValue('tableColumnRoles', roles);
    }
  }, [extractedColumns, columnMode]); // oxlint-disable-line react/exhaustive-deps

  const showColumnConfig = isTableParser && extractedColumns.length > 0;

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(submit)}
        id={UploadFormId}
        className="space-y-6 py-4"
      >
        {/* 文件上传区 */}
        <section className="space-y-3">
          <div className="space-y-0.5">
            <h3 className="text-sm font-semibold text-text-primary">
              {t('fileManager.fileUploadSection')}
            </h3>
            <p className="text-xs text-text-secondary">
              {t('fileManager.fileUploadFormatHint', {
                formats: SUPPORTED_FORMATS.map((f) => t(f.key)).join('、'),
              })}
            </p>
          </div>

          {showParseOnCreation && (
            <RAGFlowFormItem
              name="parseOnCreation"
              label={t('fileManager.parseOnCreation')}
            >
              {(field) => (
                <Switch
                  data-testid="parse-on-creation-toggle"
                  onCheckedChange={field.onChange}
                  checked={field.value}
                />
              )}
            </RAGFlowFormItem>
          )}

          <RAGFlowFormItem name="fileList" label={''}>
            {(field) => (
              <FileUploader
                value={field.value}
                onValueChange={(files) => {
                  field.onChange(files);
                  handleFilesChange(files);
                }}
                accept={{}}
                data-testid="dataset-upload-dropzone"
                // 设计稿：拖拽区更矮、文案与格式标签单独成行
                dropzoneClassName="h-48"
                title={t('fileManager.dropToUpload')}
                description={t('fileManager.dropToUploadHint')}
                formats={SUPPORTED_FORMATS}
              />
            )}
          </RAGFlowFormItem>
        </section>

        {/* 数据接入流程：示意步骤条 */}
        <section className="space-y-3 border-t border-border-button pt-5">
          <div className="space-y-0.5">
            <h3 className="text-sm font-semibold text-text-primary">
              {t('fileManager.dataIngestionFlow')}
            </h3>
            <p className="text-xs text-text-secondary">
              {t('fileManager.dataIngestionFlowSubtitle')}
            </p>
          </div>

          <DataIngestionFlow />
        </section>

        {showColumnConfig && (
          <div className="space-y-3 border rounded-md p-3">
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {t('knowledgeConfiguration.tableColumnMode')}
              </Label>
              <RadioGroup
                value={columnMode}
                onValueChange={handleModeChange}
                className="flex gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="auto" id="upload-mode-auto" />
                  <label
                    htmlFor="upload-mode-auto"
                    className="text-sm font-normal cursor-pointer"
                  >
                    {t('knowledgeConfiguration.tableColumnModeAuto')}
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="manual" id="upload-mode-manual" />
                  <label
                    htmlFor="upload-mode-manual"
                    className="text-sm font-normal cursor-pointer"
                  >
                    {t('knowledgeConfiguration.tableColumnModeManual')}
                  </label>
                </div>
              </RadioGroup>
            </div>

            {columnMode === 'auto' && (
              <p className="text-sm text-muted-foreground">
                {t('knowledgeConfiguration.tableColumnModeAutoDescription')}
              </p>
            )}

            {columnMode === 'manual' && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {t('knowledgeConfiguration.tableColumnRolesTip')}
                </p>
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {extractedColumns.map((col) => (
                    <div key={col} className="flex items-center gap-3">
                      <Label className="min-w-[120px] shrink-0 text-sm font-normal truncate">
                        {col}
                      </Label>
                      <Select
                        value={columnRoles[col] || 'both'}
                        onValueChange={(value) => handleRoleChange(col, value)}
                      >
                        <SelectTrigger className="w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {t(opt.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </form>
    </Form>
  );
}

type FileUploadDialogProps = IModalProps<UploadFormSchemaType> &
  Pick<UploadFormProps, 'showParseOnCreation' | 'isTableParser'>;
export function FileUploadDialog({
  hideModal,
  onOk,
  loading,
  showParseOnCreation = false,
  isTableParser = false,
}: FileUploadDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open onOpenChange={hideModal}>
      <DialogContent
        data-testid="dataset-upload-modal"
        className="max-h-[85vh] gap-0 overflow-y-auto sm:max-w-3xl"
      >
        {/* 标题区：数据接入 + 版本与部门副标题 */}
        <DialogHeader className="space-y-1 border-b border-border-button pb-4 text-left">
          <DialogTitle className="text-lg font-semibold">
            {t('fileManager.dataIngestion')}
          </DialogTitle>
          <p className="text-sm font-normal text-text-secondary">
            {t('fileManager.dataIngestionSubtitle', {
              department: t('fileManager.dataIngestionDepartment'),
            })}
          </p>
        </DialogHeader>

        <UploadForm
          submit={onOk!}
          showParseOnCreation={showParseOnCreation}
          isTableParser={isTableParser}
        />

        <DialogFooter>
          <ButtonLoading type="submit" loading={loading} form={UploadFormId}>
            {t('common.save')}
          </ButtonLoading>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
