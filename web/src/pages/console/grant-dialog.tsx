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

export type GrantKind = 'dataset' | 'canvas' | 'memory' | 'document';

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

/** 旧二值字段的可读名，用于没有显式规则时的回退展示。 */
export function defaultScopeLabel(scope: string) {
  if (scope === 'inherit') return '继承自知识库';
  if (scope === 'team') return '全团队（默认）';
  return '仅自己（默认）';
}

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

  const isDocument = target?.kind === 'document';

  useEffect(() => {
    if (!target) return;
    setDraft(target.grants ?? []);
    setAddKind('department');
    setAddId('');
    setAddPermission('read');
    setAddEffect('allow');
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
            {isDocument ? '设置文件可见范围' : '设置可见范围'}
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
              {isDocument ? '文件级' : '资源级'}
            </span>
            {target && !draft.length && (
              <span className="ml-2 text-xs">
                （未设置显式授权，按默认：
                {defaultScopeLabel(target.defaultScope)}）
              </span>
            )}
          </div>

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
                  {isDocument && (
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
            {isDocument && (
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

          {isDocument && (
            <p className="text-xs text-text-secondary">
              文件默认继承知识库的可见范围。一旦给某个文件设置了规则，该文件就只看
              这份规则：「拒绝」优先于任何「允许」；规则里没有的人看不到这个文件。
              清空全部规则即恢复继承。
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
