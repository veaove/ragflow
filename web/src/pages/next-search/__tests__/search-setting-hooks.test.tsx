import { renderHook } from '@testing-library/react';
import { useSearchSettingFormSchema } from '../search-setting-hooks';

const mockUseModelValidIds = jest.fn();

jest.mock('@/hooks/use-llm-request', () => ({
  useModelValidIds: (...args: unknown[]) => mockUseModelValidIds(...args),
}));

// The metadata-filter barrel drags the agent canvas (and, through it, the whole
// route table) into the test environment; only its field schema is spread into
// the search schema, so an empty object keeps the import graph light.
jest.mock('@/components/metadata-filter', () => ({ MetadataFilterSchema: {} }));

type ModelLookup = {
  validIds: Set<string>;
  isFetched: boolean;
  isError: boolean;
};

const lookup = (overrides: Partial<ModelLookup> = {}): ModelLookup => ({
  validIds: new Set<string>(),
  isFetched: true,
  isError: false,
  ...overrides,
});

// The hook asks for rerank ids first, then llm ids.
const mockLookups = ({
  rerank = lookup(),
  llm = lookup(),
}: { rerank?: ModelLookup; llm?: ModelLookup } = {}) => {
  mockUseModelValidIds.mockImplementation((modelTypes: string[]) =>
    modelTypes.includes('rerank') ? rerank : llm,
  );
};

const buildSearchForm = (llmId: string) => ({
  name: 'search',
  search_config: {
    kb_ids: ['kb-1'],
    keywords_similarity_weight: 0.7,
    web_search: false,
    similarity_threshold: 0.2,
    use_kg: false,
    rerank_id: '',
    use_rerank: false,
    rerank_candidates_count: 100,
    summary: true,
    llm_setting: { llm_id: llmId },
    related_search: false,
    query_mindmap: false,
    doc_ids: [],
    chat_id: '',
    highlight: false,
    keyword: false,
    chat_settingcross_languages: [],
  },
});

const unavailableIssues = (result: { success: boolean; error?: unknown }) =>
  result.success
    ? []
    : (
        result.error as {
          issues: Array<{ message: string; path: Array<string | number> }>;
        }
      ).issues.filter((issue) => issue.message === 'common.modelUnavailable');

describe('useSearchSettingFormSchema', () => {
  it('flags a persisted model that is gone from the tenant catalogue', () => {
    mockLookups({ llm: lookup({ validIds: new Set(['m1']) }) });
    const { result } = renderHook(() => useSearchSettingFormSchema());

    const issues = unavailableIssues(
      result.current.formSchema.safeParse(buildSearchForm('gone')),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual([
      'search_config',
      'llm_setting',
      'llm_id',
    ]);
  });

  it('accepts a model the tenant catalogue still lists', () => {
    mockLookups({ llm: lookup({ validIds: new Set(['m1']) }) });
    const { result } = renderHook(() => useSearchSettingFormSchema());

    expect(
      unavailableIssues(
        result.current.formSchema.safeParse(buildSearchForm('m1')),
      ),
    ).toHaveLength(0);
  });

  // A 403 or an unresolvable tenant also yields an empty id set; that is "we do
  // not know", not "the model is gone" — flagging it would paint the very same
  // red banner this validation exists to make meaningful.
  it('stays quiet when the model list failed to load', () => {
    mockLookups({ llm: lookup({ isError: true }) });
    const { result } = renderHook(() => useSearchSettingFormSchema());

    expect(result.current.modelsFetched).toBe(false);
    expect(
      unavailableIssues(
        result.current.formSchema.safeParse(buildSearchForm('gone')),
      ),
    ).toHaveLength(0);
  });

  it('stays quiet while the model list is still loading', () => {
    // Both lookups read the same added-models query, so they load together.
    mockLookups({
      rerank: lookup({ isFetched: false }),
      llm: lookup({ isFetched: false }),
    });
    const { result } = renderHook(() => useSearchSettingFormSchema());

    expect(
      unavailableIssues(
        result.current.formSchema.safeParse(buildSearchForm('gone')),
      ),
    ).toHaveLength(0);
  });
});
