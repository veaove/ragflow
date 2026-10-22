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

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Minus, Plus } from 'lucide-react';

/**
 * Protocol templates a custom provider may use.
 *
 * Mirrors the backend whitelist (`customProviderDrivers`): the driver decides
 * which ModelDriver serves the provider, so the list is closed on purpose.
 */
const DRIVER_OPTIONS = [
  { value: 'openai-api-compatible', label: 'OpenAI 兼容（vLLM / one-api / 自研网关）' },
  { value: 'vllm', label: 'vLLM' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'xinference', label: 'Xinference' },
  { value: 'localai', label: 'LocalAI' },
  { value: 'lm-studio', label: 'LM Studio' },
];

const MODEL_TYPE_OPTIONS = [
  { value: 'chat', label: 'LLM' },
  { value: 'embedding', label: 'Embedding' },
  { value: 'rerank', label: 'Rerank' },
  { value: 'asr', label: 'ASR' },
  { value: 'vision', label: 'VLM' },
  { value: 'tts', label: 'TTS' },
];

interface ModelRow {
  name: string;
  type: string;
}

export default function AddCustomProviderModal({
  visible,
  hideModal,
  onSubmit,
}: {
  visible: boolean;
  hideModal: () => void;
  onSubmit: (payload: {
    providerName: string;
    driver: string;
    baseUrl: string;
    apiKey: string;
    models: ModelRow[];
  }) => Promise<void>;
}) {
  const { t } = useTranslation();

  const [providerName, setProviderName] = useState('');
  const [driver, setDriver] = useState('openai-api-compatible');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<ModelRow[]>([
    { name: '', type: 'chat' },
  ]);
  const [submitting, setSubmitting] = useState(false);

  const reset = useCallback(() => {
    setProviderName('');
    setDriver('openai-api-compatible');
    setBaseUrl('');
    setApiKey('');
    setModels([{ name: '', type: 'chat' }]);
    setSubmitting(false);
  }, []);

  const filledModels = models.filter((m) => m.name.trim() !== '');
  const canSubmit =
    providerName.trim() !== '' && baseUrl.trim() !== '' && filledModels.length > 0;

  const onConfirm = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({
        providerName: providerName.trim(),
        driver,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        models: filledModels.map((m) => ({ name: m.name.trim(), type: m.type })),
      });
      reset();
      hideModal();
    } finally {
      setSubmitting(false);
    }
  }, [
    canSubmit,
    onSubmit,
    providerName,
    driver,
    baseUrl,
    apiKey,
    filledModels,
    reset,
    hideModal,
  ]);

  return (
    <Dialog
      open={visible}
      onOpenChange={(open) => {
        if (!open) {
          reset();
          hideModal();
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('setting.addCustomProvider')}</DialogTitle>
        </DialogHeader>

        <p className="-mt-1 text-xs text-text-secondary">
          {t('setting.addCustomProviderHint')}
        </p>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs text-text-secondary">
              {t('setting.providerDisplayName')} *
            </label>
            <Input
              value={providerName}
              placeholder={t('setting.providerDisplayNamePlaceholder')}
              onChange={(e) => setProviderName(e.target.value)}
              data-testid="custom-provider-name"
            />
            <p className="mt-1 text-[11px] text-text-secondary">
              {t('setting.providerDisplayNameHint')}
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs text-text-secondary">
              {t('setting.providerDriver')} *
            </label>
            <select
              className="h-9 w-full rounded-md border border-border-default bg-bg-base px-2 text-sm"
              value={driver}
              onChange={(e) => setDriver(e.target.value)}
              data-testid="custom-provider-driver"
            >
              {DRIVER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-text-secondary">
              {t('setting.providerDriverHint')}
            </p>
          </div>

          <div className="col-span-2">
            <label className="mb-1 block text-xs text-text-secondary">
              {t('setting.providerBaseUrl')} *
            </label>
            <Input
              value={baseUrl}
              placeholder="http://10.0.1.20:8000/v1"
              onChange={(e) => setBaseUrl(e.target.value)}
              data-testid="custom-provider-base-url"
            />
            <p className="mt-1 text-[11px] text-text-secondary">
              {t('setting.providerBaseUrlHint')}
            </p>
          </div>

          <div className="col-span-2">
            <label className="mb-1 block text-xs text-text-secondary">
              {t('setting.providerApiKey')}
            </label>
            <Input
              type="password"
              value={apiKey}
              placeholder={t('setting.providerApiKeyPlaceholder')}
              onChange={(e) => setApiKey(e.target.value)}
              data-testid="custom-provider-api-key"
            />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs text-text-secondary">
              {t('setting.providerModels')} *
            </span>
            <span className="flex-1" />
            <Button
              size="sm"
              variant="outline"
              onClick={() => setModels((prev) => [...prev, { name: '', type: 'chat' }])}
              data-testid="custom-provider-add-row"
            >
              <Plus className="size-3.5" />
              {t('setting.providerAddModel')}
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            {models.map((row, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  value={row.name}
                  placeholder={t('setting.providerModelNamePlaceholder')}
                  onChange={(e) =>
                    setModels((prev) =>
                      prev.map((m, i) =>
                        i === idx ? { ...m, name: e.target.value } : m,
                      ),
                    )
                  }
                  data-testid={`custom-provider-model-name-${idx}`}
                />
                <select
                  className="h-9 w-36 shrink-0 rounded-md border border-border-default bg-bg-base px-2 text-sm"
                  value={row.type}
                  onChange={(e) =>
                    setModels((prev) =>
                      prev.map((m, i) =>
                        i === idx ? { ...m, type: e.target.value } : m,
                      ),
                    )
                  }
                  data-testid={`custom-provider-model-type-${idx}`}
                >
                  {MODEL_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={models.length <= 1}
                  onClick={() =>
                    setModels((prev) => prev.filter((_, i) => i !== idx))
                  }
                  data-testid={`custom-provider-remove-row-${idx}`}
                >
                  <Minus className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-text-secondary">
            {t('setting.providerModelsHint')}
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => {
              reset();
              hideModal();
            }}
          >
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => void onConfirm()}
            disabled={!canSubmit || submitting}
            data-testid="custom-provider-submit"
          >
            {submitting ? '…' : t('common.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
