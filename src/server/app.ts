import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fnv1a32 } from '../shared/hash.js';
import { startHttp } from './http.js';
import { Hub } from './hub.js';
import { Narrator } from './narrator/narrator.js';
import { Recorder } from './recorder.js';
import { generateMap } from './map/generate.js';
import { scanRepo } from './scanner.js';
import { SessionWatcher } from './watcher.js';

export type DungeonOptions = {
  repo: string;
  port?: number;
  projectsDir?: string;
  webDir: string;
  indexFile?: string;
  rescanMs?: number;
  /** Haiku speech lines (canned lines play either way). Default true. */
  narrator?: boolean;
  narratorRun?: (prompt: string) => Promise<string>;
  /** Where session recordings go (default ~/.repos-and-dungeons/recordings). */
  recordingsDir?: string;
  watcher?: Partial<ConstructorParameters<typeof SessionWatcher>[0]>;
};

export type Dungeon = { url: string; repoRoot: string; close(): Promise<void> };

/** The repo root: the enclosing git top-level if there is one, else the folder itself. */
export async function resolveRepoRoot(dir: string): Promise<string> {
  const abs = await realpath(path.resolve(dir));
  try {
    const { stdout } = await promisify(execFile)('git', ['-C', abs, 'rev-parse', '--show-toplevel']);
    return await realpath(stdout.trim());
  } catch {
    return abs;
  }
}

export async function startDungeon(o: DungeonOptions): Promise<Dungeon> {
  const repoRoot = await resolveRepoRoot(o.repo);
  let paths = await scanRepo(repoRoot);
  let fingerprint = fnv1a32(paths.join('\n'));
  const { map, index } = generateMap(paths);
  const hub = new Hub({ repoRoot, map, index });
  const narrator = new Narrator({ publish: (e) => hub.publish(e), enabled: o.narrator ?? true, ...(o.narratorRun ? { run: o.narratorRun } : {}) });
  hub.onBatch((events) => narrator.observe(events));
  const recorder = new Recorder({ dir: o.recordingsDir ?? path.join(homedir(), '.repos-and-dungeons', 'recordings'), repoName: path.basename(repoRoot) });
  recorder.map(map, index);
  hub.onBatch((events) => recorder.events(events));

  const watcher = new SessionWatcher({
    projectsDir: o.projectsDir ?? path.join(homedir(), '.claude', 'projects'),
    repoRoot,
    ...(o.indexFile ? { indexFile: o.indexFile } : {}),
    ...o.watcher,
  });
  watcher.on('line', (src, line) => hub.ingest(src, line));
  watcher.on('idle', (hero) => hub.onIdle(hero));
  await watcher.start();

  const rescan = setInterval(async () => {
    const next = await scanRepo(repoRoot).catch(() => null);
    if (!next) return;
    const fp = fnv1a32(next.join('\n'));
    if (fp === fingerprint) return;
    paths = next;
    fingerprint = fp;
    const m = generateMap(paths);
    hub.updateMap(m.map, m.index);
    recorder.map(m.map, m.index);
  }, o.rescanMs ?? 30_000);
  rescan.unref();

  const key = randomBytes(16).toString('hex');
  const http = await startHttp({ host: '127.0.0.1', port: o.port ?? 0, key, webDir: o.webDir, hub });

  return {
    url: http.url,
    repoRoot,
    async close() {
      clearInterval(rescan);
      narrator.close();
      await recorder.close();
      await watcher.stop();
      hub.close();
      await http.close();
    },
  };
}
