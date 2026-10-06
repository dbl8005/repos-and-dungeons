import type { HeroClass } from '../../shared/events.js';

export function modelToClass(model: string): HeroClass {
  const m = model.toLowerCase();
  if (m.includes('opus')) return 'knight';
  if (m.includes('sonnet')) return 'squire';
  if (m.includes('haiku')) return 'scout';
  if (m.includes('fable')) return 'wizard';
  return 'adventurer';
}

/** 200k by default; once a session goes past that it must be on a 1M-context model. */
export function contextLimit(_model: string, used: number): number {
  return used > 200_000 ? 1_000_000 : 200_000;
}
