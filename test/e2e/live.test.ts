import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDungeon, type Dungeon } from '../../src/server/app.js';

const skip = process.env.CI_NO_BROWSER === '1';

describe.skipIf(skip)('live dungeon in the browser', () => {
  let browser: Browser;
  let d: Dungeon;
  let transcript: string;
  let repo: string;

  beforeAll(async () => {
    execFileSync('npx', ['vite', 'build', '--logLevel', 'error'], { stdio: 'inherit' });
    const root = mkdtempSync(path.join(tmpdir(), 'rd-e2e-'));
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'rd-repo-')));
    mkdirSync(path.join(repo, 'src'));
    writeFileSync(path.join(repo, 'src', 'a.ts'), 'a');
    writeFileSync(path.join(repo, 'src', 'b.ts'), 'b');
    const projects = path.join(root, 'projects', 'p');
    mkdirSync(projects, { recursive: true });
    transcript = path.join(projects, 'sess1.jsonl');
    writeFileSync(transcript, JSON.stringify({ type: 'user', cwd: repo, message: { content: 'hi' } }) + '\n');
    d = await startDungeon({
      repo,
      webDir: path.resolve('dist/web'),
      projectsDir: path.join(root, 'projects'),
      indexFile: path.join(root, 'index.json'), recordingsDir: path.join(root, 'recordings'),
      watcher: { pollMs: 50, discoverMs: 100 },
    });
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await d?.close();
  });

  it('shows a Read from a live transcript within 3 seconds', async () => {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(d.url);
    await page.waitForSelector('canvas');
    appendFileSync(transcript, JSON.stringify({
      type: 'assistant', cwd: repo, timestamp: new Date().toISOString(),
      message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: path.join(repo, 'src', 'a.ts') } }] },
    }) + '\n');
    await expect.poll(() => page.locator('#log').innerText(), { timeout: 3000 }).toContain('read src/a.ts');
    await expect.poll(() => page.locator('#party').innerText(), { timeout: 3000 }).toContain('knight');
    expect(errors).toEqual([]);
  });
});
