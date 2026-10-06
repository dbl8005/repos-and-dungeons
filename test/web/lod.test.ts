import { describe, expect, it } from 'vitest';
import { lodFor, visibleChunks } from '../../src/web/world/lod.js';

describe('lodFor', () => {
  it('maps zoom to level of detail', () => {
    expect(lodFor(3)).toBe('close');
    expect(lodFor(1.5)).toBe('close');
    expect(lodFor(1.49)).toBe('mid');
    expect(lodFor(0.5)).toBe('mid');
    expect(lodFor(0.49)).toBe('far');
  });
});

describe('visibleChunks', () => {
  const C = 512; // 32 tiles × 16 px
  it('one chunk when the view is inside it', () => {
    expect(visibleChunks({ x: 10, y: 10, w: 100, h: 100 }, C, 4, 4)).toEqual([0]);
  });
  it('2×2 chunks when the view spans a corner', () => {
    expect(visibleChunks({ x: 500, y: 500, w: 100, h: 100 }, C, 4, 4).sort((a, b) => a - b)).toEqual([0, 1, 4, 5]);
  });
  it('clamps to the map and never returns negative indices', () => {
    expect(visibleChunks({ x: -1000, y: -1000, w: 600, h: 600 }, C, 4, 4)).toEqual([]);
    expect(visibleChunks({ x: -100, y: -100, w: 200, h: 200 }, C, 4, 4)).toEqual([0]);
    expect(visibleChunks({ x: 1900, y: 1900, w: 5000, h: 5000 }, C, 4, 4)).toEqual([15]);
  });
});
