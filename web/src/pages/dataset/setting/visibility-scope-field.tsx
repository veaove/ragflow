import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  GrantDialog,
  GrantTarget,
  VISIBILITY_OPTIONS,
  defaultScopeLabel,
} from '@/components/grant-dialog';
import { SelectWithSearch } from '@/components/originui/select-with-search';
import { Button } from '@/components/ui/button';
import { FormItem } from '@/components/ui/form';
import { Label } from '@/components/ui/label';
import { FormTooltip } from '@/components/ui/tooltip';
import { useConsolePermissions } from '@/hooks/use-console-permissions';
import { useGrantSubjectOptions } from '@/hooks/use-grant-subject-options';
import {
  GrantSubject,
  GrantTreeNode,
  GrantVisibility,
  fetchGrantTree,
  setGrants,
  setGrantVisibility,
} from '@/services/console-service';
import { useKnowledgeBaseContext } from '../contexts/knowledge-base-context';

/**
 * 可见范围的词表归一。
 *
 * 知识库的 permission 列最初只有 me / team 两个值，现在存的是资源授权读的
 * 三档；旧值按同一套语义折算，不再作为独立选项出现。
 */
export function normalizeVisibility(raw?: string): GrantVisibility {
  switch (raw) {
    case 'tenant_owner':
    case 'team':
      return 'tenant_owner';
    case 'platform':
      return 'platform';
    default:
      return 'owner';
  }
}

/**
 * 知识库配置里的「可见范围」。
 *
 * 与「资源授权」共用同一份数据和同一个弹窗：可见档位走 grants 的三档接口，
 * 逐人 / 逐部门授权走弹窗。这里不做「保存配置」的一部分 —— 改档位和授权都是
 * 立即生效的动作，混进表单会让「保存」按钮同时代表两件事，也让后保存的一份
 * 覆盖掉另一份。
 */
export function VisibilityScopeField() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { knowledgeBase } = useKnowledgeBaseContext();
  const { canView, can, isOwner } = useConsolePermissions();
  const [dialogOpen, setDialogOpen] = useState(false);

  const datasetId = knowledgeBase?.id ?? '';
  const tenantId = knowledgeBase?.tenant_id ?? '';
  // 写权限由后端按「租户管理层」判定，前端这里只是提前把按钮关掉，别让人点了
  // 才吃一个 403。
  const canManage = isOwner || can('grant', 'edit');
  const canReadGrants = canView('grant');

  const queryKey = useMemo(
    () => ['dataset/grant-node', tenantId, datasetId],
    [datasetId, tenantId],
  );

  // 树接口一次给出全部知识库的可见范围与规则：一个库不值得再猜关键词去翻页。
  const { data: node } = useQuery({
    queryKey,
    enabled: !!tenantId && !!datasetId && canReadGrants,
    queryFn: async () => {
      const res = await fetchGrantTree(tenantId, { kind: 'dataset' });
      const flat: GrantTreeNode[] = [];
      const walk = (nodes: GrantTreeNode[]) => {
        nodes.forEach((item) => {
          flat.push(item);
          if (item.children?.length) walk(item.children);
        });
      };
      walk(res?.data?.data?.nodes ?? []);
      return flat.find((item) => item.id === datasetId) ?? null;
    },
  });

  const { options } = useGrantSubjectOptions(tenantId);

  const scope = normalizeVisibility(
    node?.visibility || knowledgeBase?.permission,
  );
  const grants: GrantSubject[] = node?.grants ?? [];

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  const handleScopeChange = useCallback(
    async (value: string) => {
      try {
        await setGrantVisibility(
          tenantId,
          'dataset',
          datasetId,
          normalizeVisibility(value),
        );
      } catch (error) {
        // 请求层已经把原因说给用户了，这里只留痕。
        console.error('set dataset visibility failed:', error);
      } finally {
        refresh();
      }
    },
    [datasetId, refresh, tenantId],
  );

  const handleSubmit = useCallback(
    async (_target: GrantTarget, subjects: GrantSubject[]) => {
      await setGrants(tenantId, 'dataset', datasetId, subjects);
      setDialogOpen(false);
      refresh();
    },
    [datasetId, refresh, tenantId],
  );

  const target: GrantTarget | null = dialogOpen
    ? {
        kind: 'dataset',
        resourceId: datasetId,
        name: knowledgeBase?.name ?? '',
        grants,
        defaultScope: scope,
        scopeHint: '本层及库内全部文件；子项自己设置过的规则优先',
        supportsDeny: node?.supports_deny,
      }
    : null;

  const summary = grants.length
    ? `已授权 ${grants.length} 项：${grants
        .slice(0, 3)
        .map((grant) => grant.name)
        .join('、')}${grants.length > 3 ? ' 等' : ''}`
    : `暂无逐人授权，按「${defaultScopeLabel(scope)}」生效`;

  return (
    <FormItem className="items-center space-y-0">
      <div className="flex items-center">
        {/* 这一项不参与表单提交：改档位和逐人授权都是立即生效的动作，
            用 FormLabel 还得挂一个假的字段名。 */}
        <Label className="text-sm whitespace-nowrap w-1/4 flex items-center gap-1">
          <span>{t('knowledgeConfiguration.permissions')}</span>
          <FormTooltip tooltip={t('knowledgeConfiguration.permissionsTip')} />
        </Label>
        <div className="w-3/4 space-y-1">
          <div className="flex items-center gap-2">
            <SelectWithSearch
              options={VISIBILITY_OPTIONS}
              value={scope}
              onChange={handleScopeChange}
              disabled={!canManage}
              triggerClassName="w-56"
              testId="ds-settings-visibility-select"
            />
            <Button
              type="button"
              variant="secondary"
              className="h-9"
              disabled={!canManage || !canReadGrants}
              onClick={() => setDialogOpen(true)}
            >
              设置可见范围
            </Button>
          </div>
          <p className="text-xs text-text-secondary">
            {canManage
              ? summary
              : '可见范围与逐人授权由租户管理员在「资源授权」中设置。'}
          </p>
        </div>
      </div>

      <GrantDialog
        target={target}
        options={options}
        onClose={() => setDialogOpen(false)}
        onSubmit={handleSubmit}
      />
    </FormItem>
  );
}
