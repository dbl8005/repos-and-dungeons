import { describe, expect, it } from 'vitest';
import { catchUpBeat } from '../../src/web/audio/music-clock.js';
import { SoundToggle } from '../../src/web/audio/toggle-state.js';

describe('catchUpBeat', () => {
  it('skips missed beats instead of playing them all at once', () => {
    expect(catchUpBeat(10, 10.02)).toBe(10);
    expect(catchUpBeat(10, 25)).toBeCloseTo(25.05);
  });
});

describe('SoundToggle', () => {
  it('a saved "on" waits for the first click', () => {
    const t = new SoundToggle(true);
    expect(t.enabled).toBe(false);
    expect(t.firstClick()).toBe(true);
    expect(t.enabled).toBe(true);
  });
  it('toggling before that click cancels the pending resume', () => {
    const t = new SoundToggle(true);
    t.toggle();
    t.toggle();
    expect(t.enabled).toBe(false);
    expect(t.firstClick()).toBe(false);
    expect(t.enabled).toBe(false);
  });
  it('defaults to off with nothing pending', () => {
    const t = new SoundToggle(false);
    expect(t.firstClick()).toBe(false);
    expect(t.enabled).toBe(false);
  });
});
