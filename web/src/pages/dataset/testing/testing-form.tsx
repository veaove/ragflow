'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { CrossLanguageFormField } from '@/components/cross-language-form-field';
import { FormContainer } from '@/components/form-container';
import { PermissionDeniedDialog } from '@/components/permission-denied-dialog';
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
import { isEditPermissionDenied } from '@/utils/permission-error';
import { trim } from 'lodash';
import { Send } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import {
  useKnowledgeBaseContext,
  useOwnerTenantId,
} from '../contexts/knowledge-base-context';

type TestingFormProps = Pick<
  ReturnType<typeof useTestRetrieval>,
  'loading' | 'refetch' | 'setValues'
>;

type PersistedTestingSettings = {
  similarity_threshold: number;
  keywords_similarity_weight: number;
  rerank_id: string;
  /**
   * 下面 4 项是**检索引擎请求参数**，知识库表里没有对应列，因此存浏览器本地：
   * 跨语言搜索、元数据过滤、重排候选数、Top N。
   * 之前只持久化了上面 3 个 KB 字段，改这几项一刷新就回到默认值。
   */
  cross_languages?: string[];
  metadata?: Record<string, unknown>;
  rerank_candidates_count?: number;
  page_size?: number;
};

const LOCAL_SETTINGS_PREFIX = 'kb-testing-settings';

function loadLocalTestingSettings(
  kbId: string | undefined,
): Partial<PersistedTestingSettings> {
  if (!kbId) {
    return {};
  }
  try {
    const raw = localStorage.getItem(`${LOCAL_SETTINGS_PREFIX}:${kbId}`);
    return raw ? (JSON.parse(raw) as Partial<PersistedTestingSettings>) : {};
  } catch {
    return {};
  }
}

function saveLocalTestingSettings(
  kbId: string | undefined,
  settings: Partial<PersistedTestingSettings>,
) {
  if (!kbId) {
    return;
  }
  try {
    localStorage.setItem(
      `${LOCAL_SETTINGS_PREFIX}:${kbId}`,
      JSON.stringify(settings),
    );
  } catch {
    // 隐私模式/配额满时静默失败：不能因为存不进去让用户改配置报错。
  }
}

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
    cross_languages: values.cross_languages ?? [],
    metadata: values.metadata ?? {},
    rerank_candidates_count: values.rerank_candidates_count,
    page_size: values.page_size,
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
  // 测试设置要写回知识库（rerank 模型、阈值、权重），这需要「可编辑」权限；
  // 只读成员读得到知识库、也跑得了检索测试，但保存每一次都会被资源层拒绝。
  // 判定由资源层给出（详情里的 capabilities.update），本页只负责别再发那次请求。
  const { knowledgeBase } = useKnowledgeBaseContext();
  const canPersistSettings = knowledgeBase?.capabilities?.update !== false;
  const [saveDeniedOpen, setSaveDeniedOpen] = useState(false);

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
  // 「保存不了」只解释一次：滑块每动一格都是一次改动，反复弹框等于骚扰。
  const saveDeniedShownRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current || !configuration?.id) {
      return;
    }
    initializedRef.current = true;

    const restored = defaultsFromConfiguration(configuration);
    // local 覆盖后端默认：本地存的是用户上次的点选（跨语言/元数据/TopN 等
    // 后端没有列、无法随 KB 返回的项）。
    const local = loadLocalTestingSettings(knowledgeBaseId);
    const nextValues = {
      ...form.getValues(),
      ...restored,
      ...local,
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
    // 先取消上一次待写，再判断要不要写：配置到达时这一轮快照取自 reset 之前的
    // 默认值，会被当成一次「改动」；随后 reset 把快照拉回基线，那个定时器必须
    // 一起撤销，否则打开页面就会白写一次知识库（只读成员还会平白被拒一次）。
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    if (settingsSnapshot === lastSavedSnapshotRef.current) {
      return;
    }

    const pendingSnapshot = settingsSnapshot;

    saveTimerRef.current = setTimeout(async () => {
      const settings = JSON.parse(pendingSnapshot) as PersistedTestingSettings;
      // 先落本地：跨语言/元数据/重排候选/TopN 后端没有列，只能存这里。
      saveLocalTestingSettings(knowledgeBaseId, settings);

      // 只读成员写不回知识库。改动已经在本地生效、本次检索测试也按新值跑，
      // 所以这里不再发那次注定被资源层拒绝（并被收敛成 404）的请求，只在
      // 第一次挡住时说清楚：改动能用，但不会被保存到知识库。
      if (!canPersistSettings) {
        if (!saveDeniedShownRef.current) {
          saveDeniedShownRef.current = true;
          setSaveDeniedOpen(true);
        }
        return;
      }

      try {
        const { data } = await updateKb(
          knowledgeBaseId,
          {
            similarity_threshold: settings.similarity_threshold,
            keywords_similarity_weight: settings.keywords_similarity_weight,
            // An empty string is meaningful here: it clears the saved model.
            rerank_id: settings.rerank_id ?? '',
          },
          // 权限拒绝被后端收敛成 404 "Resource not found"，由弹框解释；
          // 不让请求层再弹一条「错误 : 404」。其它业务码仍走全局提示。
          { skipErrorCodes: [404] },
        );

        if (data?.code === 0) {
          lastSavedSnapshotRef.current = pendingSnapshot;
          toast.success(t('knowledgeDetails.testingSettingsSaved'));
          return;
        }
        if (isEditPermissionDenied(data)) {
          setSaveDeniedOpen(true);
        }
        // 其余非零码由请求层的全局提示负责，这里不重复弹。
        // 基线不前进，下一次改动会重试，而不是假装已经保存。
      } catch {
        // Network-layer failures are surfaced by the interceptor too.
      }
    }, 600);

    // The pending save is deliberately not cancelled here: the debounce exists
    // to collapse slider drags, not to drop them. Clearing the timer on every
    // re-run would also cancel it on unmount, so changing a setting and
    // leaving the page within 600ms would silently lose the change. The body
    // above already cancels the previous timer before scheduling a new one.
  }, [settingsSnapshot, knowledgeBaseId, t, canPersistSettings]);

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

      <PermissionDeniedDialog
        open={saveDeniedOpen}
        title="测试设置未能保存"
        description="你对这个知识库只有「可查看」权限，测试设置无法保存到知识库。本次改动会立即用于当前检索测试，并记在本机浏览器里（换设备或清缓存后会恢复原设置）。如需长期保存，请联系知识库所有者或本租户管理员调整授权。"
        testId="testing-settings-save-denied"
        onClose={() => setSaveDeniedOpen(false)}
      />
    </Form>
  );
}
