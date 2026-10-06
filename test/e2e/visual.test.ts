import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDungeon, type Dungeon } from '../../src/server/app.js';
import { fakeRepo } from '../server/map-helpers.js';
import { firstPixel } from './png.js';

const skip = process.env.CI_NO_BROWSER === '1';
let n = 0;
const ts = () => new Date(Date.now() + n++ * 50).toISOString();

describe.skipIf(skip)('renderer: visual + performance on a 100k-file repo', () => {
  let browser: Browser;
  let d: Dungeon;

  beforeAll(async () => {
    execFileSync('npx', ['vite', 'build', '--logLevel', 'error'], { stdio: 'inherit' });
    const root = mkdtempSync(path.join(tmpdir(), 'rd-vis-'));
    const repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'rd-big-')));
    const files = fakeRepo(100_000, 8_000);
    const dirs = new Set(files.map((f) => path.dirname(f)));
    for (const dir of dirs) mkdirSync(path.join(repo, dir), { recursive: true });
    for (const f of files) writeFileSync(path.join(repo, f), '');
    // The busiest folder becomes the stage.
    const byDir = new Map<string, string[]>();
    for (const f of files) byDir.set(path.dirname(f), [...(byDir.get(path.dirname(f)) ?? []), f]);
    const stage = [...byDir.values()].sort((a, b) => b.length - a.length)[0];
    const abs = (f: string) => path.join(repo, f);

    const projects = path.join(root, 'projects', 'p');
    mkdirSync(path.join(projects, 'lead', 'subagents'), { recursive: true });
    const main = path.join(projects, 'lead.jsonl');
    const lines: object[] = [{ type: 'user', cwd: repo, timestamp: ts(), message: { content: 'go' } }];
    const tool = (id: string, name: string, input: object, model = 'claude-opus-5-5') =>
      lines.push({ type: 'assistant', cwd: repo, timestamp: ts(), message: { model, usage: { input_tokens: 10, cache_read_input_tokens: 120_000 }, content: [{ type: 'tool_use', id, name, input }] } });
    stage.slice(0, 30).forEach((f, i) => tool(`r${i}`, 'Read', { file_path: abs(f) }));
    stage.slice(0, 5).forEach((f, i) => tool(`e${i}`, 'Edit', { file_path: abs(f), old_string: 'a', new_string: 'b' }));
    tool('b1', 'Bash', { command: 'npx vitest run' });
    const out = ` FAIL  ${stage[1]} > auth > expires\n FAIL  ${stage[2]} > auth > refresh\n Test Files  1 failed (1)\n      Tests  2 failed | 3 passed (5)`;
    lines.push({ type: 'user', cwd: repo, timestamp: ts(), message: { content: [{ type: 'tool_result', tool_use_id: 'b1', is_error: true, content: out }] }, toolUseResult: { stdout: out, stderr: '' } });
    writeFileSync(main, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const sub = path.join(projects, 'lead', 'subagents', 'agent-scout1.jsonl');
    writeFileSync(sub, stage.slice(30, 36).map((f, i) => JSON.stringify({ type: 'assistant', cwd: repo, timestamp: ts(), message: { model: 'claude-haiku-4-5-20251001', content: [{ type: 'tool_use', id: `s${i}`, name: 'Read', input: { file_path: abs(f) } }] } })).join('\n') + '\n');
    void appendFileSync;

    d = await startDungeon({ repo, webDir: path.resolve('dist/web'), projectsDir: path.join(root, 'projects'), indexFile: path.join(root, 'index.json'), recordingsDir: path.join(root, 'recordings'), watcher: { pollMs: 50, discoverMs: 100 } });
    // Default headless Chromium renders WebGL in software (SwiftShader); use the real GPU for frame timing.
    const gpu = process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--enable-gpu', '--ignore-gpu-blocklist'];
    browser = await chromium.launch({ args: gpu });
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    await d?.close();
  });

  it('renders the v3 scene without errors and stays smooth', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(d.url);
    await expect.poll(() => page.locator('#party').innerText(), { timeout: 10_000 }).toMatch(/knight/i);
    await expect.poll(() => page.locator('#party').innerText(), { timeout: 10_000 }).toMatch(/fighting|reading|forging|testing/);
    await page.waitForTimeout(4000);
    const center = firstPixel(await page.screenshot({ clip: { x: 640, y: 420, width: 1, height: 1 } }));
    expect(center.some((c) => c > 12)).toBe(true);
    const intervals: number[] = await page.evaluate(() => new Promise((resolve) => {
      const out: number[] = [];
      let last = performance.now();
      const end = last + 3000;
      const tick = (t: number) => {
        out.push(t - last);
        last = t;
        if (t < end) requestAnimationFrame(tick);
        else resolve(out);
      };
      requestAnimationFrame(tick);
    }));
    intervals.sort((a, b) => a - b);
    const median = intervals[Math.floor(intervals.length / 2)];
    await page.screenshot({ path: '.playwright-mcp/renderer-e2e.png' });
    writeFileSync('.playwright-mcp/renderer-e2e.txt', `median frame ${median.toFixed(1)} ms over ${intervals.length} frames\n`);
    expect(errors).toEqual([]);
    expect(median).toBeLessThan(20);
  }, 60_000);
});
