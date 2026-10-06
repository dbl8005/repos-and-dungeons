import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanRepo } from '../../src/server/scanner.js';

function makeTree(withGit: boolean): string {
  const root = mkdtempSync(path.join(tmpdir(), 'rd-scan-'));
  const files: Record<string, string> = {
    'a.ts': 'x', 'node_modules/x.js': 'x', 'dist/y.js': 'x', '.gitignore': 'secret.txt\n', 'secret.txt': 's',
    'img.png': 'p', 'dir with space/ü.ts': 'u', 'package-lock.json': '{}', 'src/deep/b.py': 'b',
  };
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    writeFileSync(path.join(root, p), c);
  }
  if (withGit) {
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', 'a.ts'], { cwd: root }); // the rest stay untracked
  }
  return root;
}

const expected = ['.gitignore', 'a.ts', 'dir with space/ü.ts', 'src/deep/b.py'];

describe('scanRepo', () => {
  it('git repo: tracked + untracked, respects .gitignore and the built-in ignore list', async () => {
    expect(await scanRepo(makeTree(true))).toEqual(expected);
  });
  it('plain directory: same result via the walker', async () => {
    expect(await scanRepo(makeTree(false))).toEqual(expected);
  });
  it('caps the plain-directory walk', async () => {
    expect((await scanRepo(makeTree(false), { maxFiles: 2 })).length).toBeLessThanOrEqual(2);
  });
  it('empty directory', async () => {
    expect(await scanRepo(mkdtempSync(path.join(tmpdir(), 'rd-empty-')))).toEqual([]);
  });
});
