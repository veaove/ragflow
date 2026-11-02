/**
 * 表头列宽拖拽的纯逻辑：夹紧、序列化、按表头文字生成存储键。
 *
 * 放在组件外面是因为 jsdom 没有布局引擎（`getBoundingClientRect` 恒为 0），
 * 拖拽的宽度计算只能在纯函数这一层测。
 */

/** 再窄就放不下表头文字和排序图标了。 */
export const MIN_COLUMN_WIDTH = 64;

/** 防止手滑把一列拖到几万像素，把整张表撑爆。 */
export const MAX_COLUMN_WIDTH = 1600;

export function clampColumnWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return MIN_COLUMN_WIDTH;
  }
  return Math.min(
    MAX_COLUMN_WIDTH,
    Math.max(MIN_COLUMN_WIDTH, Math.round(width)),
  );
}

/**
 * 同一页面可能有多张表（质检页、记忆详情都有），只按 pathname 存会让它们
 * 互相覆盖。表头文字在同一页里基本唯一，且改了表头本来就该重置宽度，
 * 拿它做键比「第几张表」稳定——后者会随条件渲染的列漂移。
 */
export function columnWidthsStorageKey(
  pathname: string,
  headers: string[],
): string {
  const label = headers
    .map((header) => header.replace(/\s+/g, ' ').trim())
    .join('|');
  return `rf:col-widths:${pathname}:${label}`;
}

/** 数量对不上（列增删过）就整条丢弃，避免宽度错位套到别的列上。 */
export function parseStoredColumnWidths(
  raw: string | null,
  count: number,
): (number | null)[] | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== count) {
      return null;
    }
    return parsed.map((value) =>
      typeof value === 'number' && value > 0 ? clampColumnWidth(value) : null,
    );
  } catch {
    return null;
  }
}

export function serializeColumnWidths(widths: (number | null)[]): string {
  return JSON.stringify(
    widths.map((width) => (width == null ? null : clampColumnWidth(width))),
  );
}
