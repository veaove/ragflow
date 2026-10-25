import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  // whitespace-nowrap 是必需的：徽标里放的是「语音识别」这类短标签，而中文
  // 每个字之间都是合法断行点。表格 w-full + 自动布局时，带 w-[1%] 的窄列会被
  // 压到 1 个字符宽，标签就竖起来一字一行（模型配置页的「类型」列曾如此）。
  // 徽标本来就不该从中间断开，换行交给外层的 flex-wrap。
  'inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors outline-none focus:outline-none',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-bg-primary text-text-primary hover:bg-primary/80',
        secondary:
          'border-transparent bg-bg-card text-text-secondary rounded-md',
        success:
          'border-transparent bg-state-success/5 text-state-success rounded-md',
        destructive:
          'border-transparent bg-state-error/5 text-state-error rounded-md',
        outline: 'text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
