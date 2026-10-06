import { describe, expect, it } from 'vitest';
import { frameBounds } from '../../src/web/timelapse/framing.js';
import { Timelapse } from '../../src/web/timelapse/timelapse.js';
import { generateMap } from '../../src/server/map/generate.js';
import type { GameEvent } from '../../src/shared/events.js';

const VP = { w: 1280, h: 720 };

describe('frameBounds', () => {
  it('a single point is centered at max zoom', () => {
    expect(frameBounds([{ x: 10, y: 5 }], VP, 16)).toEqual({ x: 168, y: 88, zoom: 3 });
  });
  it('spread points fit the viewport', () => {
    const f = frameBounds([{ x: 0, y: 0 }, { x: 100, y: 40 }], VP, 16);
    expect(f.zoom).toBeCloseTo(Math.min(1280 / (108 * 16), 720 / (48 * 16)));
    expect(f.x).toBeCloseTo(50.5 * 16);
  });
  it('empty → fallback center at min zoom', () => {
    expect(frameBounds([], VP, 16, { center: { x: 20, y: 10 } })).toEqual({ x: 328, y: 168, zoom: 0.35 });
  });
});

describe('Timelapse', () => {
  it('feeds events by video time into its own state, re-timed to video ms', () => {
    const { map, index } = generateMap(['a.ts', 'b.ts']);
    const evs: GameEvent[] = [
      { t: 1_000, hero: 'h', kind: 'hero_joined', heroClass: 'knight', label: 'h' },
      { t: 2_000, hero: 'h', kind: 'move', path: 'a.ts' },
      { t: 3_000, hero: 'h', kind: 'move', path: 'b.ts' },
    ];
    const tl = new Timelapse(map, index, evs, 10_000);
    expect(tl.advance(0).fed.map((e) => e.kind)).toEqual(['hero_joined']);
    const mid = tl.advance(4_700);
    expect(mid.fed.map((e) => e.t)).toEqual([4_600]);
    expect(tl.state.seen.size).toBe(1);
    const end = tl.advance(10_000);
    expect(end.done).toBe(true);
    expect(end.sessionMs).toBe(2_000);
    expect(tl.state.seen.size).toBe(2);
  });
  it('is empty-safe', () => {
    const { map, index } = generateMap(['a.ts']);
    const tl = new Timelapse(map, index, [], 5_000);
    expect(tl.isEmpty).toBe(true);
    expect(tl.advance(5_000).done).toBe(true);
  });
  it('reports each event right after it is applied, so effects see per-event positions', () => {
    const { map, index } = generateMap(['a.ts', 'b.ts']);
    const evs: GameEvent[] = [
      { t: 1, hero: 'h', kind: 'hero_joined', heroClass: 'knight', label: 'h' },
      { t: 2, hero: 'h', kind: 'move', path: 'a.ts' },
      { t: 3, hero: 'h', kind: 'move', path: 'b.ts' },
    ];
    const tl = new Timelapse(map, index, evs, 10_000);
    const seen: [number, number][] = [];
    tl.advance(10_000, (e, s) => e.kind === 'move' && seen.push([s.heroes.h.x, s.heroes.h.y]));
    const tile = (p: string) => map.tiles.find((t) => t.id === index[p])!;
    expect(seen).toEqual([[tile('a.ts').x, tile('a.ts').y], [tile('b.ts').x, tile('b.ts').y]]);
  });
  it('keeps its own copy of the history', () => {
    const { map, index } = generateMap(['a.ts']);
    const evs: GameEvent[] = [{ t: 1, hero: 'h', kind: 'move', path: 'a.ts' }, { t: 2, hero: 'h', kind: 'idle' }];
    const tl = new Timelapse(map, index, evs, 5_000);
    evs.length = 0;
    expect(tl.advance(5_000).fed).toHaveLength(2);
  });
});
