import { cn } from '@/lib/utils';
import { LucidePalette, LucideSparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import './canvas-skin.css';
import {
  CANVAS_SKINS,
  useCanvasSkin,
  type CanvasSkin,
} from './use-canvas-skin';

const SKIN_ICONS: Record<CanvasSkin, typeof LucidePalette> = {
  legacy: LucidePalette,
  tech: LucideSparkles,
};

const SKIN_LABEL_KEYS: Record<CanvasSkin, string> = {
  legacy: 'flow.canvasSkinLegacy',
  tech: 'flow.canvasSkinTech',
};

/**
 * 画布右上角的皮肤切换器（复古 / 科技）。
 *
 * 只有两个互斥选项，所以用分段胶囊而不是下拉菜单：一眼能看出当前是哪种，
 * 切换也少一次点击。状态存在 localStorage（见 `use-canvas-skin.ts`），
 * 不改 DSL，不会把画布标脏。
 */
export function CanvasSkinToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { skin, setSkin } = useCanvasSkin();

  return (
    <div
      className={cn('canvas-skin-toggle nodrag nopan', className)}
      role="group"
      aria-label={t('flow.canvasSkin')}
      data-testid="canvas-skin-toggle"
    >
      {CANVAS_SKINS.map((item) => {
        const Icon = SKIN_ICONS[item];
        const active = skin === item;

        return (
          <button
            key={item}
            type="button"
            className="canvas-skin-toggle__item"
            data-active={active}
            data-testid={`canvas-skin-${item}`}
            aria-pressed={active}
            // 不阻止冒泡的话，点击会被画布 pane 收到，顺手把选中节点/弹层清掉。
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setSkin(item)}
          >
            <Icon className="size-3.5" />
            {t(SKIN_LABEL_KEYS[item])}
          </button>
        );
      })}
    </div>
  );
}

export default CanvasSkinToggle;
