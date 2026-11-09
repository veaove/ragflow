/**
 * 授权图谱画布的视图变换（缩放 + 平移）与边界钳制。
 *
 * 图谱是固定三列布局：节点位置稳定，画布只是「看的角度」变了。所以变换统一用
 * `translate(cx+pan) scale(s) translate(-cx)` 表达 —— 缩放永远以画布中心为基准，
 * `pan` 是内容中心相对视口中心的像素偏移。这样放大后拖动的手感是 1:1 跟手，
 * 不会出现「越放大拖得越慢」。
 *
 * 边界按「缩放后多出来的部分 + 一点余量」算：1× 时也能轻微拖动（看清贴边的节点），
 * 但拖不出视口太远，避免用户把整张图拖丢。
 */

export interface GraphView {
  /** 缩放倍数，1 = 原尺寸。 */
  scale: number;
  /** 内容中心相对视口中心的像素偏移。 */
  x: number;
  y: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

/** 缩放下限：再小节点里的两行字就糊成一团。 */
export const MIN_SCALE = 0.6;
/** 缩放上限：再大资源列会顶出视口，反而看不到全貌。 */
export const MAX_SCALE = 1.9;
/** 1× 时也允许的拖动余量。 */
export const PAN_MARGIN = 64;

export const IDENTITY_VIEW: GraphView = { scale: 1, x: 0, y: 0 };

export const clampScale = (scale: number): number => {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
};

/** 把任意视图收进合法范围：平移量随缩放同步收紧。 */
export const clampView = (view: GraphView, size: ViewportSize): GraphView => {
  const slackX = Math.max(0, (size.width * view.scale - size.width) / 2);
  const slackY = Math.max(0, (size.height * view.scale - size.height) / 2);
  const limitX = slackX + PAN_MARGIN;
  const limitY = slackY + PAN_MARGIN;
  return {
    scale: view.scale,
    x: Math.min(limitX, Math.max(-limitX, view.x)),
    y: Math.min(limitY, Math.max(-limitY, view.y)),
  };
};

/**
 * 以视口内某个锚点为原点缩放：锚点下面的内容保持不动。
 *
 * 公式来自「锚点在内容坐标系里的位置不变」：
 * `anchor = center + pan + world * scale`，两边同除以 scale 解出 world，
 * 再代入新 scale 反推新 pan。
 */
export const zoomAt = (
  view: GraphView,
  nextScale: number,
  anchor: { x: number; y: number },
  size: ViewportSize,
): GraphView => {
  const scale = clampScale(nextScale);
  if (scale === view.scale) return clampView(view, size);
  const cx = size.width / 2;
  const cy = size.height / 2;
  const dx = anchor.x - cx - view.x;
  const dy = anchor.y - cy - view.y;
  const k = scale / view.scale;
  return clampView(
    { scale, x: anchor.x - cx - dx * k, y: anchor.y - cy - dy * k },
    size,
  );
};

/** 纯平移：位移直接叠加，随后统一钳制。 */
export const panBy = (
  view: GraphView,
  dx: number,
  dy: number,
  size: ViewportSize,
): GraphView => clampView({ ...view, x: view.x + dx, y: view.y + dy }, size);

/** 捏合缩放：按两指距离比换算目标倍数。 */
export const pinchScale = (
  startScale: number,
  startDistance: number,
  distance: number,
): number => {
  if (!(startDistance > 0)) return clampScale(startScale);
  return clampScale(startScale * (distance / startDistance));
};

/** 两指中点，作为捏合的锚点。 */
export const midpoint = (
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number } => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export const distanceBetween = (
  a: { x: number; y: number },
  b: { x: number; y: number },
): number => Math.hypot(a.x - b.x, a.y - b.y);
