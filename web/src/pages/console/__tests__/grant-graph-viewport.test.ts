import {
  IDENTITY_VIEW,
  MAX_SCALE,
  MIN_SCALE,
  PAN_MARGIN,
  clampScale,
  clampView,
  distanceBetween,
  midpoint,
  panBy,
  pinchScale,
  zoomAt,
} from '../grant-graph-viewport';

const SIZE = { width: 1000, height: 600 };

describe('grant-graph-viewport', () => {
  it('缩放倍数夹在可用区间内', () => {
    expect(clampScale(0.1)).toBe(MIN_SCALE);
    expect(clampScale(5)).toBe(MAX_SCALE);
    expect(clampScale(1.25)).toBe(1.25);
    expect(clampScale(Number.NaN)).toBe(1);
  });

  it('1× 时只允许 PAN_MARGIN 的拖动余量，放大后按内容溢出同步放宽', () => {
    const atOne = clampView({ scale: 1, x: 9999, y: -9999 }, SIZE);
    expect(atOne.x).toBe(PAN_MARGIN);
    expect(atOne.y).toBe(-PAN_MARGIN);

    const zoomed = clampView({ scale: 2, x: 9999, y: -9999 }, SIZE);
    // 2× 时内容宽出视口 1000px，左右各 500px，再加余量。
    expect(zoomed.x).toBe(SIZE.width / 2 + PAN_MARGIN);
    expect(zoomed.y).toBe(-(SIZE.height / 2 + PAN_MARGIN));
  });

  it('以锚点缩放时，锚点下面的内容保持不动', () => {
    const anchor = { x: 320, y: 180 };
    const before = IDENTITY_VIEW;
    const after = zoomAt(before, 1.6, anchor, SIZE);

    const worldX = (view: typeof before) =>
      (anchor.x - SIZE.width / 2 - view.x) / view.scale;
    const worldY = (view: typeof before) =>
      (anchor.y - SIZE.height / 2 - view.y) / view.scale;

    expect(after.scale).toBe(1.6);
    expect(worldX(after)).toBeCloseTo(worldX(before), 6);
    expect(worldY(after)).toBeCloseTo(worldY(before), 6);
  });

  it('缩放不变时只做边界收敛，不改平移量', () => {
    const view = { scale: 1.5, x: 10, y: -20 };
    expect(zoomAt(view, 1.5, { x: 100, y: 100 }, SIZE)).toEqual(view);
  });

  it('平移量逐次叠加后仍受边界约束', () => {
    const moved = panBy(IDENTITY_VIEW, 30, -40, SIZE);
    expect(moved.x).toBe(30);
    expect(moved.y).toBe(-40);

    const capped = panBy(moved, 9999, 9999, SIZE);
    expect(capped.x).toBe(PAN_MARGIN);
    expect(capped.y).toBe(PAN_MARGIN);
  });

  it('捏合缩放手感：距离比就是缩放比，异常起点不放大', () => {
    expect(pinchScale(1, 100, 150)).toBe(1.5);
    expect(pinchScale(1, 100, 50)).toBe(0.6);
    expect(pinchScale(1.2, 0, 150)).toBe(1.2);
  });

  it('两指中点与距离', () => {
    expect(midpoint({ x: 0, y: 0 }, { x: 100, y: 60 })).toEqual({
      x: 50,
      y: 30,
    });
    expect(distanceBetween({ x: 0, y: 0 }, { x: 30, y: 40 })).toBe(50);
  });
});
