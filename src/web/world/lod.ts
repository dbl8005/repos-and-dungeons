export type Lod = 'close' | 'mid' | 'far';
export type View = { x: number; y: number; w: number; h: number };

/** `zoom` = screen pixels per art pixel. */
export function lodFor(zoom: number): Lod {
  if (zoom >= 1.5) return 'close';
  if (zoom >= 0.5) return 'mid';
  return 'far';
}

/** Indices (row * cols + col) of chunks overlapping the view, clamped to the map. */
export function visibleChunks(view: View, chunkPx: number, cols: number, rows: number): number[] {
  const c0 = Math.max(0, Math.floor(view.x / chunkPx)), c1 = Math.min(cols - 1, Math.floor((view.x + view.w) / chunkPx));
  const r0 = Math.max(0, Math.floor(view.y / chunkPx)), r1 = Math.min(rows - 1, Math.floor((view.y + view.h) / chunkPx));
  const out: number[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(r * cols + c);
  return out;
}
