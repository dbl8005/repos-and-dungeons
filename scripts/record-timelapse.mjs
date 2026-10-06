// Records a showcase timelapse with the app's own exporter: runs the large demo for a while, then exports
// a 30 s square GIF and video into assets/media/. Usage: npm run build && node scripts/record-timelapse.mjs
import { spawn } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import { chromium } from 'playwright';

const GPU = process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--enable-gpu', '--ignore-gpu-blocklist'];
const child = spawn('node', ['dist/cli.js', process.env.DEMO ?? '--demo', '--no-open', '--port', '47803'], { stdio: ['ignore', 'pipe', 'inherit'] });
const url = await new Promise((resolve) => {
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    const m = buf.match(/http:\/\/127\.0\.0\.1:\d+\/\?key=\w+/);
    if (m) resolve(m[0]);
  });
});
const browser = await chromium.launch({ args: GPU });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
await page.goto(url);
const RUN_S = Number(process.env.RUN_S ?? 75);
console.log(`letting the demo run for ${RUN_S} s…`);
await page.waitForTimeout(RUN_S * 1000);

async function exportAs(fmt, out) {
  await page.click('#timeline .tl-btn.alt');
  await page.locator(`#export-dialog label:has(input[value=${fmt}])`).click();
  await page.locator('#export-dialog label:has(input[value="30"])').click();
  const download = page.waitForEvent('download', { timeout: 180_000 });
  await page.locator('#export-dialog .tl-btn:not(.alt)').click();
  const dl = await download;
  const ext = dl.suggestedFilename().split('.').pop();
  copyFileSync(await dl.path(), `${out}.${ext}`);
  await page.locator('#export-dialog .tl-btn.alt').click();
  console.log('saved', `${out}.${ext}`);
}
await exportAs('gif', 'assets/media/timelapse');
await exportAs('mp4', 'assets/media/timelapse');
await browser.close();
child.kill();
