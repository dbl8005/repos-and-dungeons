import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../src/shared/events.js';
import type { DungeonMap, PathIndex } from '../../src/shared/map-types.js';
import { BOSS_HP, isBoss, speciesFor } from '../../src/shared/bestiary.js';
import { initialState, lastMonsterOf, reduce, remapState, roomForPath, tileForPath } from '../../src/shared/reducer.js';

const map: DungeonMap = {
  seed: 'x', width: 40, height: 20,
  rooms: [
    { id: 'r0', path: '', x: 1, y: 1, w: 6, h: 4, alcoves: [] },
    { id: 'r1', path: 'src', x: 10, y: 1, w: 6, h: 4, alcoves: [] },
    { id: 'r2', path: 'src/auth', x: 20, y: 1, w: 8, h: 6, alcoves: [] },
  ],
  tiles: [
    { id: 0, room: 'r0', x: 1, y: 1, kind: 'doc', files: ['README.md', 'README.md'], count: 1 },
    { id: 1, room: 'r1', x: 10, y: 1, kind: 'code', files: ['src/a.ts', 'src/a.ts'], count: 1 },
    { id: 2, room: 'r2', x: 20, y: 1, kind: 'code', files: ['src/auth/token.ts', 'src/auth/token.ts'], count: 1 },
    { id: 3, room: 'r2', x: 21, y: 1, kind: 'test', files: ['src/auth/token.test.ts', 'src/auth/token.test.ts'], count: 1 },
  ],
  corridors: [], decor: [],
};
const index: PathIndex = { 'README.md': 0, 'src/a.ts': 1, 'src/auth/token.ts': 2, 'src/auth/token.test.ts': 3 };
let t = 0;
const ev = (hero: string, body: object) => ({ t: ++t, hero, ...body }) as GameEvent;
const join = (hero: string) => ev(hero, { kind: 'hero_joined', heroClass: 'knight', label: hero });

describe('reducer', () => {
  it('move puts the hero on the tile and clears fog', () => {
    const s = initialState(map, index);
    reduce(s, join('h1'));
    reduce(s, ev('h1', { kind: 'move', path: 'src/a.ts' }));
    expect(s.heroes.h1).toMatchObject({ x: 10, y: 1, heroClass: 'knight' });
    expect(s.seen.has(1)).toBe(true);
  });
  it('move to an unknown path lands in the room center without throwing', () => {
    const s = initialState(map, index);
    reduce(s, join('h1'));
    reduce(s, ev('h1', { kind: 'move', path: 'src/auth/brand-new.ts' }));
    expect(s.heroes.h1).toMatchObject({ x: 24, y: 4 });
    reduce(s, ev('h1', { kind: 'move', path: 'nowhere/x.ts' }));
    expect(s.heroes.h1).toMatchObject({ x: 4, y: 3 });
  });
  it('events for unknown heroes auto-join them as adventurers', () => {
    const s = initialState(map, index);
    reduce(s, ev('ghost', { kind: 'move', path: 'src/a.ts' }));
    expect(s.heroes.ghost.heroClass).toBe('adventurer');
  });
  it('failing tests spawn monsters; a clean run of the same runner kills them', () => {
    const s = initialState(map, index);
    reduce(s, join('h1'));
    reduce(s, ev('h1', { kind: 'test_result', runner: 'vitest', passed: 1, failed: [{ file: 'src/auth/token.test.ts', name: 'a' }, { name: 'b' }] }));
    expect(s.monsters.map((m) => m.room)).toEqual(['r2', 'r0']);
    reduce(s, ev('h1', { kind: 'test_result', runner: 'pytest', passed: 1, failed: [] }));
    expect(s.monsters).toHaveLength(2);
    reduce(s, ev('h1', { kind: 'test_result', runner: 'vitest', passed: 3, failed: [] }));
    expect(s.monsters).toHaveLength(0);
  });
  it('a new failing run replaces that runner\'s monsters instead of piling up', () => {
    const s = initialState(map, index);
    const fail = ev('h1', { kind: 'test_result', runner: 'vitest', passed: 0, failed: [{ name: 'a' }] });
    reduce(s, fail);
    reduce(s, { ...fail, t: ++t });
    expect(s.monsters).toHaveLength(1);
  });
  describe('combat', () => {
    const run = (runner: string, failed: { file?: string; name: string }[]) => ev('h1', { kind: 'test_result', runner, passed: 0, failed });
    const tok = 'src/auth/token.test.ts';
    const fails = (n: number, file = tok) => Array.from({ length: n }, (_, i) => ({ file, name: `t${i}` }));

    it('one monster per file; reruns keep the same monster (no respawn)', () => {
      const s = initialState(map, index);
      reduce(s, run('vitest', fails(3)));
      const first = s.monsters[0];
      expect(s.monsters).toHaveLength(1);
      expect(first).toMatchObject({ id: JSON.stringify(['h1', 'vitest', tok]), hp: 3, maxHp: 3, species: 'slime', room: 'r2', name: 't0', file: tok });
      reduce(s, run('vitest', fails(3)));
      expect(s.monsters.map((m) => m.id)).toEqual([first.id]);
    });
    it('damage lowers hp, maxHp remembers the peak, and the old object is left untouched', () => {
      const s = initialState(map, index);
      reduce(s, run('vitest', fails(3)));
      const before = s.monsters;
      reduce(s, run('vitest', fails(1)));
      expect(s.monsters[0]).toMatchObject({ hp: 1, maxHp: 3 });
      expect(before[0].hp).toBe(3);
      reduce(s, run('vitest', fails(2)));
      expect(s.monsters[0]).toMatchObject({ hp: 2, maxHp: 3 });
    });
    it('dies on a clean rerun or when its file stops failing; maxHp resets after death', () => {
      const s = initialState(map, index);
      reduce(s, run('vitest', [...fails(2), ...fails(1, 'src/a.test.ts')]));
      expect(s.monsters.map((m) => m.file)).toEqual([tok, 'src/a.test.ts']);
      expect(s.monsters.map((m) => m.room)).toEqual(['r2', 'r1']);
      reduce(s, run('vitest', fails(1, 'src/a.test.ts')));
      expect(s.monsters.map((m) => m.file)).toEqual(['src/a.test.ts']);
      reduce(s, run('vitest', []));
      expect(s.monsters).toEqual([]);
      reduce(s, run('vitest', fails(1)));
      expect(s.monsters[0]).toMatchObject({ hp: 1, maxHp: 1 });
    });
    it('failures without a file group into one monster per runner', () => {
      const s = initialState(map, index);
      reduce(s, run('generic', [{ name: 'a' }, { name: 'b' }]));
      expect(s.monsters).toHaveLength(1);
      expect(s.monsters[0]).toMatchObject({ id: JSON.stringify(['h1', 'generic', '']), hp: 2, room: 'r0', name: 'a' });
      expect(s.monsters[0].file).toBeUndefined();
    });
    it('species come from the runner; other runners are left alone', () => {
      const s = initialState(map, index);
      reduce(s, run('typecheck', fails(1, 'src/a.ts')));
      reduce(s, run('lint', fails(1, 'src/a.ts')));
      reduce(s, run('build', [{ name: 'build' }]));
      expect(s.monsters.map((m) => m.species)).toEqual(['goblin', 'bat', 'ogre']);
      reduce(s, run('typecheck', []));
      expect(s.monsters.map((m) => m.species)).toEqual(['bat', 'ogre']);
    });
    it('the event species wins over the runner; a build key can hold goblins and an ogre', () => {
      const s = initialState(map, index);
      reduce(s, ev('h1', { kind: 'test_result', runner: 'build', species: 'goblin', passed: 0, failed: fails(1, 'src/a.ts') }));
      expect(s.monsters.map((m) => m.species)).toEqual(['goblin']);
      reduce(s, ev('h1', { kind: 'test_result', runner: 'build', species: 'ogre', passed: 0, failed: [{ name: 'build' }] }));
      expect(s.monsters.map((m) => m.species)).toEqual(['ogre']);
      reduce(s, ev('h1', { kind: 'test_result', runner: 'build', passed: 0, failed: [] }));
      expect(s.monsters).toEqual([]);
    });
    it('ids cannot collide when names contain the separator', () => {
      const s = initialState(map, index);
      reduce(s, run('a:b', [{ file: 'c', name: 'x' }]));
      reduce(s, run('a', [{ file: 'b:c', name: 'x' }]));
      expect(new Set(s.monsters.map((m) => m.id)).size).toBe(2);
    });
    it('lastMonsterOf is the hero\'s most recently spawned monster', () => {
      const s = initialState(map, index);
      reduce(s, run('vitest', fails(1)));
      reduce(s, run('typecheck', fails(1, 'src/a.ts')));
      reduce(s, run('vitest', fails(2)));
      expect(lastMonsterOf(s, 'h1')?.species).toBe('goblin');
      expect(lastMonsterOf(s, 'nobody')).toBeUndefined();
    });
    it('a file with BOSS_HP failures is a boss', () => {
      const s = initialState(map, index);
      reduce(s, run('vitest', fails(BOSS_HP)));
      expect(isBoss(s.monsters[0])).toBe(true);
      reduce(s, run('vitest', fails(BOSS_HP - 1)));
      expect(isBoss(s.monsters[0])).toBe(false);
    });
    it('every test_result bumps the version', () => {
      const s = initialState(map, index);
      const v = s.version;
      reduce(s, run('vitest', fails(2)));
      reduce(s, run('vitest', fails(1)));
      expect(s.version).toBe(v + 2);
    });
  });
  it('compaction re-fogs only tiles no other hero has seen', () => {
    const s = initialState(map, index);
    reduce(s, join('h1'));
    reduce(s, join('h2'));
    reduce(s, ev('h1', { kind: 'move', path: 'src/a.ts' }));
    reduce(s, ev('h1', { kind: 'move', path: 'README.md' }));
    reduce(s, ev('h2', { kind: 'move', path: 'README.md' }));
    reduce(s, ev('h1', { kind: 'compacted' }));
    expect(s.seen.has(1)).toBe(false);
    expect(s.seen.has(0)).toBe(true);
  });
  it('forge marks the tile, scout does not clear fog, hero_left removes', () => {
    const s = initialState(map, index);
    reduce(s, join('h1'));
    reduce(s, ev('h1', { kind: 'forge', path: 'src/auth/token.ts', created: false }));
    expect(s.forged.has(2)).toBe(true);
    reduce(s, ev('h1', { kind: 'scout', paths: ['src/a.ts'] }));
    expect(s.seen.has(1)).toBe(false);
    reduce(s, ev('h1', { kind: 'hero_left' }));
    expect(s.heroes.h1).toBeUndefined();
  });
  it('torch, idle, door and stamina update state', () => {
    const s = initialState(map, index);
    reduce(s, join('h1'));
    reduce(s, ev('h1', { kind: 'torch', used: 50, max: 200 }));
    expect(s.heroes.h1.torch).toEqual({ used: 50, max: 200 });
    reduce(s, ev('h1', { kind: 'door_locked' }));
    expect(s.heroes.h1.status).toBe('locked');
    reduce(s, ev('h1', { kind: 'idle' }));
    expect(s.heroes.h1.status).toBe('idle');
    reduce(s, ev('', { kind: 'stamina', fiveHourPct: 41, weeklyPct: 18 }));
    expect(s.stamina).toEqual({ fiveHourPct: 41, weeklyPct: 18 });
    expect(s.heroes['']).toBeUndefined();
  });
  it('lookups', () => {
    const s = initialState(map, index);
    expect(tileForPath(s, 'src/a.ts')?.id).toBe(1);
    expect(roomForPath(s, 'src/auth/x/y.ts').id).toBe('r2');
    expect(roomForPath(s, 'srcx/a.ts').id).toBe('r0');
  });
  it('remapState carries heroes, explored and forged tiles over to a new map by file path', () => {
    const s = initialState(map, index);
    reduce(s, join('h1'));
    reduce(s, ev('h1', { kind: 'move', path: 'src/a.ts' }));
    reduce(s, ev('h1', { kind: 'forge', path: 'src/auth/token.ts', created: false }));
    reduce(s, ev('h1', { kind: 'test_result', runner: 'typecheck', passed: 0, failed: [{ file: 'src/auth/token.test.ts', name: 'x' }, { file: 'src/auth/token.test.ts', name: 'y' }] }));
    reduce(s, ev('h1', { kind: 'test_result', runner: 'typecheck', passed: 0, failed: [{ file: 'src/auth/token.test.ts', name: 'x' }] }));
    const map2: DungeonMap = { ...map, tiles: map.tiles.map((t) => ({ ...t, id: t.id + 10 })) };
    const index2: PathIndex = Object.fromEntries(Object.entries(index).map(([k, v]) => [k, v + 10]));
    const n = remapState(s, map2, index2);
    expect([...n.seen].sort()).toEqual([11, 12]);
    expect([...n.forged]).toEqual([12]);
    expect(n.heroes.h1.seen.has(11)).toBe(true);
    expect(n.monsters).toHaveLength(1);
    expect(n.monsters[0]).toMatchObject({ hp: 1, maxHp: 2, species: 'goblin', room: 'r2' });
  });
  it('remapState moves heroes onto their last file in the new map, else to the root room', () => {
    const s = initialState(map, index);
    reduce(s, join('h1'));
    reduce(s, join('h2'));
    reduce(s, ev('h1', { kind: 'move', path: 'src/a.ts' }));
    reduce(s, ev('h2', { kind: 'cast', command: 'ls' }));
    s.heroes.h2.x = 99;
    const map2: DungeonMap = { ...map, rooms: map.rooms.map((r) => ({ ...r, x: r.x + 50 })), tiles: map.tiles.map((t) => ({ ...t, x: t.x + 50 })) };
    const n = remapState(s, map2, index);
    expect(n.heroes.h1).toMatchObject({ x: 60, y: 1 });
    expect(n.heroes.h2).toMatchObject({ x: 54, y: 3 });
  });
  it('version changes whenever what the map shows changes, even when the seen set keeps its size', () => {
    const s = initialState(map, index);
    reduce(s, join('h1'));
    reduce(s, ev('h1', { kind: 'move', path: 'src/a.ts' }));
    const v1 = s.version;
    reduce(s, ev('h1', { kind: 'compacted' }));
    reduce(s, ev('h1', { kind: 'move', path: 'README.md' }));
    expect(s.seen.size).toBe(1);
    expect(s.version).toBeGreaterThan(v1);
    const v2 = s.version;
    reduce(s, ev('h1', { kind: 'torch', used: 1, max: 2 }));
    expect(s.version).toBe(v2);
  });
  it('monster taunts are stored per hero, never as a new hero', () => {
    const s = initialState(map, index);
    reduce(s, join('h1'));
    reduce(s, ev('monster:h1', { kind: 'speech', text: 'Your tests are MINE!' }));
    expect(s.heroes['monster:h1']).toBeUndefined();
    expect(s.taunts.h1).toMatchObject({ text: 'Your tests are MINE!' });
  });
});

describe('bestiary', () => {
  it('maps runners to species', () => {
    expect(['vitest', 'pytest', 'generic', 'whatever', 'typecheck', 'lint', 'build'].map(speciesFor)).toEqual(['slime', 'slime', 'slime', 'slime', 'goblin', 'bat', 'ogre']);
  });
});
