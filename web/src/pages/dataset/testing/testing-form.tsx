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
import { RerankFormFields, rerankFormSchema } from '@/components/rerank';
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

import {
  useFetchKnowledgeBaseConfiguration,
  useTestRetrieval,
} from '@/hooks/use-knowledge-request';
import { IDataset } from '@/interfaces/database/dataset';
import { ITestRetrievalRequestBody } from '@/interfaces/request/knowledge';
import { updateKb } from '@/services/knowledge-service';
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

type PersistedTestingSettings = {
  similarity_threshold: number;
  keywords_similarity_weight: number;
  rerank_id: string;
};

// Sliders move in 0.01 steps, so rounding to two decimals is lossless and
// keeps a backend round trip (vector weight -> keyword weight -> vector
// weight) from drifting into a diff that would trigger a pointless save.
function roundWeight(value: number) {
  return Number(value.toFixed(2));
}

function clampWeight(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? roundWeight(Math.min(1, Math.max(0, value)))
    : undefined;
}

/**
 * The retrieval test panel used to be a pure sandbox: nothing persisted its
 * setup, so reopening the page silently reset the rerank model and the sliders
 * to their defaults. The setup now lives on the knowledge base record itself
 * (`similarity_threshold` / `vector_similarity_weight` / `rerank_id`), which is
 * what the retrieval API already reads, so a change takes effect immediately
 * and survives reloads and other devices.
 */
function defaultsFromConfiguration(
  configuration: IDataset | undefined,
): PersistedTestingSettings {
  return {
    similarity_threshold:
      clampWeight(configuration?.similarity_threshold) ??
      initialSimilarityThresholdValue.similarity_threshold,
    keywords_similarity_weight:
      clampWeight(configuration?.keywords_similarity_weight) ??
      initialKeywordsSimilarityWeightValue.keywords_similarity_weight,
    rerank_id: configuration?.rerank_id ?? '',
  };
}

/**
 * Serialises only the fields that are persisted, in a fixed key order, so
 * typing the test question (or changing any other transient field) never
 * counts as a settings change.
 */
function buildSnapshot(values: Partial<PersistedTestingSettings>) {
  return JSON.stringify({
    similarity_threshold: values.similarity_threshold,
    keywords_similarity_weight: values.keywords_similarity_weight,
    rerank_id: values.rerank_id ?? '',
  });
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

  const { data: configuration } = useFetchKnowledgeBaseConfiguration();

  const formSchema = z
    .object({
      question: z.string().min(1, {
        message: t('knowledgeDetails.testTextPlaceholder'),
      }),
      ...similarityThresholdSchema,
      ...keywordsSimilarityWeightSchema,
      ...rerankFormSchema,
      dataset_ids: z.array(z.string()).optional(),
      ...MetadataFilterSchema,
      page_size: z.number().int().min(1).max(100),
      ...rerankCandidatesCountSchema,
    })
    .refine((values) => values.rerank_candidates_count >= values.page_size, {
      message: t('chat.rerankCandidatesCountValidation'),
      path: ['rerank_candidates_count'],
    });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      ...initialSimilarityThresholdValue,
      ...initialKeywordsSimilarityWeightValue,
      // The rerank select is rendered here but was never declared in this
      // schema's defaults, so seed an explicit empty string: otherwise the
      // control flips from uncontrolled to controlled once the saved model
      // arrives from the server.
      rerank_id: '',
      dataset_ids: [knowledgeBaseId],
      page_size: 10,
      rerank_candidates_count: 64,
    },
  });

  const question = form.watch('question');

  const values = useWatch({ control: form.control });

  const settingsSnapshot = useMemo(() => buildSnapshot(values), [values]);

  // Until the knowledge base configuration arrives the form still holds the
  // global defaults, which would look like a user edit and overwrite the saved
  // setup. The snapshot doubles as the "already persisted" baseline.
  const initializedRef = useRef(false);
  const lastSavedSnapshotRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (initializedRef.current || !configuration?.id) {
      return;
    }
    initializedRef.current = true;

    const restored = defaultsFromConfiguration(configuration);
    const nextValues = {
      ...form.getValues(),
      ...restored,
    };
    form.reset(nextValues);
    lastSavedSnapshotRef.current = buildSnapshot(nextValues);
  }, [configuration, form]);

  useEffect(() => {
    setValues(values as ITestRetrievalRequestBody);
  }, [setValues, values]);

  useEffect(() => {
    // The settings are live already — this only persists them, so the panel
    // reopens with the same configuration, and confirms the save to the user.
    if (!initializedRef.current || !knowledgeBaseId) {
      return;
    }
    if (settingsSnapshot === lastSavedSnapshotRef.current) {
      return;
    }

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    const pendingSnapshot = settingsSnapshot;

    saveTimerRef.current = setTimeout(async () => {
      const settings = JSON.parse(pendingSnapshot) as PersistedTestingSettings;
      try {
        const { data } = await updateKb(knowledgeBaseId, {
          similarity_threshold: settings.similarity_threshold,
          keywords_similarity_weight: settings.keywords_similarity_weight,
          // An empty string is meaningful here: it clears the saved model.
          rerank_id: settings.rerank_id ?? '',
        });

        if (data?.code === 0) {
          lastSavedSnapshotRef.current = pendingSnapshot;
          toast.success(t('knowledgeDetails.testingSettingsSaved'));
        }
        // A non-zero code is already reported by the request interceptor's
        // global error notification, so adding another toast here would show
        // the same failure twice. Leaving the baseline untouched means the
        // next edit retries instead of pretending the settings were saved.
      } catch {
        // Network-layer failures are surfaced by the interceptor too.
      }
    }, 600);

    // The pending save is deliberately not cancelled here: the debounce exists
    // to collapse slider drags, not to drop them. Clearing the timer on every
    // re-run would also cancel it on unmount, so changing a setting and
    // leaving the page within 600ms would silently lose the change. The body
    // above already cancels the previous timer before scheduling a new one.
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
