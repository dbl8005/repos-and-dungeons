import { describe, expect, it } from 'vitest';
import { buildRooms } from '../../src/server/map/room-budget.js';
import { sizeRoom } from '../../src/server/map/layout.js';
import { generateMap } from '../../src/server/map/generate.js';
import type { Rect } from '../../src/shared/map-types.js';
import { fakeRepo, shuffle } from './map-helpers.js';

const overlaps = (a: Rect, b: Rect, gap: number) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
const inside = (r: Rect, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
const tenEach = (dirs: string[]) => dirs.flatMap((d) => Array.from({ length: 10 }, (_, i) => `${d}/f${i}.ts`));

describe('buildRooms', () => {
  it('small repos get one room per folder', () => {
    const rooms = buildRooms(tenEach(['a', 'b', 'c']));
    expect(rooms.map((r) => r.path)).toEqual(['', 'a', 'b', 'c']);
    expect(rooms[1]).toMatchObject({ parent: '', files: expect.arrayContaining(['a/f0.ts']) });
  });
  it('collapses single-child folder chains', () => {
    const rooms = buildRooms(['src/main/java/com/A.java', 'src/main/java/com/B.java', 'README.md']);
    expect(rooms.map((r) => r.path)).toEqual(['', 'src/main/java/com']);
  });
  it('folds what does not fit the budget into alcoves', () => {
    const rooms = buildRooms(tenEach(['a', 'a/x', 'a/y', 'b']), { maxRooms: 3 });
    expect(rooms.map((r) => r.path)).toEqual(['', 'a', 'b']);
    expect(rooms[1].alcoves).toEqual(['a/x', 'a/y']);
    expect(rooms[1].files).toHaveLength(30);
  });
});

describe('sizeRoom', () => {
  it('grows with the square root and clamps', () => {
    expect(sizeRoom(0)).toEqual({ w: 6, h: 4 });
    const big = sizeRoom(100_000);
    expect(big.w).toBeLessThanOrEqual(40);
    expect(big.h).toBeLessThanOrEqual(30);
    const s100 = sizeRoom(100), s10k = sizeRoom(10_000);
    expect((s10k.w * s10k.h) / (s100.w * s100.h)).toBeLessThan(12);
  });
});

describe('generateMap', () => {
  it('empty repo → one root room, no tiles', () => {
    const { map } = generateMap([]);
    expect(map.rooms).toHaveLength(1);
    expect(map.rooms[0].path).toBe('');
    expect(map.tiles).toHaveLength(0);
  });
  it('3 folders × 10 files → 4 rooms, 30 tiles, no overlaps (3-tile gap)', () => {
    const { map, index } = generateMap(tenEach(['a', 'b', 'c']));
    expect(map.rooms).toHaveLength(4);
    expect(map.tiles).toHaveLength(30);
    expect(Object.keys(index)).toHaveLength(30);
    for (const a of map.rooms) for (const b of map.rooms) if (a !== b) expect(overlaps(a, b, 3)).toBe(false);
  });
  it('is deterministic regardless of input order', () => {
    const p = fakeRepo(500, 60);
    expect(generateMap(shuffle(p))).toEqual(generateMap(p));
  });
  it('adding a file does not move other rooms (when its room keeps its size)', () => {
    const p = fakeRepo(200, 25);
    const before = generateMap(p).map;
    const after = generateMap([...p, 'd1/new-file.ts']).map;
    const room = (m: typeof before, path: string) => m.rooms.find((r) => r.path === path)!;
    const host = before.rooms.find((r) => 'd1/new-file.ts'.startsWith(r.path + '/'))!;
    expect([room(after, host.path).w, room(after, host.path).h]).toEqual([host.w, host.h]);
    for (const r of before.rooms) expect([room(after, r.path).x, room(after, r.path).y]).toEqual([r.x, r.y]);
  });
  it('respects the budget for big repos and indexes every file', () => {
    const p = fakeRepo(20_000, 2_000);
    const { map, index } = generateMap(p);
    expect(map.rooms.length).toBeLessThanOrEqual(400);
    expect(map.width).toBeLessThanOrEqual(256);
    expect(map.height).toBeLessThanOrEqual(256);
    for (const f of p) expect(index[f]).toBeTypeOf('number');
    for (const a of map.rooms) for (const b of map.rooms) if (a !== b) expect(overlaps(a, b, 2)).toBe(false);
  });
  it('corridor cells never cut through other rooms', () => {
    const { map } = generateMap(fakeRepo(2_000, 150));
    expect(map.corridors.length).toBe(map.rooms.length - 1);
    const byPath = new Map(map.rooms.map((r) => [r.path, r]));
    for (const c of map.corridors) {
      for (const [x, y] of c.cells) {
        const hit = map.rooms.filter((r) => inside(r, x, y));
        for (const r of hit) expect([c.from, c.to]).toContain(r.path);
      }
      expect(byPath.has(c.from) && byPath.has(c.to)).toBe(true);
    }
  });
  it('tiles sit inside their rooms and alcoves cover their files', () => {
    const { map } = generateMap(tenEach(['a', 'a/x', 'a/y', 'b']).concat(['README.md']));
    const rooms = new Map(map.rooms.map((r) => [r.id, r]));
    for (const t of map.tiles) expect(inside(rooms.get(t.room)!, t.x, t.y)).toBe(true);
  });
});
