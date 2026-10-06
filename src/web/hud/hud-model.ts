import type { HeroClass, HeroId } from '../../shared/events.js';
import type { DungeonMap } from '../../shared/map-types.js';
import type { GameState, HeroState } from '../../shared/reducer.js';

export type PartyRow = { id: HeroId; label: string; heroClass: HeroClass; status: string; torchPct: number; children: PartyRow[] };

export function torchPct(t: { used: number; max: number }): number {
  if (!t.max) return 100;
  return Math.max(0, Math.min(100, 100 - Math.round((t.used / t.max) * 100)));
}

const base = (p?: string) => (p ? p.slice(p.lastIndexOf('/') + 1) : '');

function heroRoom(s: GameState, h: HeroState) {
  return s.map.rooms.find((r) => h.x >= r.x && h.x < r.x + r.w && h.y >= r.y && h.y < r.y + r.h);
}

export function heroStatus(s: GameState, h: HeroState): string {
  if (h.status === 'locked') return '🔒 at a locked door';
  if (h.status === 'idle') return '💤 resting';
  const room = heroRoom(s, h);
  if (room && s.monsters.some((m) => m.room === room.id)) return `⚔ fighting in ${room.path ? room.path + '/' : '/'}`;
  switch (h.last?.kind) {
    case 'forge': return `🔨 forging ${base(h.last.path)}`;
    case 'move': return `📜 reading ${base(h.last.path)}`;
    case 'cast': return '✨ casting';
    case 'scout': return '🔦 scouting';
    case 'test_result': return '🧪 testing';
  }
  return h.status === 'thinking' ? '💭 thinking' : '🧭 exploring';
}

/** Party list for the HUD: top-level heroes with their subagents nested, most recently active first. */
export function partyRows(s: GameState): PartyRow[] {
  const heroes = Object.values(s.heroes).sort((a, b) => b.lastT - a.lastT);
  const row = (h: HeroState): PartyRow => ({
    id: h.id, label: h.label, heroClass: h.heroClass, status: heroStatus(s, h), torchPct: torchPct(h.torch),
    children: heroes.filter((c) => c.parent === h.id).map(row),
  });
  return heroes.filter((h) => !h.parent || !s.heroes[h.parent]).map(row);
}

export function minimapTransform(map: Pick<DungeonMap, 'width' | 'height'>, sizePx: number) {
  const k = sizePx / Math.max(map.width, map.height, 1);
  return {
    scale: k,
    toMini: ([x, y]: [number, number]): [number, number] => [x * k, y * k],
    toWorld: ([mx, my]: [number, number]): [number, number] => [mx / k, my / k],
  };
}

export type SearchHit = { path: string; x: number; y: number };

/** Rooms and alcoves whose folder path contains the query; shortest path first. Coordinates are tile centers. */
export function searchRooms(map: DungeonMap, query: string, limit = 8): SearchHit[] {
  const q = query.trim().toLowerCase();
  const hits: SearchHit[] = [];
  for (const r of map.rooms) {
    if (r.path.toLowerCase().includes(q)) hits.push({ path: r.path, x: r.x + r.w / 2, y: r.y + r.h / 2 });
    for (const a of r.alcoves) if (a.w && a.path.toLowerCase().includes(q)) hits.push({ path: a.path, x: a.x + a.w / 2, y: a.y + a.h / 2 });
  }
  return hits.sort((a, b) => a.path.length - b.path.length || (a.path < b.path ? -1 : 1)).slice(0, limit);
}

/** Keeps cards where they were (no jumping under the cursor); newcomers go at the end. */
export function stableOrder(prev: string[], ids: string[]): string[] {
  const live = new Set(ids);
  const kept = prev.filter((id) => live.has(id));
  const known = new Set(kept);
  return [...kept, ...ids.filter((id) => !known.has(id))];
}

/** Effects (sparks, popups) only for events from the last few seconds, not for history replayed on connect. */
export function isFresh(eventT: number, now: number, windowMs = 5_000): boolean {
  return now - eventT <= windowMs;
}
