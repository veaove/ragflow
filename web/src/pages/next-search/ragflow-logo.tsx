/*
 *  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

import { useFetchTokenListBeforeOtherStep } from '@/components/embed-dialog/use-show-embed-dialog';
import { Button } from '@/components/ui/button';
import { SharedFrom } from '@/constants/chat';
import { cn } from '@/lib/utils';
import { Routes } from '@/routes';
import { Send } from 'lucide-react';
import { useState } from 'react';
import { useFetchSearchDetail } from '../next-searches/hooks';
import EmbedAppModal from './embed-app-modal';

function EmbedIcon() {
  const [openEmbed, setOpenEmbed] = useState(false);
  const { beta, handleOperate } = useFetchTokenListBeforeOtherStep();

  const { data: SearchData } = useFetchSearchDetail();

  return (
    <>
      <Button
        variant={'outline'}
        onClick={() => {
          handleOperate().then((res) => {
            if (res) {
              setOpenEmbed(!openEmbed);
            }
          });
        }}
      >
        <Send />
      </Button>
      <EmbedAppModal
        open={openEmbed}
        setOpen={setOpenEmbed}
        url={Routes.SearchShare}
        token={SearchData?.id as string}
        from={SharedFrom.Search}
        beta={beta}
      />
    </>
  );
}

export function RAGFlowLogo({
  onClick,
  showEmbedIcon = true,
}: {
  onClick?: React.MouseEventHandler<HTMLHeadingElement>;
  showEmbedIcon?: boolean;
}) {
  return (
    <div className="flex gap-4 items-center">
      {/*
        品牌字：逐字配色（和君=蓝、纵=灰、达=金）+ 900 字重 + 轻微投影。
        原来用 bg-gradient-to-l + bg-clip-text 但漏了 text-transparent，
        渐变被文字色盖住，实际渲染成纯黑。这里改成逐字上色，和设计稿一致。
      */}
      <h1
        onClick={onClick}
        className={cn(
          'text-4xl font-black tracking-tight drop-shadow-sm select-none',
        )}
      >
        <span className="text-[#0B5FBF]">和君</span>
        <span className="text-[#7A8794]">纵</span>
        <span className="text-[#D9A24A]">达</span>
      </h1>
      {showEmbedIcon && <EmbedIcon></EmbedIcon>}
    </div>
  );
}
