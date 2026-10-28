import { HomeCard } from '@/components/home-card';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useNavigatePage } from '@/hooks/logic-hooks/navigate-hooks';
import { IBuiltinPipelineListItem } from '@/interfaces/database/agent';
import { useBuiltinPipelineLabels } from '@/utils/builtin-pipeline-i18n';
import { CircleHelp, Copy } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useCopyBuiltinPipeline } from './use-copy-builtin-pipeline';

// BuiltinPipelineCard renders a read-only built-in ingestion pipeline in the
// agents list. Built-in pipelines are static, non-user resources: clicking the
// card opens them on the read-only canvas (view only, no editing or autosave),
// and the Copy action turns them into a user-owned editable dataflow canvas.
// Title and description resolve through the catalogue's own translations so the
// card follows the UI language switch instead of always showing English.
export function BuiltinPipelineCard({
  data,
}: {
  data: IBuiltinPipelineListItem;
}) {
  const { t } = useTranslation();
  const { copy, copying } = useCopyBuiltinPipeline();
  const { navigateToBuiltinPipeline } = useNavigatePage();
  const { title, description, help } = useBuiltinPipelineLabels();

  const handleCopyClick = (e: MouseEvent) => {
    e.stopPropagation();
    // The copy is named after what the user actually sees on the card, so the
    // new canvas reads the same way in the current language.
    copy({ id: data.id, title: title(data) });
  };

  const info = help(data);

  return (
    <HomeCard
      testId="builtin-pipeline-card"
      data={{
        name: title(data),
        description: description(data),
      }}
      // Read-only: clicking opens the built-in pipeline on the view-only
      // canvas; the template itself can never be edited.
      onClick={navigateToBuiltinPipeline(data.id)}
      // No rename / delete / edit-tags menu for built-in items; the top-right
      // slot carries the icon-only Copy action instead.
      moreDropdown={
        <>
          {/* 使用说明：模板能吃什么格式、什么时候用、解析产出什么。
              没有 help 数据时不渲染问号 —— 空 tooltip 比没有更糟。 */}
          {info && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  data-testid="builtin-pipeline-help"
                  variant="static"
                  size="icon-sm"
                  aria-label={t('common.builtinHelpUsage')}
                  onClick={(e: MouseEvent) => e.stopPropagation()}
                >
                  <CircleHelp className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-xs p-3">
                <div className="flex flex-col gap-2 text-left">
                  {!!info.formats?.length && (
                    <div>
                      <div className="mb-1 text-xs opacity-70">
                        {t('common.builtinHelpFormats')}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {info.formats.map((f) => (
                          <span
                            key={f}
                            className="rounded bg-text-primary/10 px-1.5 py-0.5 text-xs"
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {info.usage && (
                    <div>
                      <div className="mb-1 text-xs opacity-70">
                        {t('common.builtinHelpUsage')}
                      </div>
                      <div className="text-xs leading-relaxed">
                        {info.usage}
                      </div>
                    </div>
                  )}
                  {info.output && (
                    <div>
                      <div className="mb-1 text-xs opacity-70">
                        {t('common.builtinHelpOutput')}
                      </div>
                      <div className="text-xs leading-relaxed">
                        {info.output}
                      </div>
                    </div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="copy-builtin-pipeline"
                variant="static"
                size="icon-sm"
                disabled={copying}
                aria-label={t('common.copy')}
                onClick={handleCopyClick}
              >
                <Copy className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('common.copy')}</TooltipContent>
          </Tooltip>
        </>
      }
    />
  );
}
