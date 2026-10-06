import { describe, expect, it } from 'vitest';
import { Director } from '../../src/web/world/director.js';

describe('Director', () => {
  it('follows the first active hero', () => {
    const d = new Director();
    d.activity('a', 0);
    d.activity('b', 10);
    expect(d.target(['a', 'b'], 20)).toBe('a');
  });
  it('ignores non-notable events from others', () => {
    const d = new Director();
    d.activity('a', 0);
    d.notable('b', 'move', 10_000);
    expect(d.target(['a', 'b'], 10_000)).toBe('a');
  });
  it('switches on a notable event only after the current hero is quiet for 5 s', () => {
    const d = new Director();
    d.activity('a', 0);
    d.notable('b', 'test_result', 3_000);
    expect(d.target(['a', 'b'], 3_000)).toBe('a');
    d.notable('b', 'forge', 5_500);
    expect(d.target(['a', 'b'], 5_500)).toBe('b');
  });
  it('lock holds until released', () => {
    const d = new Director();
    d.activity('a', 0);
    d.lock('b');
    d.notable('c', 'hero_joined', 60_000);
    expect(d.target(['a', 'b', 'c'], 60_000)).toBe('b');
    d.lock(null);
    expect(d.target(['a', 'b', 'c'], 60_000)).toBe('c');
  });
  it('falls back to the most recently active hero when the target leaves', () => {
    const d = new Director();
    d.activity('a', 0);
    d.activity('b', 100);
    d.activity('c', 50);
    expect(d.target(['b', 'c'], 200)).toBe('b');
  });
  it('does not flicker with 20 busy heroes', () => {
    const d = new Director();
    d.activity('h0', 0);
    const heroes = Array.from({ length: 20 }, (_, i) => `h${i + 1}`);
    let last = d.target(['h0', ...heroes], 0);
    let switches = 0;
    for (let t = 100; t <= 30_000; t += 100) {
      d.notable(heroes[(t / 100) % 20], 'forge', t);
      const now = d.target(['h0', ...heroes], t);
      if (now !== last) switches++;
      last = now;
    }
    expect(switches).toBeLessThanOrEqual(6);
  });
});
