import { useUpdateKnowledge } from '@/hooks/use-knowledge-request';
import { act, renderHook } from '@testing-library/react';
import { useSaveDatasetSetting } from './hooks';

jest.mock('@/hooks/use-knowledge-request', () => ({
  useFetchDatasetPipelineConfiguration: jest.fn(),
  useUpdateKnowledge: jest.fn(),
}));
jest.mock('@/pages/user-setting/data-source/constant', () => ({
  useDataSourceInfo: jest.fn(() => ({ dataSourceInfo: {} })),
}));
jest.mock('@/services/knowledge-service', () => ({
  checkEmbedding: jest.fn(),
}));

// 能力位来自知识库详情；不 mock 的话 hook 会因为缺少 Provider 直接抛错。
let mockKnowledgeBase: Record<string, unknown> = {};

jest.mock('../contexts/knowledge-base-context', () => ({
  __esModule: true,
  useKnowledgeBaseContext: () => ({
    knowledgeBase: mockKnowledgeBase,
    loading: false,
  }),
}));

const mockUseUpdateKnowledge = jest.mocked(useUpdateKnowledge);

describe('useSaveDatasetSetting parser_config metadata scoping', () => {
  beforeEach(() => {
    mockUseUpdateKnowledge.mockReset();
    mockKnowledgeBase = {};
  });

  function setup() {
    const saveKnowledgeConfiguration = jest.fn();
    mockUseUpdateKnowledge.mockReturnValue({
      saveKnowledgeConfiguration,
      loading: false,
    } as never);
    const { result } = renderHook(() => useSaveDatasetSetting());
    return { handleSave: result.current.handleSave, saveKnowledgeConfiguration, result };
  }

  // 配置页对只读成员可读不可写：保存要按 update 判定，别发那次注定被后端
  // 收敛成 404 Resource not found 的请求，由页面弹框说清缺哪条授权。
  it('refuses to save for a read-only member instead of firing a doomed request', async () => {
    mockKnowledgeBase = { capabilities: { update: false } };
    const { handleSave, saveKnowledgeConfiguration, result } = setup();

    await act(async () => {
      await handleSave({ parse_type: 'built-in' } as never);
    });

    expect(saveKnowledgeConfiguration).not.toHaveBeenCalled();
    expect(result.current.saveDenied).toBe(true);
  });

  it('still saves when the caller may edit', async () => {
    mockKnowledgeBase = { capabilities: { update: true } };
    const { handleSave, saveKnowledgeConfiguration, result } = setup();

    await act(async () => {
      await handleSave({ parse_type: 'built-in' } as never);
    });

    expect(saveKnowledgeConfiguration).toHaveBeenCalledTimes(1);
    expect(result.current.saveDenied).toBe(false);
  });

  it('keeps the extractor node metadata authoritative and emits no flat metadata key', async () => {
    const { handleSave, saveKnowledgeConfiguration } = setup();

    await handleSave({
      parse_type: 'built-in',
      parser_config: {
        'Extractor:AutoExtractDefault': {
          llm_id: 'llm-a',
          metadata: {
            enabled: true,
            metadata: [],
            built_in_metadata: [{ key: 'update_time', type: 'time' }],
          },
        },
        metadata: {
          enabled: false,
          metadata: [],
          built_in_metadata: [],
        },
      },
    } as never);

    const payload = saveKnowledgeConfiguration.mock.calls[0][0];
    // The Go backend requires component-scoped keys: no flat `metadata` transport
    // key is emitted, and the extractor node's own metadata wins over any stale
    // top-level copy present in the form payload.
    expect(payload.parser_config).not.toHaveProperty('metadata');
    expect(
      payload.parser_config['Extractor:AutoExtractDefault'].metadata,
    ).toEqual({
      enabled: true,
      metadata: [],
      built_in_metadata: [{ key: 'update_time', type: 'time' }],
    });
  });

  it('does not emit a flat metadata key when the pipeline has no extractor', async () => {
    const { handleSave, saveKnowledgeConfiguration } = setup();

    await handleSave({
      parse_type: 'built-in',
      parser_config: {
        'Tokenizer:SomeNode': { fields: 'text' },
        metadata: {
          enabled: true,
          metadata: [],
          built_in_metadata: [],
        },
      },
    } as never);

    const payload = saveKnowledgeConfiguration.mock.calls[0][0];
    expect(payload.parser_config).not.toHaveProperty('metadata');
    expect(payload.parser_config['Tokenizer:SomeNode']).toEqual({
      fields: 'text',
    });
  });
});
