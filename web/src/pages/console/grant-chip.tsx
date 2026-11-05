import type { GrantSubject } from '@/services/console-service';

/**
 * 授权标签：允许按级别区分（只读 / 可编辑），排除（不可见）单独标红。
 *
 * 文案与配色只在这里定义。资源授权页的平铺列表、知识库详情里的「子项例外」、
 * 以及「查看全部文件」弹窗都渲染同一批规则 —— 三处各写一遍时，`已排除`
 * 的措辞和颜色迟早会漂移，最后同一份数据在两个页面看起来像两件事。
 */
export function grantChipLabel(grant: GrantSubject): string {
  const name = grant.kind === 'team' ? '全团队' : grant.name;
  if (grant.effect === 'deny') return `${name}(已排除)`;
  return `${name}${grant.permission === 'read' ? '(只读)' : '(可编辑)'}`;
}

export function GrantChip({ grant }: { grant: GrantSubject }) {
  const denied = grant.effect === 'deny';
  return (
    <span
      className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] leading-4 ${
        denied
          ? 'bg-state-error/10 text-state-error'
          : 'bg-accent-primary/10 text-accent-primary'
      }`}
      title={denied ? '该主体被排除：看不到也不能使用' : undefined}
    >
      {grantChipLabel(grant)}
    </span>
  );
}

export function GrantChips({ grants }: { grants: GrantSubject[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {grants.map((grant, idx) => (
        <GrantChip key={`${grant.kind}-${grant.id}-${idx}`} grant={grant} />
      ))}
    </div>
  );
}
