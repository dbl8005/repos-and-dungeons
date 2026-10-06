import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDungeon, type Dungeon } from '../../src/server/app.js';
import { startDemo } from '../../src/server/demo.js';

const skip = process.env.CI_NO_BROWSER === '1';
const GPU = process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--enable-gpu', '--ignore-gpu-blocklist'];

describe.skipIf(skip)('timelapse export', () => {
  let browser: Browser;
  let d: Dungeon;
  let demo: ReturnType<typeof startDemo>;
  let page: Page;
  const errors: string[] = [];

  beforeAll(async () => {
    execFileSync('npx', ['vite', 'build', '--logLevel', 'error'], { stdio: 'inherit' });
    demo = startDemo({ stepMs: 300 });
    const root = path.dirname(demo.projectsDir);
    d = await startDungeon({ repo: demo.repo, projectsDir: demo.projectsDir, webDir: path.resolve('dist/web'), indexFile: path.join(root, 'index.json'), recordingsDir: path.join(root, 'recordings'), narrator: false, watcher: { pollMs: 50, discoverMs: 100 } });
    browser = await chromium.launch({ args: GPU });
    page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${d.url}&debug`);
    await page.waitForTimeout(8000);
  }, 120_000);

  afterAll(async () => {
    demo?.stop();
    await browser?.close();
    await d?.close();
  });

  const exportAs = async (fmt: 'gif' | 'mp4') => {
    await page.click('#timeline .tl-btn.alt');
    await page.locator(`#export-dialog label:has(input[value=${fmt}])`).click();
    await page.locator('#export-dialog label:has(input[value="15"])').click();
    expect(await page.locator(`#export-dialog input[value=${fmt}]`).isChecked()).toBe(true);
    const download = page.waitForEvent('download', { timeout: 90_000 });
    await page.locator('#export-dialog .tl-btn:not(.alt)').click();
    const dl = await download;
    const file = await dl.path();
    await page.locator('#export-dialog .tl-btn.alt').click();
    return { name: dl.suggestedFilename(), bytes: readFileSync(file!) };
  };

  it('exports a 15 s GIF', async () => {
    const { name, bytes } = await exportAs('gif');
    expect(name).toMatch(/^repos-and-dungeons-\d{8}-\d{4}\.gif$/);
    expect(bytes.subarray(0, 6).toString('ascii')).toBe('GIF89a');
    expect(bytes.length).toBeGreaterThan(100_000);
    writeOut('timelapse-e2e.gif', bytes);
  }, 120_000);

  it('Esc during an export does not stop its timelapse; cancelling restores the live view', async () => {
    await page.click('#timeline .tl-btn.alt');
    await page.locator('#export-dialog label:has(input[value=mp4])').click();
    await page.locator('#export-dialog label:has(input[value="15"])').click();
    await page.locator('#export-dialog .tl-btn:not(.alt)').click();
    await page.waitForTimeout(1500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.body.classList.contains('timelapse'))).toBe(true);
    await page.locator('#export-dialog .tl-btn.alt').click(); // Cancel
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => (window as any).__rd().exportDebug());
    expect(after).toEqual({ recorder: 'inactive', tickerStarted: true, timelapse: false });
  }, 60_000);

  it('exports a 15 s video', async () => {
    const { name, bytes } = await exportAs('mp4');
    expect(name).toMatch(/\.(mp4|webm)$/);
    expect(bytes.length).toBeGreaterThan(100_000);
    writeOut(`timelapse-e2e.${name.split('.').pop()}`, bytes);
    expect(errors).toEqual([]);
  }, 120_000);
});

function writeOut(name: string, bytes: Buffer) {
  import('node:fs').then((fs) => fs.writeFileSync(path.join('.playwright-mcp', name), bytes));
}
