import { describe, expect, it } from 'vitest';
import { generateMap } from '../../src/server/map/generate.js';
import type { DungeonMap } from '../../src/shared/map-types.js';
import { buildWalkable, findPath } from '../../src/web/world/walkable.js';

const box: DungeonMap = { seed: '', width: 20, height: 12, rooms: [{ id: 'r0', path: '', x: 2, y: 2, w: 6, h: 4, alcoves: [] }, { id: 'r1', path: 'z', x: 12, y: 2, w: 4, h: 4, alcoves: [] }], tiles: [], corridors: [], decor: [] };

describe('walkable', () => {
  it('room floors are walkable, walls are not', () => {
    const g = buildWalkable(box);
    expect(g.cells[2 * g.w + 2]).toBe(1);
    expect(g.cells[1 * g.w + 2]).toBe(0);
  });
  it('finds a Manhattan path inside a room', () => {
    const p = findPath(buildWalkable(box), [2, 2], [7, 5])!;
    expect(p).toHaveLength(8);
    expect(p.at(-1)).toEqual([7, 5]);
  });
  it('crosses corridors between rooms; every step walkable and adjacent', () => {
    const { map } = generateMap(['a/x.ts', 'b/y.ts']);
    const g = buildWalkable(map);
    const [a, b] = map.rooms.slice(1);
    const from: [number, number] = [a.x, a.y], to: [number, number] = [b.x, b.y];
    const p = findPath(g, from, to)!;
    expect(p).not.toBeNull();
    let prev = from;
    for (const c of p) {
      expect(g.cells[c[1] * g.w + c[0]]).toBe(1);
      expect(Math.abs(c[0] - prev[0]) + Math.abs(c[1] - prev[1])).toBe(1);
      prev = c;
    }
  });
  it('unreachable → null; same cell → []', () => {
    const g = buildWalkable(box);
    expect(findPath(g, [2, 2], [12, 2])).toBeNull();
    expect(findPath(g, [3, 3], [3, 3])).toEqual([]);
  });
});
