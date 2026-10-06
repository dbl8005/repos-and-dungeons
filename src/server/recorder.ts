import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import path from 'node:path';
import type { GameEvent } from '../shared/events.js';
import type { DungeonMap, PathIndex } from '../shared/map-types.js';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Appends the session to `<dir>/<repo>-<YYYYMMDD-HHmmss>.jsonl`: map lines (start + each rescan) and event lines.
 * The file is only created once there is a first event.
 */
export class Recorder {
  file: string | null = null;
  private out: WriteStream | null = null;
  private pendingMap: { map: DungeonMap; index: PathIndex } | null = null;
  /** Set when the recordings folder can't be written; recording stays off (the dungeon keeps running). */
  private disabled = false;

  constructor(private o: { dir: string; repoName: string; now?: () => Date }) {}

  map(map: DungeonMap, index: PathIndex): void {
    if (this.out) this.write({ type: 'map', map, index });
    else this.pendingMap = { map, index };
  }

  events(events: GameEvent[]): void {
    if (!events.length || this.disabled) return;
    if (!this.out) this.open();
    if (!this.out) return;
    for (const event of events) this.write({ type: 'event', event });
  }

  close(): Promise<void> {
    return new Promise((resolve) => (this.out ? this.out.end(resolve) : resolve()));
  }

  private open() {
    const d = (this.o.now ?? (() => new Date()))();
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const safe = this.o.repoName.replace(/[^\w.-]/g, '_') || 'repo';
    const file = path.join(this.o.dir, `${safe}-${stamp}.jsonl`);
    try {
      mkdirSync(this.o.dir, { recursive: true, mode: 0o700 }); // transcripts can hold secrets: private by default
      this.out = createWriteStream(file, { flags: 'a', mode: 0o600 });
    } catch (err) {
      this.disable(err);
      return;
    }
    this.file = file;
    this.out.on('error', (err) => this.disable(err));
    if (this.pendingMap) this.write({ type: 'map', ...this.pendingMap });
    this.pendingMap = null;
  }

  private disable(err: unknown) {
    if (this.disabled) return;
    this.disabled = true;
    this.out = null;
    process.stderr.write(`repos-and-dungeons: recording turned off (${err instanceof Error ? err.message : String(err)})\n`);
  }

  private write(obj: object) {
    this.out?.write(JSON.stringify(obj) + '\n');
  }
}
