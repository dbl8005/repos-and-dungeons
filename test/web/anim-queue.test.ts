import { describe, expect, it } from 'vitest';
import { HeroAnimator } from '../../src/web/world/anim-queue.js';
import type { Cell } from '../../src/web/world/walkable.js';

/** Straight L-shaped walk on an open grid. */
const open = (from: Cell, to: Cell): Cell[] => {
  const p: Cell[] = [];
  let [x, y] = from;
  while (x !== to[0]) p.push([(x += Math.sign(to[0] - x)), y]);
  while (y !== to[1]) p.push([x, (y += Math.sign(to[1] - y))]);
  return p;
};
const NOW = 100_000;

describe('HeroAnimator', () => {
  it('walks 6 tiles in about a second', () => {
    const a = new HeroAnimator([0, 0], open);
    a.goTo([6, 0], NOW);
    expect(a.update(500, NOW).x).toBeCloseTo(3, 1);
    const s = a.update(500, NOW);
    expect(s.x).toBeCloseTo(6, 5);
    expect(a.update(16, NOW).moving).toBe(false);
  });
  it('dashes to the last target when more than 5 s behind', () => {
    const a = new HeroAnimator([0, 0], open);
    for (let i = 1; i <= 200; i++) a.goTo([i % 20, Math.floor(i / 20)], NOW - 6_000);
    const s = a.update(16, NOW);
    expect([s.x, s.y]).toEqual([0, 10]);
    expect(s.dashed).toBe(true);
    expect(a.update(16, NOW).moving).toBe(false);
  });
  it('walks 3× faster when 2–5 s behind', () => {
    const a = new HeroAnimator([0, 0], open);
    a.goTo([10, 0], NOW - 3_000);
    expect(a.update(250, NOW).x).toBeCloseTo(4.5, 5);
  });
  it('jumps when there is no path', () => {
    const a = new HeroAnimator([0, 0], () => null);
    a.goTo([5, 5], NOW);
    const s = a.update(16, NOW);
    expect([s.x, s.y]).toEqual([5, 5]);
    expect(s.dashed).toBe(true);
  });
  it('faces the direction of travel', () => {
    const a = new HeroAnimator([5, 0], open);
    a.goTo([0, 0], NOW);
    expect(a.update(100, NOW).facing).toBe(-1);
    a.goTo([9, 0], NOW);
    a.update(2000, NOW);
    expect(a.update(16, NOW).facing).toBe(1);
  });
  it('queues targets and visits them in order', () => {
    const a = new HeroAnimator([0, 0], open);
    a.goTo([2, 0], NOW);
    a.goTo([2, 2], NOW);
    const mid = a.update(333, NOW);
    expect(mid.x).toBeCloseTo(2, 1);
    expect(mid.y).toBeCloseTo(0, 1);
    expect(a.update(400, NOW)).toMatchObject({ x: 2, y: 2 });
  });
  it('an unreachable target does not drop the rest of the queue', () => {
    const blocked = (f: Cell, to: Cell) => (to[0] === 3 && to[1] === 3 ? null : open(f, to));
    const a = new HeroAnimator([0, 0], blocked);
    a.goTo([3, 3], NOW);
    a.goTo([4, 3], NOW);
    a.goTo([6, 3], NOW);
    a.update(16, NOW);
    expect(a.update(1000, NOW)).toMatchObject({ x: 6, y: 3 });
  });
  it('dashes along a single long path when far behind', () => {
    const a = new HeroAnimator([0, 0], open);
    a.goTo([300, 0], NOW - 1_000);
    a.update(16, NOW - 1_000 + 16);
    const s = a.update(16, NOW + 5_000);
    expect(s).toMatchObject({ x: 300, dashed: true });
  });
});
