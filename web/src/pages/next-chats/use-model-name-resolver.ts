import { useFetchAllAddedModels } from '@/hooks/use-llm-request';
import { resolveModelDisplayName } from '@/utils/llm-util';
import { useCallback } from 'react';
import { EMPTY_LABEL } from './chat-labels';

/**
 * 模型 / 重排模型列共用的解析器：把持久化的 id（uuid 或复合值）解析成可读名称，
 * 解析不到统一兜底 "-"，绝不把原始 id 渲染到界面上。
 *
 * 与 `chat-labels.ts` 分开是为了让那套纯函数能被单测直接引用——
 * 这个文件会把 React Query、服务层一起拉进来，测试环境跑不动。
 *
 * 模型列表只取一次（同一 queryKey 由 React Query 去重），每行都是一次内存
 * 查找，不会按行发请求。
 */
export function useModelNameResolver() {
  const { data: models } = useFetchAllAddedModels();

  return useCallback(
    (value?: string | null) =>
      resolveModelDisplayName(value, models) || EMPTY_LABEL,
    [models],
  );
}
