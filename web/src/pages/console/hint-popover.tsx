import { HelpCircle, TriangleAlert } from 'lucide-react';
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/** 问号是「补充解释」，感叹号是「这条规则会被踩错」。 */
export type HintIcon = 'help' | 'warning';

interface HintPopoverProps {
  /** 浮层标题，同时作为触发器的无障碍名称。 */
  label: string;
  icon?: HintIcon;
  /** 浮层正文：问号提示只是一段文案，权限边界是一张表。 */
  children: ReactNode;
  contentClassName?: string;
  align?: 'start' | 'center' | 'end';
}

const ICONS = {
  help: HelpCircle,
  warning: TriangleAlert,
} as const;

/**
 * 行内提示图标 + 浮层。
 *
 * 桌面端由悬停打开，触屏上没有 hover，交给 Popover 自身的点击/点按切换；
 * 两条路径都收敛到同一个受控 open，样式与内容因此完全一致。浮层走 Portal，
 * 脱离表格/段落布局，不撑宽所在容器、不推动内容。
 */
export function HintPopover({
  label,
  icon = 'help',
  children,
  contentClassName,
  align = 'center',
}: HintPopoverProps) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const Icon = ICONS[icon];

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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label}：说明`}
          className="inline-flex shrink-0 translate-y-[1px] items-center rounded-full align-middle text-state-warning outline-none hover:opacity-80 focus-visible:ring-1 focus-visible:ring-state-warning"
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
            // 触发器常常落在可滚动容器里，点击只用于开关提示。
            e.stopPropagation();
          }}
        >
          <Icon className="size-3.5" strokeWidth={2} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align={align}
        sideOffset={6}
        className={cn('p-3', contentClassName)}
        // 打开时不抢焦点：抢焦点会让滚动容器跳到触发器上。
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerEnter={cancelClose}
        onPointerLeave={scheduleClose}
      >
        <span className="text-xs font-medium text-text-primary">{label}</span>
        {children}
      </PopoverContent>
    </Popover>
  );
}
