import type { Corridor, Rect } from '../../shared/map-types.js';
import type { RoomNode } from './room-budget.js';

type Cell = [number, number];

/**
 * Connects every room to its parent. Tries both L-shapes first, then a BFS around other rooms
 * (their floor plus wall ring is blocked). Output cells exclude the two endpoint floors, so wall-ring
 * cells of the endpoints are the doors.
 */
export function routeCorridors(rects: Map<string, Rect>, nodes: RoomNode[], width: number, height: number): Corridor[] {
  const paths = nodes.map((n) => n.path);
  const owner = new Int32Array(width * height); // 0 = free, i+1 = room i (floor or wall ring)
  const floor = new Int32Array(width * height);
  paths.forEach((p, i) => {
    const r = rects.get(p)!;
    for (let y = r.y - 1; y <= r.y + r.h; y++)
      for (let x = r.x - 1; x <= r.x + r.w; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        owner[y * width + x] = i + 1;
        if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) floor[y * width + x] = i + 1;
      }
  });
  const idx = new Map(paths.map((p, i) => [p, i + 1]));
  const out: Corridor[] = [];

  for (const n of nodes) {
    if (n.parent === null) continue;
    const a = rects.get(n.parent)!;
    const b = rects.get(n.path)!;
    const ia = idx.get(n.parent)!;
    const ib = idx.get(n.path)!;
    const ok = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return false;
      const o = owner[y * width + x];
      return o === 0 || o === ia || o === ib;
    };
    const start: Cell = [a.x + (a.w >> 1), a.y + (a.h >> 1)];
    const end: Cell = [b.x + (b.w >> 1), b.y + (b.h >> 1)];
    const route = [lShape(start, end, true), lShape(start, end, false)].find((c) => c.every(([x, y]) => ok(x, y))) ?? bfs(start, end, ok, width, height) ?? lShape(start, end, true);
    out.push({ from: n.parent, to: n.path, cells: route.filter(([x, y]) => floor[y * width + x] !== ia && floor[y * width + x] !== ib) });
  }
  return out;
}

/** Inclusive straight line between two cells that share a row or column. */
function line([x0, y0]: Cell, [x1, y1]: Cell): Cell[] {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  const sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0);
  return Array.from({ length: n + 1 }, (_, i) => [x0 + sx * i, y0 + sy * i] as Cell);
}

function lShape(a: Cell, b: Cell, horizontalFirst: boolean): Cell[] {
  const corner: Cell = horizontalFirst ? [b[0], a[1]] : [a[0], b[1]];
  return [...line(a, corner), ...line(corner, b).slice(1)];
}

function bfs(start: Cell, end: Cell, ok: (x: number, y: number) => boolean, width: number, height: number): Cell[] | null {
  const prev = new Int32Array(width * height).fill(-1);
  const s = start[1] * width + start[0];
  const e = end[1] * width + end[0];
  prev[s] = s;
  const q = new Int32Array(width * height);
  let head = 0, tail = 0;
  q[tail++] = s;
  while (head < tail) {
    const c = q[head++];
    if (c === e) break;
    const x = c % width, y = (c / width) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (!ok(nx, ny)) continue;
      const k = ny * width + nx;
      if (prev[k] !== -1) continue;
      prev[k] = c;
      q[tail++] = k;
    }
  }
  if (prev[e] === -1) return null;
  const cells: Cell[] = [];
  for (let c = e; ; c = prev[c]) {
    cells.push([c % width, (c / width) | 0]);
    if (c === s) break;
  }
  return cells.reverse();
}
