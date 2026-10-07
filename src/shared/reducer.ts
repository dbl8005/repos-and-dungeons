import { speciesFor, type Species } from './bestiary.js';
import type { GameEvent, HeroClass, HeroId, TestFailure } from './events.js';
import type { DungeonMap, PathIndex, Room, Tile } from './map-types.js';

export type HeroStatus = 'active' | 'idle' | 'thinking' | 'locked';

export type HeroState = {
  id: HeroId;
  heroClass: HeroClass;
  parent?: HeroId;
  label: string;
  x: number;
  y: number;
  torch: { used: number; max: number };
  status: HeroStatus;
  seen: Set<number>;
  speech?: { text: string; t: number };
  /** The hero's latest visible action, for the HUD ("reading token.ts"). */
  last?: { kind: 'move' | 'forge' | 'cast' | 'scout' | 'test_result'; path?: string };
  lastT: number;
};

/**
 * One monster per (hero, runner, failing file); failures without a file share one. `hp` is how many checks fail
 * there now, `maxHp` the most seen since it spawned. Replaced (never mutated) on change, so old lists stay diffable.
 */
export type Monster = { id: string; hero: HeroId; runner: string; species: Species; room: string; name: string; file?: string; hp: number; maxHp: number };

export type GameState = {
  map: DungeonMap;
  index: PathIndex;
  heroes: Record<HeroId, HeroState>;
  seen: Set<number>;
  forged: Set<number>;
  monsters: Monster[];
  stamina?: { fiveHourPct: number; weeklyPct: number; resetsAt?: number };
  /** Slime taunts, keyed by the hero whose failing tests spawned them (speech from `monster:<heroId>`). */
  taunts: Record<HeroId, { text: string; t: number }>;
  lastT: number;
  /** Bumped whenever explored/forged tiles or monsters change; renderers redraw only when it moves. */
  version: number;
  /** Lookup caches, rebuilt by initialState. */
  rooms: Map<string, Room>;
  tiles: Map<number, Tile>;
};

export function initialState(map: DungeonMap, index: PathIndex): GameState {
  return {
    map,
    index,
    heroes: {},
    seen: new Set(),
    forged: new Set(),
    monsters: [],
    taunts: {},
    lastT: 0,
    version: 0,
    rooms: new Map(map.rooms.map((r) => [r.id, r])),
    tiles: new Map(map.tiles.map((t) => [t.id, t])),
  };
}

export function tileForPath(s: GameState, path: string): Tile | undefined {
  const id = s.index[path];
  return id === undefined ? undefined : s.tiles.get(id);
}

/** The deepest room whose folder contains `path`; the root room otherwise. */
export function roomForPath(s: GameState, path: string): Room {
  let best: Room | undefined;
  for (const r of s.map.rooms) {
    const inside = r.path === '' || path === r.path || path.startsWith(r.path + '/');
    if (inside && (!best || r.path.length > best.path.length)) best = r;
  }
  return best ?? s.map.rooms[0];
}

/** The hero's most recently spawned monster (the one whose taunt is showing). */
export function lastMonsterOf(s: GameState, hero: HeroId): Monster | undefined {
  return s.monsters.findLast((m) => m.hero === hero);
}

export const roomCenter = (r: Room) => ({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) });

function ensureHero(s: GameState, id: HeroId, t: number): HeroState {
  let h = s.heroes[id];
  if (!h) {
    const root = s.map.rooms[0];
    const c = root ? roomCenter(root) : { x: 0, y: 0 };
    h = { id, heroClass: 'adventurer', label: id.slice(0, 8), ...c, torch: { used: 0, max: 200_000 }, status: 'active', seen: new Set(), lastT: t };
    s.heroes[id] = h;
  }
  return h;
}

function placeAt(s: GameState, h: HeroState, path: string): Tile | undefined {
  const tile = tileForPath(s, path);
  const pos = tile ?? roomCenter(roomForPath(s, path));
  h.x = pos.x;
  h.y = pos.y;
  return tile;
}

/** Applies one event. Mutates and returns `s` (hot path); treat it as a pure function of (s, e). */
export function reduce(s: GameState, e: GameEvent): GameState {
  s.lastT = Math.max(s.lastT, e.t);
  if (e.kind === 'stamina') {
    s.stamina = { fiveHourPct: e.fiveHourPct, weeklyPct: e.weeklyPct, ...(e.resetsAt ? { resetsAt: e.resetsAt } : {}) };
    return s;
  }
  if (e.kind === 'speech' && e.hero.startsWith('monster:')) {
    s.taunts[e.hero.slice('monster:'.length)] = { text: e.text, t: e.t };
    return s;
  }
  if (e.kind === 'hero_left') {
    delete s.heroes[e.hero];
    return s;
  }
  const h = ensureHero(s, e.hero, e.t);
  h.lastT = e.t;
  if (e.kind !== 'idle' && e.kind !== 'thinking' && e.kind !== 'door_locked' && e.kind !== 'speech' && e.kind !== 'torch') h.status = 'active';

  if (e.kind === 'move' || e.kind === 'forge') h.last = { kind: e.kind, path: e.path };
  else if (e.kind === 'cast' || e.kind === 'scout' || e.kind === 'test_result') h.last = { kind: e.kind };

  switch (e.kind) {
    case 'hero_joined':
      h.heroClass = e.heroClass;
      h.label = e.label;
      if (e.parent) h.parent = e.parent;
      break;
    case 'move': {
      const tile = placeAt(s, h, e.path);
      if (tile) {
        h.seen.add(tile.id);
        if (!s.seen.has(tile.id)) s.version++;
        s.seen.add(tile.id);
      }
      break;
    }
    case 'forge': {
      const tile = placeAt(s, h, e.path);
      if (tile) {
        if (!s.forged.has(tile.id) || !s.seen.has(tile.id)) s.version++;
        s.forged.add(tile.id);
        h.seen.add(tile.id);
        s.seen.add(tile.id);
      }
      break;
    }
    case 'test_result': {
      s.version++;
      const groups = new Map<string, TestFailure[]>();
      for (const f of e.failed) groups.set(f.file ?? '', [...(groups.get(f.file ?? '') ?? []), f]);
      const next = new Map<string, Monster>();
      for (const [file, fails] of groups) {
        const id = JSON.stringify([e.hero, e.runner, file]);
        const old = s.monsters.find((m) => m.id === id);
        const room = file ? roomForPath(s, file) : s.map.rooms[0];
        const hp = fails.length;
        next.set(id, { id, hero: e.hero, runner: e.runner, species: e.species ?? speciesFor(e.runner), room: room.id, name: fails[0].name, ...(file ? { file } : {}), hp, maxHp: Math.max(old?.maxHp ?? 0, hp) });
      }
      // Survivors keep their place in the list (so they don't hop around the room); newcomers go last.
      const kept = s.monsters.flatMap((m) => (m.hero === e.hero && m.runner === e.runner ? (next.has(m.id) ? [next.get(m.id)!] : []) : [m]));
      const keptIds = new Set(kept.map((m) => m.id));
      s.monsters = [...kept, ...[...next.values()].filter((m) => !keptIds.has(m.id))];
      break;
    }
    case 'compacted':
      s.version++;
      for (const id of h.seen) {
        const other = Object.values(s.heroes).some((o) => o !== h && o.seen.has(id));
        if (!other) s.seen.delete(id);
      }
      h.seen.clear();
      break;
    case 'torch':
      h.torch = { used: e.used, max: e.max };
      break;
    case 'door_locked':
      h.status = 'locked';
      break;
    case 'idle':
      h.status = 'idle';
      break;
    case 'thinking':
      h.status = 'thinking';
      break;
    case 'speech':
      h.speech = { text: e.text, t: e.t };
      break;
    case 'scout':
    case 'cast':
    case 'door_opened':
      break;
  }
  return s;
}

/** Moves state onto a regenerated map: tile ids change, so explored and forged tiles are matched by file path. */
export function remapState(old: GameState, map: DungeonMap, index: PathIndex): GameState {
  const next = initialState(map, index);
  const remap = (ids: Set<number>) => {
    const out = new Set<number>();
    for (const id of ids) {
      const t = old.tiles.get(id);
      const n = t ? index[t.files[0]] : undefined;
      if (n !== undefined) out.add(n);
    }
    return out;
  };
  next.seen = remap(old.seen);
  next.forged = remap(old.forged);
  const root = map.rooms[0];
  for (const h of Object.values(old.heroes)) {
    const tile = h.last?.path !== undefined ? next.tiles.get(index[h.last.path]) : undefined;
    const pos = tile ?? (h.last?.path ? roomCenter(roomForPath(next, h.last.path)) : root ? roomCenter(root) : { x: 0, y: 0 });
    next.heroes[h.id] = { ...h, x: pos.x, y: pos.y, seen: remap(h.seen) };
  }
  next.monsters = old.monsters.flatMap((m) => {
    const room = m.file ? roomForPath(next, m.file) : map.rooms[0];
    return room ? [{ ...m, room: room.id }] : [];
  });
  next.stamina = old.stamina;
  next.lastT = old.lastT;
  next.version = old.version + 1;
  return next;
}
