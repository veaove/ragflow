import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { BellRing } from 'lucide-react';
import { useState } from 'react';

import { MessageCenterDialog } from './message-center';

/**
 * 顶栏铃铛：打开消息中心。
 *
 * 以前它是个链接，点了跳「团队」页（提示有团队邀请）。团队邀请在侧边栏
 * 已经能看到，这里改成消息中心更有用。
 */
export function BellButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className={cn('group size-10 shrink-0 lg:size-8', className)}
        dot
        onClick={() => setOpen(true)}
      >
        <BellRing className="size-5 animate-bell-shake group-hover:animate-none lg:size-4" />
      </Button>
      <MessageCenterDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
