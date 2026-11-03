import { LucidePlus, LucideX } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { GrantSubject } from '@/services/console-service';

/**
 * 可授权的资源类型。取值由后端 grant-kind 注册表决定
 *（dataset / chat / search_app / canvas / memory / file / folder / …），
 * 前端不再维护第二份清单，避免两边漂移。
 */
export type GrantKind = string;

/** 一次授权编辑的目标：可以是资源（知识库 / 智能体 / 记忆），也可以是库内文件。 */
export interface GrantTarget {
  kind: GrantKind;
  resourceId: string;
  /** 显示用名称：资源名，或文件名。 */
  name: string;
  /** 文件级授权时的所属知识库 id。 */
  parentId?: string;
  /** 文件级授权时的所属知识库名称（提示用）。 */
  parentName?: string;
  grants: GrantSubject[];
  /** 资源级：private / team；文件级固定为继承知识库。 */
  defaultScope: string;
  /**
   * 作用范围提示，例如「本层及全部 44 个文件；子项自己设置过的规则优先」。
   * 授权最容易出错的不是选错人，而是没意识到这一改会影响整棵子树。
   */
  scopeHint?: string;
  /** 新加规则的默认取向：从「添加例外」进来时直接是拒绝。 */
  initialEffect?: 'allow' | 'deny';
}

export interface GrantSubjectOptions {
  departments: { id: string; name: string }[];
  members: { id: string; name: string }[];
}

interface GrantDialogProps {
  target: GrantTarget | null;
  options: GrantSubjectOptions;
  onClose: () => void;
  onSubmit: (target: GrantTarget, subjects: GrantSubject[]) => Promise<void>;
}

/**
 * 可见范围的可读名。三级是收窄语义：普通成员不在任何一档里，必须逐人 /
 * 逐部门授权；me / team 是升级前的历史值，按同一套文案展示。
 */
export function defaultScopeLabel(scope: string) {
  if (scope === 'inherit') return '继承自知识库';
  if (scope === 'tenant_owner' || scope === 'team') return '租户管理层可见';
  if (scope === 'platform') return '平台管理员可见';
  return '仅所有者可见';
}

/** 三级可见性的下拉选项（顺序由窄到宽）。 */
export const VISIBILITY_OPTIONS: { value: string; label: string }[] = [
  { value: 'owner', label: '仅所有者可见' },
  { value: 'tenant_owner', label: '租户管理层可见' },
  { value: 'platform', label: '平台管理员可见' },
];

function permissionLabel(permission: string | undefined) {
  return permission === 'edit' ? '可编辑' : '可查看';
}

/**
 * 资源 / 文件的可见范围编辑弹窗。
 *
 * 资源级与文件级共用这一个弹窗：主体选择（部门 / 成员 / 全团队）与权限级别
 * （可查看 / 可编辑）完全一致，文件级只多一个「允许 / 拒绝」——因为"把这个
 * 文件排除掉"只能靠拒绝表达。
 */
export function GrantDialog({
  target,
  options,
  onClose,
  onSubmit,
}: GrantDialogProps) {
  const [draft, setDraft] = useState<GrantSubject[]>([]);
  const [addKind, setAddKind] = useState<'department' | 'user'>('department');
  const [addId, setAddId] = useState('');
  // 新添加的授权给什么级别。默认只读：给编辑权应当是显式动作。
  const [addPermission, setAddPermission] = useState<'read' | 'edit'>('read');
  const [addEffect, setAddEffect] = useState<'allow' | 'deny'>('allow');
  const [saving, setSaving] = useState(false);

  // 文件级（知识库文件 / 文件管理里的文件）与库级的区别只在文案与提示。
  const isFileLevel = target?.kind === 'document' || target?.kind === 'file';
  // 只有知识库内的文件支持「拒绝」：库、文件夹、文件管理的文件收回权限都用
  // 清空授权表达，多一套拒绝语义会让优先级无从解释（后端同样会拒绝）。
  const supportsDeny = target?.kind === 'document';

  useEffect(() => {
    if (!target) return;
    setDraft(target.grants ?? []);
    setAddKind('department');
    setAddId('');
    setAddPermission('read');
    // 不支持拒绝的类型要落回允许，否则会提交一个后端明确拒绝的组合。
    setAddEffect(
      target.kind === 'document' && target.initialEffect === 'deny'
        ? 'deny'
        : 'allow',
    );
  }, [target]);

  const handleAddKindChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setAddKind(e.target.value as 'department' | 'user');
      setAddId('');
    },
    [],
  );

  const handleAddIdChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setAddId(e.target.value);
    },
    [],
  );

  const handleAddPermissionChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setAddPermission(e.target.value as 'read' | 'edit');
    },
    [],
  );

  const handleAddEffectChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setAddEffect(e.target.value as 'allow' | 'deny');
    },
    [],
  );

  const handleAddSubject = useCallback(() => {
    if (!addId) return;
    if (addKind === 'department') {
      const dept = options.departments.find((d) => d.id === addId);
      if (!dept) return;
      setDraft((prev) =>
        prev.some((s) => s.kind === 'department' && s.id === dept.id)
          ? prev
          : [
              ...prev,
              {
                kind: 'department',
                id: dept.id,
                name: dept.name.trim(),
                permission: addPermission,
                effect: addEffect,
              },
            ],
      );
    } else {
      const member = options.members.find((m) => m.id === addId);
      if (!member) return;
      setDraft((prev) =>
        prev.some((s) => s.kind === 'user' && s.id === member.id)
          ? prev
          : [
              ...prev,
              {
                kind: 'user',
                id: member.id,
                name: member.name,
                permission: addPermission,
                effect: addEffect,
              },
            ],
      );
    }
    setAddId('');
  }, [addEffect, addId, addKind, addPermission, options]);

  const handleAddTeam = useCallback(() => {
    setDraft((prev) =>
      prev.some((s) => s.kind === 'team')
        ? prev
        : [
            ...prev,
            {
              kind: 'team',
              id: '',
              name: '全团队',
              permission: addPermission,
              effect: addEffect,
            },
          ],
    );
  }, [addEffect, addPermission]);

  const handleTogglePermission = useCallback((index: number) => {
    setDraft((prev) =>
      prev.map((item, i) =>
        i === index
          ? {
              ...item,
              permission: item.permission === 'edit' ? 'read' : 'edit',
            }
          : item,
      ),
    );
  }, []);

  const handleToggleEffect = useCallback((index: number) => {
    setDraft((prev) =>
      prev.map((item, i) =>
        i === index
          ? { ...item, effect: item.effect === 'deny' ? 'allow' : 'deny' }
          : item,
      ),
    );
  }, []);

  const handleRemove = useCallback((index: number) => {
    setDraft((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSave = useCallback(async () => {
    if (!target) return;
    setSaving(true);
    try {
      await onSubmit(target, draft);
    } finally {
      setSaving(false);
    }
  }, [draft, onSubmit, target]);

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isFileLevel ? '设置文件可见范围' : '设置可见范围'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-sm text-text-secondary">
            {target?.parentName && (
              <span className="text-text-secondary">
                {target.parentName} /{' '}
              </span>
            )}
            <span className="text-text-primary">{target?.name}</span>
            <span className="ml-2 rounded bg-bg-list px-1.5 py-0.5 text-xs">
              {isFileLevel ? '文件级' : '资源级'}
            </span>
            {target && !draft.length && (
              <span className="ml-2 text-xs">
                （未设置显式授权，按默认：
                {defaultScopeLabel(target.defaultScope)}）
              </span>
            )}
          </div>

          {target?.scopeHint && (
            <p className="rounded-md bg-state-warning/10 px-3 py-2 text-xs text-state-warning">
              作用范围：{target.scopeHint}
            </p>
          )}

          <div>
            <div className="mb-1 text-sm text-text-secondary">已授权</div>
            <div className="flex min-h-9 flex-wrap items-center gap-2 rounded-md border border-border-default p-2">
              {draft.length === 0 && (
                <span className="text-xs text-text-secondary">
                  暂无，默认按「{defaultScopeLabel(target?.defaultScope ?? '')}
                  」
                </span>
              )}
              {draft.map((g, idx) => (
                <span
                  key={`${g.kind}-${g.id}-${idx}`}
                  className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${
                    g.effect === 'deny'
                      ? 'bg-state-error/10 text-state-error'
                      : 'bg-accent-primary/10 text-accent-primary'
                  }`}
                >
                  {g.name}
                  {/* 点一下在「可查看 / 可编辑」之间切换：授权列表通常很短，
                    为每次都开一个下拉不值当。拒绝时级别不生效，直接标出。 */}
                  {g.effect === 'deny' ? (
                    <span className="rounded bg-state-error/15 px-1">
                      已拒绝
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleTogglePermission(idx)}
                      className="rounded bg-accent-primary/15 px-1 hover:bg-accent-primary/25"
                      title="点击切换权限级别"
                    >
                      {permissionLabel(g.permission)}
                    </button>
                  )}
                  {supportsDeny && (
                    <button
                      type="button"
                      onClick={() => handleToggleEffect(idx)}
                      className="rounded bg-bg-list px-1 text-text-secondary hover:text-text-primary"
                      title="点击切换允许 / 拒绝"
                    >
                      {g.effect === 'deny' ? '拒绝' : '允许'}
                    </button>
                  )}
                  <LucideX
                    className="size-3 cursor-pointer"
                    onClick={() => handleRemove(idx)}
                  />
                </span>
              ))}
            </div>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <div className="mb-1 text-sm text-text-secondary">添加</div>
              <div className="flex gap-2">
                <select
                  value={addKind}
                  onChange={handleAddKindChange}
                  className="h-9 rounded-md border border-border-default bg-bg-base px-2 text-sm text-text-primary outline-none"
                >
                  <option value="department">指定部门</option>
                  <option value="user">指定成员</option>
                </select>
                <select
                  value={addId}
                  onChange={handleAddIdChange}
                  className="h-9 min-w-0 flex-1 rounded-md border border-border-default bg-bg-base px-2 text-sm text-text-primary outline-none"
                >
                  <option value="">请选择…</option>
                  {addKind === 'department'
                    ? options.departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))
                    : options.members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                </select>
              </div>
            </div>
            <select
              value={addPermission}
              onChange={handleAddPermissionChange}
              className="h-9 rounded-md border border-border-default bg-bg-base px-2 text-sm text-text-primary outline-none"
              title="授予的权限级别"
            >
              <option value="read">可查看</option>
              <option value="edit">可编辑</option>
            </select>
            {supportsDeny && (
              <select
                value={addEffect}
                onChange={handleAddEffectChange}
                className="h-9 rounded-md border border-border-default bg-bg-base px-2 text-sm text-text-primary outline-none"
                title="允许 / 拒绝"
              >
                <option value="allow">允许</option>
                <option value="deny">拒绝</option>
              </select>
            )}
            <Button
              variant="secondary"
              onClick={handleAddSubject}
              disabled={!addId}
            >
              <LucidePlus className="mr-1 size-4" />
              添加
            </Button>
          </div>

          <p className="text-xs text-text-secondary">
            可查看：能看到并使用该资源，但不能修改内容、不能删除、不能再授权；
            可编辑：可以修改内容、删除资源。
          </p>

          {isFileLevel && (
            <p className="text-xs text-text-secondary">
              {supportsDeny
                ? '知识库内的文件默认继承知识库的可见范围。一旦设置了规则，该文件就只看这份规则：「拒绝」优先于任何「允许」。看不到的文件不会出现在文件列表里，也无法查看内容、下载或解析，问答检索时不会命中它的切片。清空全部规则即恢复继承。'
                : '文件管理的文件默认只有所有者可见，逐人授权即把该文件单独放开；清空全部规则会收回这些授权。'}
            </p>
          )}

          <div>
            <Button
              variant="secondary"
              className="h-8"
              onClick={handleAddTeam}
              disabled={draft.some((s) => s.kind === 'team')}
            >
              开放给全团队
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
