import type { DungeonMap } from '../../shared/map-types.js';

/** "Room 1…N" labels in map order for exports with folder names hidden; the root stays "/". */
export function roomAliases(map: DungeonMap): Map<string, string> {
  return new Map(map.rooms.map((r, i) => [r.id, r.path === '' ? '/' : `Room ${i}`]));
}

/** Top-level folder names that appear in an export (shown in the privacy dialog). */
export function visibleFolderNames(map: DungeonMap, limit = 12): string[] {
  const top = new Set<string>();
  for (const r of map.rooms) if (r.path) top.add(r.path.split('/')[0]);
  return [...top].sort().slice(0, limit);
}
