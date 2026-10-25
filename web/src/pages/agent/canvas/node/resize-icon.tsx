import { CSSProperties } from 'react';

export function ResizeIcon({ style }: { style?: CSSProperties } = {}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="10"
      height="10"
      viewBox="0 0 24 24"
      strokeWidth="2"
      stroke="var(--text-disabled)"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        position: 'absolute',
        right: 5,
        bottom: 5,
        ...style,
      }}
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <polyline points="16 20 20 20 20 16" />
      <line x1="14" y1="14" x2="20" y2="20" />
      <polyline points="8 4 4 4 4 8" />
      <line x1="4" y1="4" x2="10" y2="10" />
    </svg>
  );
}

export const controlStyle = {
  background: 'transparent',
  border: 'none',
  cursor: 'nwse-resize',
};

/**
 * 缩放角标的命中区。
 *
 * xyflow 自带的 `.react-flow__resize-control` 只有 5×5，比图标本身还小，
 * 鼠标很难精确压上去。这里把可点区域放大到 18×18，图标仍按原来贴在
 * 右下角，视觉不变但好拖多了。
 */
export const resizeControlHitArea = {
  ...controlStyle,
  width: 18,
  height: 18,
} as const;
