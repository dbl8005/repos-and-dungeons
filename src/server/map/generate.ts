import { fnv1a32 } from '../../shared/hash.js';
import type { Decor, DungeonMap, PathIndex, Rect, Room } from '../../shared/map-types.js';
import { routeCorridors } from './corridors.js';
import { placeRooms, sizeRoom } from './layout.js';
import { buildRooms } from './room-budget.js';
import { buildPathIndex, fillTiles } from './tiles.js';

const MAX_SIDE = 256;
const MARGIN = 2;

export function generateMap(paths: string[]): { map: DungeonMap; index: PathIndex } {
  const sorted = [...new Set(paths)].sort();
  const nodes = buildRooms(sorted);

  // Shrink rooms until the layout fits the 256×256 cap.
  let rects: Map<string, Rect>;
  for (let scale = 1; ; scale *= 0.75) {
    const sizes = new Map(nodes.map((n) => [n.path, sizeRoom(n.files.length, scale)]));
    rects = placeRooms(nodes, sizes);
    const b = bounds(rects);
    if ((b.maxX - b.minX <= MAX_SIDE - 2 * MARGIN && b.maxY - b.minY <= MAX_SIDE - 2 * MARGIN) || scale < 0.1) break;
  }
  const b = bounds(rects);
  for (const r of rects.values()) {
    r.x += MARGIN - b.minX;
    r.y += MARGIN - b.minY;
  }
  const width = b.maxX - b.minX + 2 * MARGIN;
  const height = b.maxY - b.minY + 2 * MARGIN;

  const roomIds = new Map(nodes.map((n, i) => [n.path, `r${i}`]));
  const tiles = fillTiles(nodes, rects, roomIds);
  const index = buildPathIndex(tiles, nodes, roomIds);

  const rooms: Room[] = nodes.map((n) => {
    const r = rects.get(n.path)!;
    const id = roomIds.get(n.path)!;
    const alcoves = n.alcoves.map((a) => {
      const own = tiles.filter((t) => t.room === id && (t.files[0].startsWith(a + '/') || t.files[1].startsWith(a + '/')));
      if (!own.length) return { path: a, x: r.x, y: r.y, w: 0, h: 0 };
      const xs = own.map((t) => t.x), ys = own.map((t) => t.y);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { path: a, x, y, w: Math.max(...xs) - x + 1, h: Math.max(...ys) - y + 1 };
    });
    return { id, path: n.path, ...r, alcoves };
  });

  // One wall torch per room, kept clear of the room-name pill on the left of the top wall.
  const decor: Decor[] = rooms.map((r) => {
    const labelTiles = Math.ceil(((r.path || '/').length + 1) * 0.36) + 1;
    const free = Math.max(1, r.w - 1 - labelTiles);
    return { kind: 'torch', x: r.x + Math.min(r.w - 1, labelTiles + (fnv1a32(r.path) % free)), y: r.y - 1 };
  });

  return {
    map: {
      seed: fnv1a32(sorted.join('\n')).toString(16),
      width,
      height,
      rooms,
      tiles,
      corridors: routeCorridors(rects, nodes, width, height),
      decor,
    },
    index,
  };
}

function bounds(rects: Map<string, Rect>) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects.values()) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { minX, minY, maxX, maxY };
}
