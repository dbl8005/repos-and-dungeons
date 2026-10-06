import { EventEmitter } from 'node:events';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { HeroId } from '../shared/events.js';
import { DEFAULT_INDEX_FILE, matchRepo, readSessionCwd } from './session-index.js';
import { LineTailer, readLastLines } from './tail.js';

export type LineSource = { hero: HeroId; parent?: HeroId; file: string; aliasRoot?: string };

export type WatcherOptions = {
  projectsDir: string;
  repoRoot: string;
  /** Sessions modified within this window count as running on startup. */
  activeWindowMs?: number;
  initialLines?: number;
  indexFile?: string;
  /** How often running sessions are checked for new lines. */
  pollMs?: number;
  /** How often folders are rescanned for new sessions (and cold sessions re-checked). */
  discoverMs?: number;
  idleAfterMs?: number;
  idleCheckMs?: number;
};

type Tracked = { src: LineSource; tailer: LineTailer; lastActivity: number; emitted: boolean; idleSent: boolean };

/**
 * Finds every Claude Code transcript whose `cwd` is inside the repo and emits its new lines.
 * Polls file sizes instead of using file watchers: a machine can have thousands of transcripts.
 * Emits `'line'` (src: LineSource, line: string) and `'idle'` (hero: HeroId).
 */
export class SessionWatcher extends EventEmitter {
  private o: Required<WatcherOptions>;
  private dirMtimes = new Map<string, number>();
  private rejected = new Set<string>();
  /** Young transcripts without a cwd yet; re-checked each round while they're young. */
  private pending = new Map<string, number>();
  private tracked = new Map<string, Tracked>();
  private timers: NodeJS.Timeout[] = [];
  private busy = { poll: false, discover: false };
  private stopped = false;

  constructor(o: WatcherOptions) {
    super();
    this.o = {
      activeWindowMs: 600_000, initialLines: 200, indexFile: DEFAULT_INDEX_FILE,
      pollMs: 250, discoverMs: 2_000, idleAfterMs: 600_000, idleCheckMs: 60_000, ...o,
    };
  }

  async start(): Promise<void> {
    await this.discover();
    const every = (ms: number, f: () => Promise<void> | void) => this.timers.push(setInterval(() => void f(), ms));
    every(this.o.pollMs, () => this.guarded('poll', () => this.poll(true)));
    every(this.o.discoverMs, () => this.guarded('discover', async () => { await this.discover(); await this.poll(false); }));
    every(this.o.idleCheckMs, () => this.checkIdle());
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  private async guarded(k: 'poll' | 'discover', f: () => Promise<void>) {
    if (this.busy[k] || this.stopped) return;
    this.busy[k] = true;
    try {
      await f();
    } catch (err) {
      this.emit('warn', err);
    } finally {
      this.busy[k] = false;
    }
  }

  private isHot = (t: Tracked) => Date.now() - t.lastActivity < this.o.activeWindowMs;

  private async discover() {
    const dirs = await readdir(this.o.projectsDir, { withFileTypes: true }).catch(() => []);
    for (const d of dirs) if (d.isDirectory()) await this.scanDir(path.join(this.o.projectsDir, d.name), null);
    for (const [file, firstSeen] of [...this.pending]) {
      if (Date.now() - firstSeen > 60_000) this.pending.delete(file); // a stub (e.g. title-only file), not a session
      else await this.consider(file);
    }
    for (const t of [...this.tracked.values()]) {
      if (t.src.parent || !this.isHot(t)) continue;
      await this.scanDir(path.join(path.dirname(t.src.file), t.src.hero, 'subagents'), t.src.hero, t.src.aliasRoot);
    }
  }

  /** `parent` set means this is a session's subagents folder. */
  private async scanDir(dir: string, parent: HeroId | null, aliasRoot?: string) {
    const st = await stat(dir).catch(() => null);
    if (!st || this.dirMtimes.get(dir) === st.mtimeMs) return;
    this.dirMtimes.set(dir, st.mtimeMs);
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      if (!name.endsWith('.jsonl')) continue;
      const file = path.join(dir, name);
      if (this.tracked.has(file) || this.rejected.has(file) || this.pending.has(file)) continue;
      if (parent) {
        if (name.startsWith('agent-')) await this.track(file, { hero: `${parent}/${name.slice(6, -6)}`, parent, file, ...(aliasRoot ? { aliasRoot } : {}) });
        continue;
      }
      await this.consider(file);
    }
  }

  private async consider(file: string) {
    const cwd = await readSessionCwd(file, this.o.indexFile);
    if (cwd === null) {
      if (!this.pending.has(file)) {
        const st = await stat(file).catch(() => null);
        if (st && Date.now() - st.mtimeMs < 60_000) this.pending.set(file, Date.now());
      }
      return;
    }
    this.pending.delete(file);
    const m = await matchRepo(cwd, this.o.repoRoot);
    if (!m) this.rejected.add(file);
    else await this.track(file, { hero: path.basename(file, '.jsonl'), file, ...m });
  }

  private async track(file: string, src: LineSource) {
    const st = await stat(file).catch(() => null);
    if (!st) return;
    const t: Tracked = { src, tailer: new LineTailer(file, st.size), lastActivity: st.mtimeMs, emitted: false, idleSent: false };
    this.tracked.set(file, t);
    if (this.isHot(t)) {
      const { lines, endOffset } = await readLastLines(file, this.o.initialLines);
      t.tailer = new LineTailer(file, endOffset);
      this.deliver(t, lines);
    }
  }

  private async poll(hot: boolean) {
    for (const t of this.tracked.values()) {
      if (this.isHot(t) !== hot) continue;
      const lines = await t.tailer.readNew().catch(() => []);
      if (lines.length) {
        t.lastActivity = Date.now();
        t.idleSent = false;
        this.deliver(t, lines);
      }
    }
  }

  private deliver(t: Tracked, lines: string[]) {
    if (!lines.length || this.stopped) return;
    t.emitted = true;
    for (const l of lines) this.emit('line', t.src, l);
  }

  private checkIdle() {
    const now = Date.now();
    for (const t of this.tracked.values()) {
      if (t.emitted && !t.idleSent && now - t.lastActivity > this.o.idleAfterMs) {
        t.idleSent = true;
        this.emit('idle', t.src.hero);
      }
    }
  }
}
