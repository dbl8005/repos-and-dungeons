/** Which creature a failing check becomes. Derived from the runner name only, so it replays identically. */
export type Species = 'slime' | 'goblin' | 'bat' | 'ogre';

/** Check categories (typecheck/lint/build); test runners and anything else are slimes. Events may override via `species`. */
const BY_RUNNER: Record<string, Species> = { typecheck: 'goblin', lint: 'bat', build: 'ogre' };

export function speciesFor(runner: string): Species {
  return BY_RUNNER[runner] ?? 'slime';
}

/** A monster with this many failures in one file is a boss. */
export const BOSS_HP = 5;

export function isBoss(m: { hp: number }): boolean {
  return m.hp >= BOSS_HP;
}
