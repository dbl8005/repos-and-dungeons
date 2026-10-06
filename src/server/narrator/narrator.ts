import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { GameEvent, HeroClass, HeroId } from '../../shared/events.js';
import { fnv1a32 } from '../../shared/hash.js';
import { cannedLine, type CannedKind } from './lines.js';
import { SpeechLimiter } from './limiter.js';
import { sanitizeLine } from './sanitize.js';
import { summarize } from './summary.js';

const FRESH_MS = 30_000;
const MAX_IN_FLIGHT = 2;
const FAILS_BEFORE_BACKOFF = 3;
const BACKOFF_MS = 60_000;
const CLASS_NAME: Record<HeroClass, string> = { knight: 'a knight', squire: 'a squire', scout: 'a nimble scout', wizard: 'a wizard', adventurer: 'an adventurer' };

export const NARRATOR_SYSTEM_PROMPT =
  'You voice a character in a D&D adventuring party exploring a dungeon that is a software repository. ' +
  'Reply with exactly one short line of in-character dialogue, under 14 words, medieval adventurer voice, light humor. ' +
  'No emojis, no quotes, no file paths, no explanations.';

/** Runs Haiku headless with no tools, settings, MCP servers or saved session, from a temp dir (outside any repo). */
export function runClaude(prompt: string): Promise<string> {
  const args = ['-p', '--model', 'haiku', '--setting-sources', '', '--no-session-persistence', '--tools', '', '--strict-mcp-config', '--system-prompt', NARRATOR_SYSTEM_PROMPT, prompt];
  return new Promise((resolve, reject) => {
    execFile('claude', args, { cwd: tmpdir(), timeout: 20_000, maxBuffer: 64 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

export type NarratorOptions = {
  publish: (events: GameEvent[]) => void;
  enabled: boolean;
  run?: (prompt: string) => Promise<string>;
  now?: () => number;
};

/** Gives heroes a voice: instant canned lines for big moments, Haiku lines for ongoing activity. */
export class Narrator {
  private limiter = new SpeechLimiter({ perHeroMs: 6_000, narratorMs: 15_000 });
  private classes = new Map<HeroId, HeroClass>();
  private recent = new Map<HeroId, GameEvent[]>();
  private failing = new Map<string, number>();
  private greeted = new Set<HeroId>();
  private inFlight = 0;
  private failStreak = 0;
  private backoffUntil = 0;
  private closed = false;
  private now: () => number;
  private run: (prompt: string) => Promise<string>;

  constructor(private o: NarratorOptions) {
    this.now = o.now ?? Date.now;
    this.run = o.run ?? runClaude;
  }

  observe(events: GameEvent[]): void {
    const now = this.now();
    for (const e of events) {
      if (e.kind === 'speech' || e.hero.startsWith('monster:')) continue;
      if (e.kind === 'hero_joined') this.classes.set(e.hero, e.heroClass);
      if (now - e.t > FRESH_MS) continue; // history replayed on startup stays quiet
      const cls = this.classes.get(e.hero) ?? 'adventurer';
      if (e.kind === 'hero_joined' && !this.greeted.has(e.hero)) {
        this.greeted.add(e.hero);
        this.canned(e.hero, 'joined', cls, now);
      } else if (e.kind === 'test_result') {
        const key = `${e.hero}:${e.runner}`;
        const before = this.failing.get(key) ?? 0;
        this.failing.set(key, e.failed.length);
        if (e.failed.length && !before) {
          this.canned(e.hero, 'monster_spawn', cls, now, true);
          this.say(`monster:${e.hero}`, cannedLine('taunt', 'adventurer', fnv1a32(`${e.hero}${e.t}`)), now);
        } else if (!e.failed.length && before) {
          this.canned(e.hero, 'monster_slain', cls, now, true);
        }
      } else if (e.kind === 'compacted') {
        this.canned(e.hero, 'compacted', cls, now, true);
      }
      const list = this.recent.get(e.hero) ?? [];
      list.push(e);
      this.recent.set(e.hero, list.slice(-12));
    }
    this.narrate(now);
  }

  close(): void {
    this.closed = true;
  }

  private narrate(now: number) {
    if (!this.o.enabled || now < this.backoffUntil) return this.cannedActivity(now);
    for (const [hero, list] of this.recent) {
      if (this.inFlight >= MAX_IN_FLIGHT) return;
      if (!this.limiter.canNarrate(hero, now) || !this.limiter.canSpeak(hero, now)) continue;
      const cls = this.classes.get(hero) ?? 'adventurer';
      const summary = summarize(cls, list);
      if (!summary) continue;
      this.recent.set(hero, []);
      this.limiter.spoke(hero, now, true);
      this.inFlight++;
      const prompt = `You are ${CLASS_NAME[cls]}. Just now you ${summary}. Say your line.`;
      const fallback: CannedKind = list.some((e) => e.kind === 'forge') ? 'forge' : 'read';
      this.run(prompt)
        .then((raw) => {
          this.failStreak = 0;
          this.say(hero, sanitizeLine(raw) ?? cannedLine(fallback, cls, now), this.now());
        })
        .catch(() => {
          if (++this.failStreak >= FAILS_BEFORE_BACKOFF) this.backoffUntil = this.now() + BACKOFF_MS;
          this.say(hero, cannedLine(fallback, cls, now), this.now());
        })
        .finally(() => this.inFlight--);
    }
  }

  /** Haiku off or backing off: same pacing, built-in lines instead. */
  private cannedActivity(now: number) {
    for (const [hero, list] of this.recent) {
      if (!this.limiter.canNarrate(hero, now) || !this.limiter.canSpeak(hero, now)) continue;
      const cls = this.classes.get(hero) ?? 'adventurer';
      const kind: CannedKind | null = list.some((e) => e.kind === 'forge') ? 'forge' : list.some((e) => e.kind === 'move') ? 'read' : list.some((e) => e.kind === 'idle') ? 'idle' : null;
      if (!kind) continue;
      this.recent.set(hero, []);
      this.limiter.spoke(hero, now, true);
      this.say(hero, cannedLine(kind, cls, fnv1a32(`${hero}:${now}`)), now);
    }
  }

  private canned(hero: HeroId, kind: CannedKind, cls: HeroClass, now: number, important = false) {
    if (!important && !this.limiter.canSpeak(hero, now)) return;
    this.limiter.spoke(hero, now, false);
    this.say(hero, cannedLine(kind, cls, fnv1a32(`${hero}:${kind}:${now}`)), now);
  }

  private say(hero: HeroId, text: string, t: number) {
    if (!this.closed) this.o.publish([{ t, hero, kind: 'speech', text }]);
  }
}
