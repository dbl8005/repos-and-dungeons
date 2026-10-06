import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import ignore, { type Ignore } from 'ignore';

const run = promisify(execFile);

const MEDIA = 'png jpg jpeg gif webp ico bmp tiff mp4 mov avi webm mp3 wav ogg flac zip gz tgz bz2 xz 7z rar pdf woff woff2 ttf otf eot psd'.split(' ');

export const ALWAYS_IGNORE: string[] = [
  'node_modules/', '.git/', 'dist/', 'build/', '.next/', 'coverage/', 'vendor/', '__pycache__/', 'target/', '.venv/',
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'Cargo.lock', 'poetry.lock',
  ...MEDIA.map((ext) => `*.${ext}`),
];

const builtIn = (): Ignore => ignore({ ignorecase: true }).add(ALWAYS_IGNORE);

/** Repo-relative POSIX paths of every file worth a tile, sorted and unique. */
export async function scanRepo(root: string, o: { maxFiles?: number } = {}): Promise<string[]> {
  const files = (await gitFiles(root)) ?? (await walk(root, o.maxFiles ?? 200_000));
  const ig = builtIn();
  return [...new Set(files.filter((f) => f && !ig.ignores(f)))].sort();
}

/** `git ls-files` run from `root` lists paths relative to it, so a sub-folder of a repo works too. */
async function gitFiles(root: string): Promise<string[] | null> {
  try {
    await run('git', ['-C', root, 'rev-parse', '--is-inside-work-tree']);
    const { stdout } = await run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      cwd: root,
      maxBuffer: 256 * 1024 * 1024,
    });
    return stdout.split('\0');
  } catch {
    return null;
  }
}

/** Directory walk for non-git folders, stopping at `maxFiles` (running in `~` must not walk the whole disk). */
async function walk(root: string, maxFiles: number): Promise<string[]> {
  const ig = builtIn();
  try {
    ig.add(await readFile(path.join(root, '.gitignore'), 'utf8'));
  } catch {
    // no .gitignore
  }
  const out: string[] = [];
  const visit = async (rel: string) => {
    const entries = await readdir(path.join(root, rel), { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (out.length >= maxFiles) return;
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!ig.ignores(`${p}/`)) await visit(p);
      } else if (e.isFile() && !ig.ignores(p)) {
        out.push(p);
      }
    }
  };
  await visit('');
  return out;
}
