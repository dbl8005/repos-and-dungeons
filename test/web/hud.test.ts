import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../src/shared/events.js';
import { generateMap } from '../../src/server/map/generate.js';
import { initialState, reduce } from '../../src/shared/reducer.js';
import { isFresh, minimapTransform, partyRows, searchRooms, stableOrder, torchPct } from '../../src/web/hud/hud-model.js';

const { map, index } = generateMap(['src/auth/token.ts', 'src/auth/token.test.ts', 'src/app.ts', 'docs/readme.md', 'lib/util.ts']);
let t = 0;
const ev = (hero: string, body: object) => ({ t: ++t, hero, ...body }) as GameEvent;

describe('partyRows', () => {
  it('nests subagents, sorts by recent activity and describes what each hero does', () => {
    const s = initialState(map, index);
    reduce(s, ev('lead', { kind: 'hero_joined', heroClass: 'knight', label: 'lead' }));
    reduce(s, ev('lead/a', { kind: 'hero_joined', heroClass: 'scout', label: 'a', parent: 'lead' }));
    reduce(s, ev('other', { kind: 'hero_joined', heroClass: 'squire', label: 'other' }));
    reduce(s, ev('lead/a', { kind: 'move', path: 'docs/readme.md' }));
    reduce(s, ev('other', { kind: 'forge', path: 'src/app.ts', created: false }));
    reduce(s, ev('lead', { kind: 'move', path: 'src/auth/token.ts' }));
    reduce(s, ev('lead', { kind: 'test_result', runner: 'vitest', passed: 0, failed: [{ file: 'src/auth/token.test.ts', name: 'x' }] }));
    const rows = partyRows(s);
    expect(rows.map((r) => r.id)).toEqual(['lead', 'other']);
    expect(rows[0].children.map((c) => c.id)).toEqual(['lead/a']);
    expect(rows[0].status).toBe('⚔ fighting in src/auth/');
    expect(rows[1].status).toBe('🔨 forging app.ts');
    expect(rows[0].children[0].status).toBe('📜 reading readme.md');
    reduce(s, ev('other', { kind: 'idle' }));
    expect(partyRows(s).find((r) => r.id === 'other')!.status).toBe('💤 resting');
  });
});

describe('torchPct', () => {
  it('is the remaining share, clamped', () => {
    expect(torchPct({ used: 50_000, max: 200_000 })).toBe(75);
    expect(torchPct({ used: 300_000, max: 200_000 })).toBe(0);
    expect(torchPct({ used: 0, max: 0 })).toBe(100);
  });
});

describe('minimapTransform', () => {
  it('round-trips', () => {
    const m = minimapTransform({ ...map, width: 100, height: 50 }, 200);
    expect(m.toMini([50, 25])).toEqual([100, 50]);
    expect(m.toWorld([100, 50])).toEqual([50, 25]);
  });
});

describe('searchRooms', () => {
  it('matches rooms case-insensitively, shortest path first', () => {
    const r = searchRooms(map, 'AUTH');
    expect(r[0].path).toBe('src/auth');
    expect(searchRooms(map, 'zzz')).toEqual([]);
    expect(searchRooms(map, '', 3).length).toBeLessThanOrEqual(3);
  });
});

describe('stableOrder', () => {
  it('keeps existing positions, appends newcomers, drops leavers', () => {
    expect(stableOrder(['a', 'b', 'c'], ['c', 'd', 'a'])).toEqual(['a', 'c', 'd']);
    expect(stableOrder([], ['x', 'y'])).toEqual(['x', 'y']);
  });
});

describe('isFresh', () => {
  it('only recent events get effects', () => {
    expect(isFresh(10_000, 12_000)).toBe(true);
    expect(isFresh(10_000, 16_000)).toBe(false);
  });
});
