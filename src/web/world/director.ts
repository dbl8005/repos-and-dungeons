import type { EventKind, HeroId } from '../../shared/events.js';

const NOTABLE = new Set<EventKind>(['test_result', 'forge', 'hero_joined', 'door_locked']);

/** Picks the hero the camera follows: sticky, switches only for something notable after the current one goes quiet. */
export class Director {
  private last = new Map<HeroId, number>();
  private current: HeroId | null = null;
  private locked: HeroId | null = null;
  private lastSwitch = -Infinity;
  private quietMs: number;

  constructor(o: { quietMs?: number } = {}) {
    this.quietMs = o.quietMs ?? 5_000;
  }

  activity(hero: HeroId, t: number): void {
    this.last.set(hero, t);
    if (this.current === null) this.current = hero;
  }

  notable(hero: HeroId, kind: EventKind, t: number): void {
    const currentLast = this.current === null ? -Infinity : this.last.get(this.current) ?? -Infinity;
    this.activity(hero, t);
    if (hero === this.current || !NOTABLE.has(kind)) return;
    if (t - currentLast >= this.quietMs && t - this.lastSwitch >= this.quietMs) {
      this.current = hero;
      this.lastSwitch = t;
    }
  }

  lock(hero: HeroId | null): void {
    this.locked = hero;
    if (hero === null) {
      const newest = [...this.last.entries()].sort((a, b) => b[1] - a[1])[0];
      if (newest) this.current = newest[0];
    }
  }

  get lockedHero(): HeroId | null {
    return this.locked;
  }

  target(heroes: HeroId[], _t: number): HeroId | null {
    if (this.locked && heroes.includes(this.locked)) return this.locked;
    this.locked = null;
    if (this.current && heroes.includes(this.current)) return this.current;
    const best = heroes.slice().sort((a, b) => (this.last.get(b) ?? -Infinity) - (this.last.get(a) ?? -Infinity))[0] ?? null;
    this.current = best;
    return best;
  }
}
