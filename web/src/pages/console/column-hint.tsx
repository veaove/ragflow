import { HintPopover } from './hint-popover';

interface ColumnHintProps {
  /** 列头文字，同时作为浮层标题与无障碍标签。 */
  label: string;
  /** 该列权限的说明文案。 */
  hint: string;
}

/** 表头问号提示：列头文字后面跟一个可悬停/点按的问号。 */
export function ColumnHint({ label, hint }: ColumnHintProps) {
  return (
    <span className="inline-flex items-center justify-center gap-0.5">
      <span>{label}</span>
      <HintPopover label={label} contentClassName="w-64">
        <p className="mt-1 text-xs leading-relaxed text-text-secondary">
          {hint}
        </p>
      </HintPopover>
    </span>
  );
}
