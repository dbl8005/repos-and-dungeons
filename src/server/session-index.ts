import { mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export const DEFAULT_INDEX_FILE = path.join(homedir(), '.repos-and-dungeons', 'index.json');
const CHUNK = 64 * 1024;
const MAX_SCAN = 2 * 1024 * 1024;

/** path → cwd, or the file size at which no cwd was found (re-read only once the file changes). */
type Entry = string | number;
const caches = new Map<string, Map<string, Entry>>();
const pendingWrites = new Map<string, NodeJS.Timeout>();
let reads = 0;

/** Number of transcript heads opened so far (for tests and diagnostics). */
export const cwdReadCount = () => reads;

async function cacheFor(indexFile: string): Promise<Map<string, Entry>> {
  let c = caches.get(indexFile);
  if (!c) {
    c = new Map();
    try {
      for (const [k, v] of Object.entries(JSON.parse(await readFile(indexFile, 'utf8')) as Record<string, Entry>)) c.set(k, v);
    } catch {
      // first run or unreadable: start empty
    }
    caches.set(indexFile, c);
  }
  return c;
}

function persistSoon(indexFile: string, c: Map<string, Entry>) {
  if (pendingWrites.has(indexFile)) return;
  const t = setTimeout(async () => {
    pendingWrites.delete(indexFile);
    await mkdir(path.dirname(indexFile), { recursive: true }).catch(() => {});
    await writeFile(indexFile, JSON.stringify(Object.fromEntries(c))).catch(() => {});
  }, 500);
  t.unref();
  pendingWrites.set(indexFile, t);
}

const CWD_RE = /"cwd":("(?:[^"\\]|\\.)*")/;

/**
 * The session's working directory: the first `"cwd"` within the first 2 MB (big snapshot lines can come first).
 * Found values are cached forever; "no cwd" is cached until the file size changes.
 */
export async function readSessionCwd(file: string, indexFile = DEFAULT_INDEX_FILE): Promise<string | null> {
  const c = await cacheFor(indexFile);
  const hit = c.get(file);
  if (typeof hit === 'string') return hit;
  let fh;
  try {
    fh = await open(file, 'r');
  } catch {
    return null;
  }
  try {
    const { size } = await fh.stat();
    if (hit === size) return null;
    reads++;
    let text = '';
    for (let pos = 0; pos < Math.min(size, MAX_SCAN); pos += CHUNK) {
      const b = Buffer.alloc(Math.min(CHUNK, size - pos));
      const { bytesRead } = await fh.read(b, 0, b.length, pos);
      text += b.subarray(0, bytesRead).toString('utf8');
      const m = text.match(CWD_RE);
      if (m) {
        try {
          const cwd = JSON.parse(m[1]) as string;
          c.set(file, cwd);
          persistSoon(indexFile, c);
          return cwd;
        } catch {
          break;
        }
      }
    }
    c.set(file, size);
    persistSoon(indexFile, c);
    return null;
  } finally {
    await fh.close();
  }
}

export function isInsideRepo(cwd: string, repoRoot: string): boolean {
  const rel = path.relative(path.resolve(repoRoot), path.resolve(cwd));
  return rel === '' || (!(rel === '..' || rel.startsWith('..' + path.sep)) && !path.isAbsolute(rel));
}

const realCache = new Map<string, string | null>();

/**
 * Whether `cwd` is inside the repo, directly or through a symlink. Returns the root spelled the way the session
 * sees it (`aliasRoot`) when that differs from `repoRoot`, or null when the session is elsewhere.
 */
export async function matchRepo(cwd: string, repoRoot: string): Promise<{ aliasRoot?: string } | null> {
  if (isInsideRepo(cwd, repoRoot)) return {};
  let real = realCache.get(cwd);
  if (real === undefined) {
    real = await realpath(cwd).catch(() => null);
    realCache.set(cwd, real);
  }
  if (!real || !isInsideRepo(real, repoRoot)) return null;
  const rel = path.relative(repoRoot, real);
  const up = rel ? rel.split(path.sep).map(() => '..') : [];
  return { aliasRoot: path.resolve(cwd, ...up) };
}
