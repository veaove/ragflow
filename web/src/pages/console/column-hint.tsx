import { HelpCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface ColumnHintProps {
  /** 列头文字，同时作为浮层标题与无障碍标签。 */
  label: string;
  /** 该列权限的说明文案。 */
  hint: string;
}

/**
 * 表头问号提示。
 *
 * 桌面端由悬停打开，触屏上没有 hover，交给 Popover 自身的点击/点按切换；
 * 两条路径都收敛到同一个受控 open，样式与内容因此完全一致。
 * 浮层走 Popover 的 Portal，脱离表格布局，不撑宽列、不推动内容。
 */
export function ColumnHint({ label, hint }: ColumnHintProps) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  // 指针从图标移到浮层上的这一小段距离不该让提示消失，所以延迟关闭并允许
  // 浮层自己取消它。
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }, [cancelClose]);

  useEffect(() => cancelClose, [cancelClose]);

  return (
    <span className="inline-flex items-center justify-center gap-0.5">
      <span>{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${label}：权限说明`}
            className="inline-flex shrink-0 items-center rounded-full text-state-warning outline-none hover:opacity-80 focus-visible:ring-1 focus-visible:ring-state-warning"
            onPointerEnter={(e) => {
              // 触摸设备也会派发 pointerenter，不能让它参与打开/关闭，
              // 否则点按会被“先开后关”抵掉。
              if (e.pointerType !== 'mouse') return;
              cancelClose();
              setOpen(true);
            }}
            onPointerLeave={(e) => {
              if (e.pointerType !== 'mouse') return;
              scheduleClose();
            }}
            onClick={(e) => {
              // 表头在可滚动表格里，点击只用于开关提示，不要触发外层行为。
              e.stopPropagation();
            }}
          >
            <HelpCircle className="size-3.5" strokeWidth={2} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="center"
          sideOffset={6}
          className="w-64 p-3"
          // 打开时不抢焦点：抢焦点会让滚动容器跳到触发器上。
          onOpenAutoFocus={(e) => e.preventDefault()}
          onPointerEnter={cancelClose}
          onPointerLeave={scheduleClose}
        >
          <span className="text-xs font-medium text-text-primary">{label}</span>
          <p className="mt-1 text-xs leading-relaxed text-text-secondary">
            {hint}
          </p>
        </PopoverContent>
      </Popover>
    </span>
  );
}
