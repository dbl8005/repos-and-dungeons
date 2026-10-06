type P = { x: number; y: number };

/** Camera (world-px center + zoom) that fits all tile points in the viewport with padding. */
export function frameBounds(points: P[], viewport: { w: number; h: number }, tilePx: number, o: { pad?: number; minZoom?: number; maxZoom?: number; center?: P } = {}): { x: number; y: number; zoom: number } {
  const pad = o.pad ?? 4, minZoom = o.minZoom ?? 0.35, maxZoom = o.maxZoom ?? 3;
  if (!points.length) {
    const c = o.center ?? { x: 0, y: 0 };
    return { x: (c.x + 0.5) * tilePx, y: (c.y + 0.5) * tilePx, zoom: minZoom };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const w = (maxX - minX + 2 * pad) * tilePx, h = (maxY - minY + 2 * pad) * tilePx;
  const zoom = Math.max(minZoom, Math.min(maxZoom, Math.min(viewport.w / w, viewport.h / h)));
  return { x: ((minX + maxX) / 2 + 0.5) * tilePx, y: ((minY + maxY) / 2 + 0.5) * tilePx, zoom };
}
