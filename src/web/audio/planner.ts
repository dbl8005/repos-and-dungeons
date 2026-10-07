import type { GameEvent, HeroId } from '../../shared/events.js';
import { fnv1a32 } from '../../shared/hash.js';
import type { Monster } from '../../shared/reducer.js';

export type CueName = 'step' | 'page' | 'whoosh' | 'anvil' | 'sparkle' | 'shimmer' | 'squelch' | 'hit' | 'coins' | 'chains' | 'creak' | 'horn' | 'blip' | 'wind' | 'victory';
export type SoundCue = { name: CueName; pitch?: number };
/** Monster lists from before and after the batch was applied (the reducer replaces monsters, never mutates them). */
export type PlanContext = { followed: HeroId | null; now: number; monstersBefore: Monster[]; monstersAfter: Monster[] };

/** Whether some monster lost hp (or died), and whether some monster died. */
function damage(before: Monster[], after: Monster[]): { hit: boolean; died: boolean } {
  const now = new Map(after.map((m) => [m.id, m.hp]));
  return { hit: before.some((m) => (now.get(m.id) ?? 0) < m.hp), died: before.some((m) => !now.has(m.id)) };
}

/** Which sounds a batch of events makes (spec §11). Pure; the engine plays them. */
export function planSounds(events: GameEvent[], ctx: PlanContext): SoundCue[] {
  const cues: SoundCue[] = [];
  let { hit, died } = damage(ctx.monstersBefore, ctx.monstersAfter);
  for (const e of events) {
    switch (e.kind) {
      case 'move':
        if (e.hero === ctx.followed) cues.push({ name: 'step' });
        cues.push({ name: 'page' });
        break;
      case 'scout': cues.push({ name: 'whoosh' }); break;
      case 'forge':
        cues.push({ name: 'anvil' });
        if (e.created) cues.push({ name: 'sparkle' });
        break;
      case 'cast': cues.push({ name: 'shimmer' }); break;
      case 'test_result':
        if (e.failed.length) cues.push({ name: 'squelch' });
        if (hit) cues.push({ name: 'hit' });
        hit = false;
        if (!e.failed.length && died) cues.push({ name: 'coins' });
        if (!e.failed.length) died = false;
        break;
      case 'door_locked': cues.push({ name: 'chains' }); break;
      case 'door_opened': cues.push({ name: 'creak' }); break;
      case 'hero_joined': cues.push({ name: 'horn' }); break;
      case 'compacted': cues.push({ name: 'wind' }); break;
      case 'speech': cues.push({ name: 'blip', pitch: 0.8 + (fnv1a32(e.hero) % 50) / 100 }); break;
    }
  }
  if (ctx.monstersBefore.length > 0 && ctx.monstersAfter.length === 0) cues.push({ name: 'victory' });
  return cues;
}

/** Keeps effects pleasant: at most 4 per second, and the same sound within 300 ms plays once. */
export class CueLimiter {
  private recent: number[] = [];
  private lastByName = new Map<CueName, number>();

  allow(cue: SoundCue, now: number): boolean {
    const last = this.lastByName.get(cue.name);
    if (last !== undefined && now - last < 300) return false;
    this.recent = this.recent.filter((t) => now - t < 1000);
    if (this.recent.length >= 4) return false;
    this.recent.push(now);
    this.lastByName.set(cue.name, now);
    return true;
  }
}

/** Music layer levels: the combat layer is full while monsters live and fades out over 4 s after the last dies. */
export function musicState(monsters: number, lastMonsterDiedAt: number | null, now: number): { explore: 1; combat: number } {
  if (monsters > 0) return { explore: 1, combat: 1 };
  if (lastMonsterDiedAt === null) return { explore: 1, combat: 0 };
  return { explore: 1, combat: Math.max(0, 1 - (now - lastMonsterDiedAt) / 4000) };
}
