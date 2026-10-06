// Records launch media from the scripted demo: MP4 + GIF clips and a still.
// Usage: npm run build && node scripts/record.mjs
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT = 'assets/media';
mkdirSync(OUT, { recursive: true });
const GPU = process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--enable-gpu', '--ignore-gpu-blocklist'];

async function startDemo(flag, port) {
  const child = spawn('node', ['dist/cli.js', flag, '--no-open', '--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  const url = await new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      const m = buf.match(/http:\/\/127\.0\.0\.1:\d+\/\?key=\w+/);
      if (m) resolve(m[0]);
    });
    child.on('exit', () => reject(new Error('demo exited')));
  });
  return { url, stop: () => child.kill() };
}

async function record(name, flag, port, choreography) {
  const demo = await startDemo(flag, port);
  const browser = await chromium.launch({ args: GPU });
  const tmp = path.join(OUT, `.tmp-${name}`);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: tmp, size: { width: 1280, height: 720 } } });
  const page = await ctx.newPage();
  await page.goto(demo.url);
  await page.waitForSelector('canvas');
  await choreography(page);
  await ctx.close();
  await browser.close();
  demo.stop();
  const webm = readdirSync(tmp).find((f) => f.endsWith('.webm'));
  renameSync(path.join(tmp, webm), path.join(OUT, `${name}.webm`));
  rmSync(tmp, { recursive: true, force: true });
  return path.join(OUT, `${name}.webm`);
}

function encode(webm, name, { start = 0, duration, gifWidth = 640, fps = 12 }) {
  const mp4 = path.join(OUT, `${name}.mp4`);
  const gif = path.join(OUT, `${name}.gif`);
  const trim = ['-ss', String(start), ...(duration ? ['-t', String(duration)] : [])];
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...trim, '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', mp4]);
  const filter = `fps=${fps},scale=${gifWidth}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...trim, '-i', webm, '-filter_complex', filter, gif]);
  return { mp4, gif };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) Close-up: heroes walking, forging, slimes, speech bubbles.
const heroClip = await record('hero', '--demo', 47801, async (page) => {
  await sleep(26_000);
  // a still with a bubble on screen for the social card
  for (let i = 0; i < 40; i++) {
    if (await page.locator('.bubble').count()) break;
    await sleep(250);
  }
  await page.screenshot({ path: path.join(OUT, 'demo-still.png') });
  await sleep(6_000);
});
console.log('hero clip', encode(heroClip, 'hero', { start: 3, duration: 18 }));

// 2) Big repo: overview of a ~2,500-file monorepo, then dive in to the party.
const bigClip = await record('big-repo', '--demo-large', 47802, async (page) => {
  await sleep(12_000);
  await page.keyboard.press('f');
  await sleep(6_000);
  await page.keyboard.press('Escape');
  await sleep(7_000);
});
console.log('big clip', encode(bigClip, 'big-repo', { start: 10, duration: 14 }));
