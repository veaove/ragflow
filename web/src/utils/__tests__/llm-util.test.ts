import {
  addTenantParams,
  buildModelValue,
  getEmbeddingBaseName,
  isOpaqueModelId,
  parseModelUuid,
  parseModelValue,
  resolveModelDisplayName,
} from '../llm-util';
import { IAddedModel } from '@/interfaces/database/llm';

// Composite model keys are right-anchored:
// "model_name@instance_name@provider_name" or "model_name@provider_name".
// Model names may legally contain '@' (LM Studio IDs like
// "text-embedding-nomic-embed-text-v1.5@q8_0"), so the parser must split from
// the right and only treat the last two '@'-separated fields as instance and
// provider. Mirrors api/db/joint_services/tenant_model_service.py
// split_model_name (PR #16468).

describe('parseModelValue — right-anchored split', () => {
  test('plain 3-part composite', () => {
    expect(parseModelValue('gemma@lmstudio@LM-Studio')).toEqual({
      model_name: 'gemma',
      model_instance: 'lmstudio',
      model_provider: 'LM-Studio',
    });
  });

  test('2-part composite defaults instance to "default"', () => {
    expect(parseModelValue('gemma@LM-Studio')).toEqual({
      model_name: 'gemma',
      model_instance: 'default',
      model_provider: 'LM-Studio',
    });
  });

  test('4-part composite with embedded "@" in model name (LM Studio embedding)', () => {
    expect(
      parseModelValue(
        'text-embedding-nomic-embed-text-v1.5@q8_0@lmstudio@LM-Studio',
      ),
    ).toEqual({
      model_name: 'text-embedding-nomic-embed-text-v1.5@q8_0',
      model_instance: 'lmstudio',
      model_provider: 'LM-Studio',
    });
  });

  test('quants with multiple "@" in model name still anchor on the last two', () => {
    expect(parseModelValue('org/model@sha@q8_0@default@Builtin')).toEqual({
      model_name: 'org/model@sha@q8_0',
      model_instance: 'default',
      model_provider: 'Builtin',
    });
  });

  test('returns null for empty input', () => {
    expect(parseModelValue('')).toBeNull();
  });

  test('returns null when no "@" is present', () => {
    expect(parseModelValue('plain-model-name')).toBeNull();
  });
});

describe('buildModelValue round-trips parseModelValue', () => {
  test('simple triplet', () => {
    const v = buildModelValue({
      model_name: 'gemma',
      model_instance: 'lmstudio',
      model_provider: 'LM-Studio',
    });
    expect(v).toBe('gemma@lmstudio@LM-Studio');
    expect(parseModelValue(v)).toEqual({
      model_name: 'gemma',
      model_instance: 'lmstudio',
      model_provider: 'LM-Studio',
    });
  });

  test('round-trip survives embedded "@" in model name', () => {
    const v = buildModelValue({
      model_name: 'text-embedding-nomic-embed-text-v1.5@q8_0',
      model_instance: 'lmstudio',
      model_provider: 'LM-Studio',
    });
    expect(v).toBe(
      'text-embedding-nomic-embed-text-v1.5@q8_0@lmstudio@LM-Studio',
    );
    expect(parseModelValue(v)).toEqual({
      model_name: 'text-embedding-nomic-embed-text-v1.5@q8_0',
      model_instance: 'lmstudio',
      model_provider: 'LM-Studio',
    });
  });
});

describe('parseModelUuid — right-anchored', () => {
  test('simple "model@factory" splits on the last "@"', () => {
    expect(parseModelUuid('gpt-4@ZHIPU-AI')).toEqual({
      modelName: 'gpt-4',
      factoryId: 'ZHIPU-AI',
    });
  });

  test('preserves embedded "@" in the model name (LM Studio)', () => {
    expect(
      parseModelUuid('text-embedding-nomic-embed-text-v1.5@q8_0@lmstudio'),
    ).toEqual({
      modelName: 'text-embedding-nomic-embed-text-v1.5@q8_0',
      factoryId: 'lmstudio',
    });
  });

  test('ignores "#instance" suffix when splitting the factory portion', () => {
    expect(parseModelUuid('gpt-4@ZHIPU-AI#CI')).toEqual({
      modelName: 'gpt-4',
      factoryId: 'ZHIPU-AI',
    });
  });

  test('returns empty factoryId when no "@" is present', () => {
    expect(parseModelUuid('plain-model')).toEqual({
      modelName: 'plain-model',
      factoryId: '',
    });
  });
});

describe('getEmbeddingBaseName — dataset co-selection grouping', () => {
  test('3-part composite reduces to bare model name', () => {
    expect(getEmbeddingBaseName('BAAI/bge-m3@renew@SILICONFLOW')).toBe(
      'BAAI/bge-m3',
    );
  });

  test('same model through different instances shares one base name', () => {
    expect(
      getEmbeddingBaseName('BAAI/bge-m3@renew@SILICONFLOW') ===
        getEmbeddingBaseName('BAAI/bge-m3@COPY@SILICONFLOW'),
    ).toBe(true);
  });

  test('2-part composite strips the provider', () => {
    expect(getEmbeddingBaseName('BAAI/bge-m3@SILICONFLOW')).toBe('BAAI/bge-m3');
  });

  test('model names containing "@" keep their suffix', () => {
    expect(
      getEmbeddingBaseName(
        'text-embedding-nomic-embed-text-v1.5@q8_0@lmstudio@LM-Studio',
      ),
    ).toBe('text-embedding-nomic-embed-text-v1.5@q8_0');
  });

  test('opaque tenant_model id is returned unchanged', () => {
    expect(getEmbeddingBaseName('2d8ff0a97d75431c8c91526549939328')).toBe(
      '2d8ff0a97d75431c8c91526549939328',
    );
  });

  test('empty and undefined values produce an empty base name', () => {
    expect(getEmbeddingBaseName('')).toBe('');
    expect(getEmbeddingBaseName(undefined)).toBe('');
  });
});

describe('addTenantParams — clearing model selections', () => {
  test('clears a stale tenant rerank model id when rerank is explicitly cleared', () => {
    expect(
      addTenantParams(
        {
          rerank_id: '',
          tenant_rerank_id: 'stale-tenant-model-id',
        },
        '/api/v1/memories',
      ),
    ).toEqual({
      rerank_id: '',
      tenant_rerank_id: null,
    });
  });

  test('preserves the tenant rerank model id when rerank is not part of the request', () => {
    expect(
      addTenantParams(
        { tenant_rerank_id: 'existing-tenant-model-id' },
        '/api/v1/memories',
      ),
    ).toEqual({ tenant_rerank_id: 'existing-tenant-model-id' });
  });
});

describe('addTenantParams — endpoints that store plain model ids', () => {
  // Chats and datasets persist the plain model id and resolve it server-side.
  // Injecting a tenant_* id here is not just useless: PUT /datasets/:id runs a
  // strict field whitelist, so the injected key made the retrieval-test panel's
  // save fail with "extra inputs are not permitted: tenant_rerank_id".
  test.each(['/api/v1/chats/chat-id', '/api/v1/datasets/dataset-id'])(
    'leaves the payload untouched for %s',
    (url) => {
      expect(
        addTenantParams(
          { rerank_id: '', tenant_rerank_id: 'stale-tenant-model-id' },
          url,
        ),
      ).toEqual({ rerank_id: '', tenant_rerank_id: 'stale-tenant-model-id' });
    },
  );
});

// 列表页展示的是模型的中文/可读名称，绝不能把持久化 id 直接渲染出来。
// 这三种存储形态在库里并存，解析必须全部覆盖，解析不出来时才允许兜底 "-"。
describe('resolveModelDisplayName — 列表展示用的名称解析', () => {
  const buildModel = (partial: Partial<IAddedModel>): IAddedModel => ({
    model_id: '',
    model_type: ['chat'],
    name: '',
    provider_id: 'p-1',
    provider_name: 'DeepSeek',
    instance_id: 'i-1',
    instance_name: 'default',
    ...partial,
  });

  const models: IAddedModel[] = [
    buildModel({
      model_id: '9b2c4f1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
      name: 'deepseek-chat___DeepSeek',
    }),
    buildModel({
      model_id: 'model-2',
      name: 'bge-reranker-v2-m3',
      provider_name: 'BAAI',
      instance_name: 'default',
      model_type: ['rerank'],
    }),
  ];

  test('uuid 形态按 model_id 映射成模型名（去掉 "___provider" 后缀）', () => {
    expect(
      resolveModelDisplayName(
        '9b2c4f1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
        models,
      ),
    ).toBe('deepseek-chat');
  });

  test('三段复合 id 按 name+instance+provider 命中', () => {
    expect(
      resolveModelDisplayName('deepseek-chat@default@DeepSeek', models),
    ).toBe('deepseek-chat');
  });

  test('复合 id 里的模型已被删除时，退回复合值自带的模型名而不是整串 id', () => {
    expect(
      resolveModelDisplayName('qwen-max@default@Alibaba', models),
    ).toBe('qwen-max');
  });

  test('内置重排模型名本身就是可读名称，原样展示', () => {
    expect(
      resolveModelDisplayName('BAAI/bge-reranker-v2-m3', models),
    ).toBe('BAAI/bge-reranker-v2-m3');
  });

  test('陌生 uuid 解析不出来，返回空串由调用方兜底 "-"', () => {
    expect(
      resolveModelDisplayName('7f3e2a10-9c4b-42d8-8f11-6a0b5c9d2e37', models),
    ).toBe('');
    expect(resolveModelDisplayName('0123456789abcdef0123456789abcdef', [])).toBe(
      '',
    );
  });

  test('空值不崩', () => {
    expect(resolveModelDisplayName(undefined, models)).toBe('');
    expect(resolveModelDisplayName('', models)).toBe('');
    expect(resolveModelDisplayName('   ', models)).toBe('');
  });
});

describe('isOpaqueModelId', () => {
  test.each([
    '9b2c4f1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
    '0123456789abcdef0123456789abcdef',
    '123456',
  ])('把 %s 判为纯标识符', (value) => {
    expect(isOpaqueModelId(value)).toBe(true);
  });

  test.each(['deepseek-chat', 'BAAI/bge-reranker-v2-m3', 'gpt-4o-mini'])(
    '把 %s 判为可读名称',
    (value) => {
      expect(isOpaqueModelId(value)).toBe(false);
    },
  );
});
