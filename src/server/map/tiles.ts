import type { PathIndex, Rect, Tile, TileKind } from '../../shared/map-types.js';
import type { RoomNode } from './room-budget.js';

export function kindOf(path: string): TileKind {
  const p = path.toLowerCase();
  if (/(^|[/._-])(test|tests|spec|__tests__)([/._-]|$)/.test(p)) return 'test';
  if (/\.(md|mdx|rst|txt|adoc)$/.test(p)) return 'doc';
  if (/\.(json|ya?ml|toml|ini|env|lock|cfg|conf)$|rc$|(^|\/)\.[^/]+$/.test(p)) return 'config';
  if (/\.(svg|css|scss|html|csv)$/.test(p)) return 'asset';
  return 'code';
}

/** Interior tiles (1-tile margin), row by row. Crowded rooms put a contiguous bucket of files on each tile. */
export function fillTiles(nodes: RoomNode[], rects: Map<string, Rect>, roomIds: Map<string, string>): Tile[] {
  const tiles: Tile[] = [];
  for (const n of nodes) {
    if (n.files.length === 0) continue;
    const r = rects.get(n.path)!;
    const slots: [number, number][] = [];
    for (let y = r.y + 1; y < r.y + r.h - 1; y++) for (let x = r.x + 1; x < r.x + r.w - 1; x++) slots.push([x, y]);
    const bucket = Math.ceil(n.files.length / slots.length);
    for (let i = 0, s = 0; i < n.files.length; i += bucket, s++) {
      const files = n.files.slice(i, i + bucket);
      tiles.push({ id: tiles.length, room: roomIds.get(n.path)!, x: slots[s][0], y: slots[s][1], kind: kindOf(files[0]), files: [files[0], files[files.length - 1]], count: files.length });
    }
  }
  return tiles;
}

export function buildPathIndex(tiles: Tile[], nodes: RoomNode[], roomIds: Map<string, string>): PathIndex {
  const byRoom = new Map<string, Tile[]>();
  for (const t of tiles) {
    const l = byRoom.get(t.room);
    if (l) l.push(t);
    else byRoom.set(t.room, [t]);
  }
  const index: PathIndex = {};
  for (const n of nodes) {
    let i = 0;
    for (const t of byRoom.get(roomIds.get(n.path)!) ?? []) for (let k = 0; k < t.count; k++) index[n.files[i++]] = t.id;
  }
  return index;
}
