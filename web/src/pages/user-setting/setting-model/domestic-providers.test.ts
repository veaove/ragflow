import {
  DOMESTIC_PROVIDER_NAMES,
  filterVisibleProviders,
  isDomesticProvider,
} from './domestic-providers';

describe('模型配置页的国内服务商白名单', () => {
  it('没有重复项 —— 重复说明某次补充写了两遍，容易掩盖漏项', () => {
    expect(new Set(DOMESTIC_PROVIDER_NAMES).size).toBe(
      DOMESTIC_PROVIDER_NAMES.length,
    );
  });

  it('放行已经配置在线的两个国内厂商', () => {
    expect(isDomesticProvider('DeepSeek')).toBe(true);
    expect(isDomesticProvider('Tongyi-Qianwen')).toBe(true);
  });

  it('挡住境外厂商', () => {
    for (const name of [
      'OpenAI',
      'Anthropic',
      'Gemini',
      'xAI',
      'Mistral',
      'Cohere',
      'Bedrock',
      'Azure-OpenAI',
      'Groq',
      'HuggingFace',
      'OpenRouter',
      'TogetherAI',
      'Perplexity',
      'Replicate',
      'DeepInfra',
      'NVIDIA',
      'NovitaAI',
      'Upstage',
      'Voyage AI',
      'Jina',
    ]) {
      expect(isDomesticProvider(name)).toBe(false);
    }
  });

  it('本地推理运行时与私有网关入口要保留', () => {
    for (const name of [
      'Ollama',
      'VLLM',
      'Xinference',
      'LocalAI',
      'LM-Studio',
      'GPUStack',
      'OpenAI-API-Compatible',
    ]) {
      expect(isDomesticProvider(name)).toBe(true);
    }
  });

  it('查不到归属的名称默认不显示（白名单的默认动作是隐藏）', () => {
    expect(isDomesticProvider('OrcaRouter')).toBe(false);
    expect(isDomesticProvider('AnonRouter')).toBe(false);
    expect(isDomesticProvider('')).toBe(false);
  });
});

describe('列表过滤', () => {
  const providers = [
    { name: 'DeepSeek' },
    { name: 'OpenAI' },
    { name: 'Moonshot' },
    { name: 'Anthropic' },
  ];

  it('未配置时只留国内厂商，且保持原顺序', () => {
    const visible = filterVisibleProviders(providers, new Set());
    expect(visible.map((p) => p.name)).toEqual(['DeepSeek', 'Moonshot']);
  });

  it('已经配置过的境外厂商照常显示，否则那个实例就没法管理了', () => {
    const visible = filterVisibleProviders(providers, new Set(['OpenAI']));
    expect(visible.map((p) => p.name)).toEqual([
      'DeepSeek',
      'OpenAI',
      'Moonshot',
    ]);
  });

  it('空列表不报错', () => {
    expect(filterVisibleProviders([], new Set(['OpenAI']))).toEqual([]);
  });
});
