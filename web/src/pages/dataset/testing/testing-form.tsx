'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { CrossLanguageFormField } from '@/components/cross-language-form-field';
import { FormContainer } from '@/components/form-container';
import {
  RerankCandidatesCountFormField,
  rerankCandidatesCountSchema,
} from '@/components/rerank-candidates-count-item';
import {
  MetadataFilter,
  MetadataFilterSchema,
} from '@/components/metadata-filter';
import { RerankFormFields } from '@/components/rerank';
import {
  SimilaritySliderFormField,
  initialSimilarityThresholdValue,
  initialKeywordsSimilarityWeightValue,
  similarityThresholdSchema,
  keywordsSimilarityWeightSchema,
} from '@/components/similarity-slider';
import { TopSelectFormItem } from '@/components/top-select';
import { ButtonLoading } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';

import { useTestRetrieval } from '@/hooks/use-knowledge-request';
import { ITestRetrievalRequestBody } from '@/interfaces/request/knowledge';
import { trim } from 'lodash';
import { Send } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { useOwnerTenantId } from '../contexts/knowledge-base-context';

type TestingFormProps = Pick<
  ReturnType<typeof useTestRetrieval>,
  'loading' | 'refetch' | 'setValues'
>;

const TEST_SETTINGS_STORAGE_PREFIX = 'ragflow:retrieval-test-settings:';

// The retrieval test panel is a sandbox, so its configuration is not part of
// the knowledge base record — nothing persisted it, and reopening the page
// silently reset the rerank model and sliders to their defaults. Persist the
// configuration subset (never `question`, which changes with every run, nor
// `dataset_ids`, which is bound to the route) so the panel reopens with the
// user's last setup.
const PERSISTED_SETTING_FIELDS = [
  'similarity_threshold',
  'keywords_similarity_weight',
  'page_size',
  'rerank_candidates_count',
  'rerank_id',
  'cross_languages',
  'meta_data_filter',
] as const;

type PersistedTestingSettings = Partial<{
  similarity_threshold: number;
  keywords_similarity_weight: number;
  page_size: number;
  rerank_candidates_count: number;
  rerank_id: string;
  cross_languages: string[];
  meta_data_filter: Record<string, unknown>;
}>;

function clampNumber(value: unknown, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : undefined;
}

// Restoring must never inject a value the form would reject, so every field is
// re-validated against the same range its schema enforces.
function sanitizePersistedSettings(raw: unknown): PersistedTestingSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const input = raw as Record<string, unknown>;
  const settings: PersistedTestingSettings = {};

  const similarityThreshold = clampNumber(input.similarity_threshold, 0, 1);
  if (similarityThreshold !== undefined) {
    settings.similarity_threshold = similarityThreshold;
  }

  const keywordsWeight = clampNumber(
    input.keywords_similarity_weight,
    0,
    1,
  );
  if (keywordsWeight !== undefined) {
    settings.keywords_similarity_weight = keywordsWeight;
  }

  const pageSize = clampNumber(input.page_size, 1, 100);
  if (pageSize !== undefined) {
    settings.page_size = Math.round(pageSize);
  }

  const rerankCandidatesCount = clampNumber(
    input.rerank_candidates_count,
    64,
    256,
  );
  if (rerankCandidatesCount !== undefined) {
    settings.rerank_candidates_count = Math.round(rerankCandidatesCount);
  }

  if (typeof input.rerank_id === 'string') {
    settings.rerank_id = input.rerank_id;
  }

  if (Array.isArray(input.cross_languages)) {
    settings.cross_languages = input.cross_languages.filter(
      (item): item is string => typeof item === 'string',
    );
  }

  if (
    input.meta_data_filter &&
    typeof input.meta_data_filter === 'object' &&
    !Array.isArray(input.meta_data_filter)
  ) {
    settings.meta_data_filter = input.meta_data_filter as Record<
      string,
      unknown
    >;
  }

  return settings;
}

function readPersistedTestingSettings(
  knowledgeBaseId?: string,
): PersistedTestingSettings {
  if (!knowledgeBaseId || typeof window === 'undefined') {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(
      `${TEST_SETTINGS_STORAGE_PREFIX}${knowledgeBaseId}`,
    );
    return raw ? sanitizePersistedSettings(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function writePersistedTestingSettings(
  knowledgeBaseId: string | undefined,
  settings: PersistedTestingSettings,
) {
  if (!knowledgeBaseId || typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(
      `${TEST_SETTINGS_STORAGE_PREFIX}${knowledgeBaseId}`,
      JSON.stringify(settings),
    );
  } catch {
    // Private mode / quota exceeded — persistence is best-effort.
  }
}

function pickPersistedSettings(
  values: Record<string, unknown> | undefined,
): PersistedTestingSettings {
  if (!values) {
    return {};
  }
  const picked: Record<string, unknown> = {};
  for (const field of PERSISTED_SETTING_FIELDS) {
    if (values[field] !== undefined) {
      picked[field] = values[field];
    }
  }
  return picked as PersistedTestingSettings;
}

export default function TestingForm({
  loading,
  refetch,
  setValues,
}: TestingFormProps) {
  const { t } = useTranslation();
  const { id } = useParams();
  const ownerTenantId = useOwnerTenantId();
  const knowledgeBaseId = id;

  const formSchema = z
    .object({
      question: z.string().min(1, {
        message: t('knowledgeDetails.testTextPlaceholder'),
      }),
      ...similarityThresholdSchema,
      ...keywordsSimilarityWeightSchema,
      dataset_ids: z.array(z.string()).optional(),
      ...MetadataFilterSchema,
      page_size: z.number().int().min(1).max(100),
      ...rerankCandidatesCountSchema,
    })
    .refine((values) => values.rerank_candidates_count >= values.page_size, {
      message: t('chat.rerankCandidatesCountValidation'),
      path: ['rerank_candidates_count'],
    });

  const persistedSettings = useMemo(
    () => readPersistedTestingSettings(knowledgeBaseId),
    [knowledgeBaseId],
  );

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      ...initialSimilarityThresholdValue,
      ...initialKeywordsSimilarityWeightValue,
      dataset_ids: [knowledgeBaseId],
      page_size: 10,
      rerank_candidates_count: 64,
      ...persistedSettings,
    },
  });

  const question = form.watch('question');

  const values = useWatch({ control: form.control });

  // Serialise only the configuration subset in a fixed key order, so typing the
  // test question (or any other transient field) never counts as a save.
  const settingsSnapshot = useMemo(
    () => JSON.stringify(pickPersistedSettings(values as Record<string, unknown>)),
    [values],
  );

  const lastSavedSnapshotRef = useRef(settingsSnapshot);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setValues(values as ITestRetrievalRequestBody);
  }, [setValues, values]);

  useEffect(() => {
    // The settings are live already — this only persists them so the next visit
    // reopens with the same configuration, and confirms the save to the user.
    if (settingsSnapshot === lastSavedSnapshotRef.current) {
      return;
    }

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      writePersistedTestingSettings(
        knowledgeBaseId,
        JSON.parse(settingsSnapshot) as PersistedTestingSettings,
      );
      lastSavedSnapshotRef.current = settingsSnapshot;
      toast.success(t('knowledgeDetails.testingSettingsSaved'));
    }, 600);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [settingsSnapshot, knowledgeBaseId, t]);

  function onSubmit() {
    refetch();
  }

  return (
    <Form {...form}>
      <form
        className="size-full flex flex-col"
        onSubmit={form.handleSubmit(onSubmit)}
      >
        <div className="px-5 h-0 flex-1">
          <FormContainer className="p-5 h-full overflow-auto">
            <SimilaritySliderFormField
              isTooltipShown={true}
            ></SimilaritySliderFormField>
            <RerankFormFields ownerTenantId={ownerTenantId}></RerankFormFields>
            <CrossLanguageFormField
              name={'cross_languages'}
            ></CrossLanguageFormField>
            <MetadataFilter prefix=""></MetadataFilter>
            <RerankCandidatesCountFormField></RerankCandidatesCountFormField>
            <TopSelectFormItem></TopSelectFormItem>
          </FormContainer>
        </div>

        <footer className="flex-0 p-5">
          <FormField
            control={form.control}
            name="question"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Textarea
                    {...field}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        form.handleSubmit(onSubmit)();
                      }
                    }}
                  ></Textarea>
                </FormControl>

                <FormMessage />
              </FormItem>
            )}
          />

          <div className="mt-2.5 text-end">
            <ButtonLoading
              type="submit"
              disabled={!trim(question)}
              loading={loading}
            >
              {/* {!loading && <CirclePlay />} */}
              {t('knowledgeDetails.testingLabel')}
              <Send />
            </ButtonLoading>
          </div>
        </footer>
      </form>
    </Form>
  );
}
