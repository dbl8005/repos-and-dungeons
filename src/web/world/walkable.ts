import type { DungeonMap } from '../../shared/map-types.js';

export type Cell = [number, number];
export type Walkable = { w: number; h: number; cells: Uint8Array };

export function buildWalkable(map: DungeonMap): Walkable {
  const w = map.width, h = map.height;
  const cells = new Uint8Array(w * h);
  const set = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < w && y < h) cells[y * w + x] = 1;
  };
  for (const r of map.rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) set(x, y);
  for (const c of map.corridors) for (const [x, y] of c.cells) set(x, y);
  return { w, h, cells };
}

/** BFS, 4 directions. Returns the steps after `from` up to and including `to`, or null when unreachable. */
export function findPath(g: Walkable, from: Cell, to: Cell, maxNodes = 20_000): Cell[] | null {
  if (from[0] === to[0] && from[1] === to[1]) return [];
  const { w, h, cells } = g;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  if (!inside(...to) || !cells[to[1] * w + to[0]]) return null;
  const start = from[1] * w + from[0], goal = to[1] * w + to[0];
  const prev = new Map<number, number>([[start, start]]);
  const q = [start];
  for (let head = 0; head < q.length && head < maxNodes; head++) {
    const c = q[head];
    if (c === goal) break;
    const x = c % w, y = (c / w) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (!inside(nx, ny) || !cells[ny * w + nx]) continue;
      const k = ny * w + nx;
      if (prev.has(k)) continue;
      prev.set(k, c);
      q.push(k);
    }
  }
  if (!prev.has(goal)) return null;
  const path: Cell[] = [];
  for (let c = goal; c !== start; c = prev.get(c)!) path.push([c % w, (c / w) | 0]);
  return path.reverse();
}
