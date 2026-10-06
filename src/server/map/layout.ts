import { fnv1a32 } from '../../shared/hash.js';
import type { Rect } from '../../shared/map-types.js';
import type { RoomNode } from './room-budget.js';

export const ROOM_GAP = 3;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Floor size grows with sqrt(files), aspect ~4:3, clamped to 5×4..40×30, rounded up to even sizes. */
export function sizeRoom(fileCount: number, scale = 1): { w: number; h: number } {
  const area = Math.max(20, Math.ceil(Math.sqrt(fileCount) * 12 * scale));
  let w = clamp(Math.round(Math.sqrt((area * 4) / 3)), 5, 40);
  let h = clamp(Math.ceil(area / w), 4, 30);
  w += w % 2;
  h += h % 2;
  return { w, h };
}

/** Spatial hash of placed rects (expanded by the gap) for fast collision checks. */
class RectIndex {
  private cells = new Map<number, Rect[]>();
  private static S = 32;
  private key = (cx: number, cy: number) => (cx + 4096) * 8192 + (cy + 4096);
  private span(r: Rect, f: (k: number) => void) {
    const S = RectIndex.S;
    for (let cx = Math.floor((r.x - ROOM_GAP) / S); cx <= Math.floor((r.x + r.w + ROOM_GAP) / S); cx++)
      for (let cy = Math.floor((r.y - ROOM_GAP) / S); cy <= Math.floor((r.y + r.h + ROOM_GAP) / S); cy++) f(this.key(cx, cy));
  }
  add(r: Rect) {
    this.span(r, (k) => {
      const l = this.cells.get(k);
      if (l) l.push(r);
      else this.cells.set(k, [r]);
    });
  }
  hits(r: Rect): boolean {
    let hit = false;
    this.span(r, (k) => {
      if (hit) return;
      for (const o of this.cells.get(k) ?? [])
        if (r.x < o.x + o.w + ROOM_GAP && o.x < r.x + r.w + ROOM_GAP && r.y < o.y + o.h + ROOM_GAP && o.y < r.y + r.h + ROOM_GAP) {
          hit = true;
          return;
        }
    });
    return hit;
  }
}

/** Ring of offsets at Chebyshev distance `r`, clockwise, starting in direction `d` (0 right, 1 down, 2 left, 3 up). */
function ring(r: number, d: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = -r; i < r; i++) pts.push([r, i]); // right edge, going down
  for (let i = r; i > -r; i--) pts.push([i, r]); // bottom edge, going left
  for (let i = r; i > -r; i--) pts.push([-r, i]); // left edge, going up
  for (let i = -r; i < r; i++) pts.push([i, -r]); // top edge, going right
  const shift = (d * pts.length) / 4;
  return pts.slice(shift).concat(pts.slice(0, shift));
}

/**
 * Places rooms in sorted path order (parents first). Each child spirals outward from its parent's center,
 * starting in a direction picked by hash(path). Output coordinates may be negative; the caller shifts them.
 */
export function placeRooms(nodes: RoomNode[], sizes: Map<string, { w: number; h: number }>): Map<string, Rect> {
  const out = new Map<string, Rect>();
  const index = new RectIndex();
  for (const n of nodes) {
    const s = sizes.get(n.path)!;
    const pr = n.parent === null ? undefined : out.get(n.parent);
    if (!pr) {
      const r = { x: 0, y: 0, ...s };
      out.set(n.path, r);
      index.add(r);
      continue;
    }
    const cx = pr.x + pr.w / 2;
    const cy = pr.y + pr.h / 2;
    const d = fnv1a32(n.path) % 4;
    const minR = Math.floor(Math.min(pr.w + s.w, pr.h + s.h) / 2) + ROOM_GAP;
    let placed: Rect | null = null;
    for (let r = minR; !placed; r += 2) {
      for (const [dx, dy] of ring(r, d)) {
        const cand = { x: Math.round(cx + dx - s.w / 2), y: Math.round(cy + dy - s.h / 2), ...s };
        if (!index.hits(cand)) {
          placed = cand;
          break;
        }
      }
    }
    out.set(n.path, placed);
    index.add(placed);
  }
  return out;
}
