import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../src/shared/events.js';
import type { Monster } from '../../src/shared/reducer.js';
import { CueLimiter, musicState, planSounds } from '../../src/web/audio/planner.js';

const ev = (hero: string, body: object) => ({ t: 1, hero, ...body }) as GameEvent;
const mon = (id: string, hp: number): Monster => ({ id, hero: 'me', runner: 'v', species: 'slime', room: 'r0', name: 'x', hp, maxHp: hp });
const names = (evs: GameEvent[], ctx: Partial<Parameters<typeof planSounds>[1]> = {}) =>
  planSounds(evs, { followed: 'me', now: 0, monstersBefore: [], monstersAfter: [], ...ctx }).map((c) => c.name);

describe('planSounds', () => {
  it('maps the spec table', () => {
    expect(names([ev('me', { kind: 'move', path: 'a' })])).toEqual(['step', 'page']);
    expect(names([ev('other', { kind: 'move', path: 'a' })])).toEqual(['page']);
    expect(names([ev('me', { kind: 'scout', paths: [] })])).toEqual(['whoosh']);
    expect(names([ev('me', { kind: 'forge', path: 'a', created: false })])).toEqual(['anvil']);
    expect(names([ev('me', { kind: 'forge', path: 'a', created: true })])).toEqual(['anvil', 'sparkle']);
    expect(names([ev('me', { kind: 'cast', command: 'git' })])).toEqual(['shimmer']);
    expect(names([ev('me', { kind: 'test_result', runner: 'v', passed: 0, failed: [{ name: 'x' }] })], { monstersAfter: [mon('a', 1)] })).toEqual(['squelch']);
    expect(names([ev('me', { kind: 'test_result', runner: 'v', passed: 3, failed: [] })], { monstersBefore: [mon('a', 1), mon('b', 2)] })).toEqual(['hit', 'coins', 'victory']);
    expect(names([ev('me', { kind: 'door_locked' })])).toEqual(['chains']);
    expect(names([ev('me', { kind: 'door_opened' })])).toEqual(['creak']);
    expect(names([ev('me', { kind: 'hero_joined', heroClass: 'knight', label: 'x' })])).toEqual(['horn']);
    expect(names([ev('me', { kind: 'compacted' })])).toEqual(['wind']);
    expect(names([ev('me', { kind: 'speech', text: 'hi there' })])).toEqual(['blip']);
    expect(names([ev('me', { kind: 'torch', used: 1, max: 2 })])).toEqual([]);
  });
  it('hits when a monster takes damage, even while tests still fail', () => {
    const fail = [ev('me', { kind: 'test_result', runner: 'v', passed: 0, failed: [{ name: 'x' }] })];
    expect(names(fail, { monstersBefore: [mon('a', 3)], monstersAfter: [mon('a', 1)] })).toEqual(['squelch', 'hit']);
    expect(names(fail, { monstersBefore: [mon('a', 1), mon('b', 1)], monstersAfter: [mon('a', 1)] })).toEqual(['squelch', 'hit']);
    expect(names(fail, { monstersBefore: [mon('a', 1)], monstersAfter: [mon('a', 2)] })).toEqual(['squelch']);
    expect(names([...fail, ...fail], { monstersBefore: [mon('a', 3)], monstersAfter: [mon('a', 1)] })).toEqual(['squelch', 'hit', 'squelch']);
  });
  it('coins only when a monster actually died', () => {
    const clean = [ev('me', { kind: 'test_result', runner: 'lint', passed: 0, failed: [] })];
    expect(names(clean, { monstersBefore: [mon('a', 1)], monstersAfter: [mon('a', 1)] })).toEqual([]);
    expect(names(clean, { monstersBefore: [mon('a', 1), mon('b', 1)], monstersAfter: [mon('a', 1)] })).toEqual(['hit', 'coins']);
  });
  it('speech blips are pitched per hero, deterministically', () => {
    const p = (h: string) => planSounds([ev(h, { kind: 'speech', text: 'x y' })], { followed: null, now: 0, monstersBefore: [], monstersAfter: [] })[0].pitch;
    expect(p('a')).toBe(p('a'));
    expect(p('a')).not.toBe(p('zz-other'));
  });
});

describe('CueLimiter', () => {
  it('allows at most 4 per second and merges repeats within 300 ms', () => {
    const l = new CueLimiter();
    const allowed = ['step', 'page', 'anvil', 'hit', 'coins'].filter((n, i) => l.allow({ name: n as never }, i * 10));
    expect(allowed).toHaveLength(4);
    const m = new CueLimiter();
    expect(m.allow({ name: 'anvil' }, 0)).toBe(true);
    expect(m.allow({ name: 'anvil' }, 100)).toBe(false);
    expect(m.allow({ name: 'anvil' }, 400)).toBe(true);
    expect(m.allow({ name: 'step' }, 1500)).toBe(true);
  });
});

describe('musicState', () => {
  it('combat while monsters live, fading over 4 s after the last dies', () => {
    expect(musicState(2, null, 0)).toEqual({ explore: 1, combat: 1 });
    expect(musicState(0, null, 0).combat).toBe(0);
    expect(musicState(0, 10_000, 12_000).combat).toBeCloseTo(0.5);
    expect(musicState(0, 10_000, 15_000).combat).toBe(0);
  });
});
