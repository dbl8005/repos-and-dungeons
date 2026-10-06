import type { GameEvent, HeroId } from '../shared/events.js';
import type { DungeonMap, PathIndex } from '../shared/map-types.js';
import type { ServerMessage } from '../shared/protocol.js';
import { createParser, type TranscriptParser } from './parser/transcript-parser.js';
import type { LineSource } from './watcher.js';

export type HubOptions = {
  repoRoot: string;
  map: DungeonMap;
  index: PathIndex;
  flushMs?: number;
  /** A hero leaves this long after its last transcript line. */
  leaveAfterMs?: number;
  leaveCheckMs?: number;
  /** History kept for late-joining browsers; older events are dropped, except hero joins. */
  maxHistory?: number;
  now?: () => number;
};

/** Owns one parser per hero, the full event history (for late-joining browsers), and batched broadcasting. */
export class Hub {
  private map: DungeonMap;
  private index: PathIndex;
  private parsers = new Map<HeroId, TranscriptParser>();
  private lastSeen = new Map<HeroId, number>();
  private events: GameEvent[] = [];
  private pending: GameEvent[] = [];
  private subs = new Set<(m: ServerMessage) => void>();
  private batchSubs = new Set<(events: GameEvent[]) => void>();
  private flushTimer: NodeJS.Timeout | null = null;
  private leaveTimer: NodeJS.Timeout;
  private flushMs: number;
  private leaveAfterMs: number;
  private now: () => number;

  constructor(private o: HubOptions) {
    this.map = o.map;
    this.index = o.index;
    this.flushMs = o.flushMs ?? 100;
    this.leaveAfterMs = o.leaveAfterMs ?? 30 * 60_000;
    this.now = o.now ?? Date.now;
    this.leaveTimer = setInterval(() => this.checkLeft(), o.leaveCheckMs ?? 60_000);
    this.leaveTimer.unref();
  }

  ingest(src: LineSource, line: string): void {
    let p = this.parsers.get(src.hero);
    if (!p) {
      p = createParser({ repoRoot: this.o.repoRoot, aliasRoots: src.aliasRoot ? [src.aliasRoot] : [], hero: src.hero, parent: src.parent, now: this.now, isKnownPath: (x) => x in this.index });
      this.parsers.set(src.hero, p);
    }
    this.lastSeen.set(src.hero, this.now());
    this.push(p.feed(line));
  }

  onIdle(hero: HeroId): void {
    if (this.parsers.has(hero)) this.push([{ t: this.now(), hero, kind: 'idle' }]);
  }

  /** Events from outside the transcripts (narrator speech, stamina). */
  publish(events: GameEvent[]): void {
    this.push(events);
  }

  snapshot(): { map: DungeonMap; index: PathIndex; events: GameEvent[] } {
    return { map: this.map, index: this.index, events: trimHistory([...this.events, ...this.pending], this.o.maxHistory ?? 100_000) };
  }

  subscribe(fn: (m: ServerMessage) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  /** Every flushed batch, for server-side observers like the narrator. */
  onBatch(fn: (events: GameEvent[]) => void): () => void {
    this.batchSubs.add(fn);
    return () => this.batchSubs.delete(fn);
  }

  updateMap(map: DungeonMap, index: PathIndex): void {
    this.flush();
    this.map = map;
    this.index = index;
    this.broadcast({ type: 'map', map, index });
  }

  close(): void {
    clearInterval(this.leaveTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
  }

  private push(evs: GameEvent[]) {
    if (!evs.length) return;
    this.pending.push(...evs);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), this.flushMs);
  }

  private flush() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (!this.pending.length) return;
    const batch = this.pending;
    this.pending = [];
    this.events = trimHistory([...this.events, ...batch], this.o.maxHistory ?? 100_000);
    this.broadcast({ type: 'events', events: batch });
    for (const fn of this.batchSubs) fn(batch);
  }

  private broadcast(m: ServerMessage) {
    for (const fn of this.subs) fn(m);
  }

  private checkLeft() {
    const now = this.now();
    for (const [hero, t] of this.lastSeen) {
      if (now - t < this.leaveAfterMs) continue;
      this.lastSeen.delete(hero);
      this.parsers.delete(hero);
      this.push([{ t: now, hero, kind: 'hero_left' }]);
    }
  }
}

/** Keeps the newest `max` events plus the latest join of every hero whose join fell off. */
export function trimHistory(events: GameEvent[], max: number): GameEvent[] {
  if (events.length <= max) return events;
  const cut = events.length - max;
  const joins = new Map<HeroId, GameEvent>();
  for (const e of events.slice(0, cut)) if (e.kind === 'hero_joined') joins.set(e.hero, e);
  return [...joins.values(), ...events.slice(cut)];
}
