import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../src/shared/events.js';
import { buildTimeline } from '../../src/web/timelapse/timeline.js';

const e = (t: number) => ({ t, hero: 'h', kind: 'idle' }) as GameEvent;

describe('buildTimeline', () => {
  it('maps events monotonically from 0 to 92% of the video', () => {
    const tl = buildTimeline([e(1000), e(2000), e(2500), e(4000)], 30_000);
    expect(tl.at[0]).toBe(0);
    expect(tl.at.at(-1)).toBeCloseTo(27_600);
    for (let i = 1; i < tl.at.length; i++) expect(tl.at[i]).toBeGreaterThanOrEqual(tl.at[i - 1]);
    expect(tl.sessionMs).toBe(3000);
  });
  it('squeezes idle gaps to at most 1.5 s of session time', () => {
    const tl = buildTimeline([e(0), e(1000), e(601_000), e(602_000)], 10_000);
    // compressed: 0, 1000, 2500, 3500 → the 10-minute gap is worth 1.5 s, like a short pause
    expect(tl.at[2] - tl.at[1]).toBeCloseTo(((1500 / 3500) * 9200), 0);
    expect(tl.sessionMs).toBe(602_000);
  });
  it('the clock shows real session time, including inside squeezed gaps', () => {
    const tl = buildTimeline([e(0), e(1000), e(601_000)], 10_000);
    expect(tl.clock(0)).toBe(0);
    expect(tl.clock(tl.at[1])).toBeCloseTo(1000);
    expect(tl.clock(tl.at[2])).toBeCloseTo(601_000);
    expect(tl.clock((tl.at[1] + tl.at[2]) / 2)).toBeCloseTo(301_000, -2);
    expect(tl.clock(10_000)).toBe(601_000);
  });
  it('sorts unsorted input and keeps equal timestamps together', () => {
    const tl = buildTimeline([e(3000), e(1000), e(1000)], 10_000);
    expect(tl.events.map((x) => x.t)).toEqual([1000, 1000, 3000]);
    expect(tl.at[0]).toBe(tl.at[1]);
  });
  it('handles empty input and is fast on 50k events', () => {
    const empty = buildTimeline([], 10_000);
    expect(empty.at).toEqual([]);
    expect(empty.clock(5000)).toBe(0);
    const many = Array.from({ length: 50_000 }, (_, i) => e(i * 37));
    const t0 = performance.now();
    buildTimeline(many, 30_000);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
