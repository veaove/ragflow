import { useTranslate } from '@/hooks/common-hooks';
import { cn } from '@/lib/utils';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  TriangleAlert,
} from 'lucide-react';
import { memo, ReactNode, useCallback, useMemo, useState } from 'react';
import { IThinkingStep, totalElapsed } from './use-agent-thinking';

/** How many retrieval hits are listed before the rest collapse into a count. */
const VISIBLE_CHUNKS = 3;

const TYPE_LABEL_KEYS: Record<string, string> = {
  categorize: 'thinkingSteps.type.categorize',
  retrieval: 'thinkingSteps.type.retrieval',
  agent: 'thinkingSteps.type.agent',
  message: 'thinkingSteps.type.message',
  variableaggregator: 'thinkingSteps.type.aggregator',
  switch: 'thinkingSteps.type.switch',
  iteration: 'thinkingSteps.type.iteration',
  code: 'thinkingSteps.type.code',
  tool: 'thinkingSteps.type.tool',
};

type Translate = ReturnType<typeof useTranslate>['t'];

const stepLabel = (step: IThinkingStep, t: Translate) => {
  const key = TYPE_LABEL_KEYS[step.type?.toLowerCase()];
  return key ? t(key) : step.name || step.id;
};

const formatSeconds = (value: number | undefined, t: Translate) => {
  if (value === undefined) {
    return '';
  }
  if (value < 0.01) {
    return t('thinkingSteps.lessThanSecond');
  }
  return t('thinkingSteps.seconds', { value: value.toFixed(2) });
};

const StatusIcon = ({ status }: { status: IThinkingStep['status'] }) => {
  if (status === 'running') {
    return <Loader2 className="size-3.5 shrink-0 animate-spin" />;
  }
  if (status === 'error') {
    return <TriangleAlert className="size-3.5 shrink-0 text-state-error" />;
  }
  return <Check className="size-3.5 shrink-0" />;
};

const ChunkRow = memo(
  ({
    chunk,
    t,
  }: {
    chunk: NonNullable<IThinkingStep['chunks']>[number];
    t: Translate;
  }) => {
    const [open, setOpen] = useState(false);
    const toggle = useCallback(() => setOpen((prev) => !prev), []);

    return (
      <div className="rounded-sm border border-border-default bg-bg-card">
        <button
          type="button"
          className="flex w-full cursor-pointer items-start gap-2 px-2 py-1.5 text-left"
          onClick={toggle}
        >
          {chunk.similarity !== undefined && (
            <span className="shrink-0 rounded-sm bg-bg-card px-1 font-mono text-xs text-text-secondary">
              {chunk.similarity.toFixed(2)}
            </span>
          )}
          <span
            className={cn(
              'flex-1 text-xs text-text-secondary',
              open ? 'whitespace-pre-wrap' : 'line-clamp-1',
            )}
          >
            {chunk.content}
          </span>
          <span className="shrink-0 text-xs text-text-secondary underline-offset-2 hover:underline">
            {open ? t('thinkingSteps.hideSource') : t('thinkingSteps.viewSource')}
          </span>
        </button>
      </div>
    );
  },
);

ChunkRow.displayName = 'ChunkRow';

/**
 * One pipeline step. The row itself is never collapsible — the panel is the only
 * fold — so an expanded panel shows the whole trail at once, matching the
 * approved prototype. Only the retrieved snippets fold individually, inside
 * {@link ChunkRow}.
 */
const StepRow = memo(({ step, t }: { step: IThinkingStep; t: Translate }) => {
  const detail: ReactNode[] = [];
  if (step.error) {
    detail.push(
      <div key="error" className="text-state-error">
        {step.error}
      </div>,
    );
  }
  if (step.category) {
    detail.push(
      <div key="category">{t('thinkingSteps.category', { name: step.category })}</div>,
    );
  }
  if (step.chunks && step.chunks.length > 0) {
    detail.push(
      <div key="count">
        {t('thinkingSteps.chunkCount', { num: step.chunkCount ?? step.chunks.length })}
      </div>,
    );
    step.chunks.slice(0, VISIBLE_CHUNKS).forEach((chunk) => {
      detail.push(<ChunkRow key={chunk.id} chunk={chunk} t={t} />);
    });
    const hidden = (step.chunkCount ?? step.chunks.length) - VISIBLE_CHUNKS;
    if (hidden > 0) {
      detail.push(
        <div key="more" className="text-xs">
          {t('thinkingSteps.chunkMore', { num: hidden })}
        </div>,
      );
    }
  }
  if (step.outputChars !== undefined && !step.error) {
    detail.push(
      <div key="chars">{t('thinkingSteps.outputChars', { num: step.outputChars })}</div>,
    );
  }

  return (
    <div className="border-t border-border-default px-3 py-2 first:border-t-0">
      <div className="flex items-center gap-2 text-sm">
        <StatusIcon status={step.status} />
        <span className="font-medium">{stepLabel(step, t)}</span>
        <span className="ml-auto text-xs text-text-secondary">
          {formatSeconds(step.elapsed, t)}
        </span>
      </div>
      {detail.length > 0 && (
        <div className="mt-1 flex flex-col gap-1 pl-5 text-xs text-text-secondary">
          {detail}
        </div>
      )}
    </div>
  );
});

StepRow.displayName = 'StepRow';

/**
 * Collapsed-by-default summary of what the agent pipeline did to produce an
 * answer. While the run is still in flight the panel stays open so the user can
 * watch the pipeline advance; once every step finishes it folds back to one line
 * and can be reopened to review what happened.
 *
 * Openness is derived from the steps themselves (any step still `running`) rather
 * than from a page-level loading flag: that flag is shared by the whole screen, so
 * a new question would otherwise re-expand every older answer on the page.
 */
export const ThinkingPanel = memo(
  ({
    steps,
    summaryTitle,
  }: {
    steps?: IThinkingStep[];
    /**
     * 折叠时显示的标题。智能体不传，沿用「已深度思考 N 步」；
     * 知识问答传「检索过程」——那边没有"思考"，照抄文案会误导。
     */
    summaryTitle?: string;
  }) => {
  const { t } = useTranslate('chat');
  const [manual, setManual] = useState<boolean | null>(null);

  const list = steps ?? [];
  const running = useMemo(
    () => list.find((step) => step.status === 'running'),
    [list],
  );
  const elapsed = useMemo(() => totalElapsed(list), [list]);
  const expanded = manual ?? Boolean(running);

  if (list.length === 0) {
    return null;
  }

  const title = running
    ? t('thinkingSteps.running', { name: stepLabel(running, t) })
    : (summaryTitle ?? t('thinkingSteps.done', { num: list.length }));

  return (
    <div className="mb-3 overflow-hidden rounded-md border border-border-default bg-bg-card">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:text-text-primary"
        onClick={() => setManual(!expanded)}
        aria-expanded={expanded}
      >
        <StatusIcon status={running ? 'running' : 'done'} />
        <span>{title}</span>
        {!running && elapsed > 0 && <span>· {formatSeconds(elapsed, t)}</span>}
        {expanded ? (
          <ChevronUp className="ml-auto size-3.5 shrink-0" />
        ) : (
          <ChevronDown className="ml-auto size-3.5 shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-border-default">
          {list.map((step) => (
            <StepRow key={step.id} step={step} t={t} />
          ))}
        </div>
      )}
    </div>
  );
});

ThinkingPanel.displayName = 'ThinkingPanel';

export default ThinkingPanel;
