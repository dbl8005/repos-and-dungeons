import type { HeroId } from '../../shared/events.js';

/** Bubble pacing: one line per hero per `perHeroMs`, one narrator (Haiku) line per hero per `narratorMs`. */
export class SpeechLimiter {
  private lastSpoke = new Map<HeroId, number>();
  private lastNarrated = new Map<HeroId, number>();

  constructor(private o: { perHeroMs: number; narratorMs: number }) {}

  canSpeak(hero: HeroId, now: number): boolean {
    const t = this.lastSpoke.get(hero);
    return t === undefined || now - t >= this.o.perHeroMs;
  }

  canNarrate(hero: HeroId, now: number): boolean {
    const t = this.lastNarrated.get(hero);
    return t === undefined || now - t >= this.o.narratorMs;
  }

  spoke(hero: HeroId, now: number, narrated: boolean): void {
    this.lastSpoke.set(hero, now);
    if (narrated) this.lastNarrated.set(hero, now);
  }
}
