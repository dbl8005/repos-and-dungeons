import { describe, expect, it } from 'vitest';
import { generateMap } from '../../src/server/map/generate.js';
import { fakeRepo } from './map-helpers.js';

// Shared CI runners are slower than a dev machine; keep the budgets meaningful there with a fixed allowance.
const SLACK = process.env.CI ? 3 : 1;
const best = (f: () => void) => Math.min(...[0, 1].map(() => { const t = performance.now(); f(); return performance.now() - t; }));

describe('map performance budgets (spec §5.8)', () => {
  it.each([
    [1_000, 100, 200],
    [10_000, 1_000, 600],
    [100_000, 8_000, 2_000],
  ])('%i files (%i folders) in < %i ms', (files, folders, ms) => {
    const p = fakeRepo(files, folders);
    expect(best(() => generateMap(p))).toBeLessThan(ms * SLACK);
  });
});
