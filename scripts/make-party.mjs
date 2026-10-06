// Renders the "meet the party" image (four Claude classes + slime) from the game's own sprite data.
// Usage: node scripts/make-party.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { SPRITES } = await vite.ssrLoadModule('/art/sprites.ts');
const { SPRITE_PALETTES } = await vite.ssrLoadModule('/art/palette.ts');
await vite.close();

const font = (pkg, file) => `url(data:font/woff2;base64,${readFileSync(`node_modules/${pkg}/files/${file}`).toString('base64')}) format('woff2')`;
const cast = [
  ['knight', 'Opus', 'Knight', 'helmet & iron sword', '#ffb38a'],
  ['squire', 'Sonnet', 'Squire', 'wooden sword', '#f0c27a'],
  ['scout', 'Haiku', 'Scout', 'quick & curious', '#f6c3a6'],
  ['wizard', 'Fable', 'Wizard', 'staff & star hat', '#c7a6ff'],
  ['slime', 'Slime', 'Failing test', 'dies when tests pass', '#ff6b81'],
];
const svgSprite = (rows, pal) => {
  const rects = rows.flatMap((r, y) => [...r].flatMap((c, x) => (c === '.' || !pal[c] ? [] : [`<rect x="${x}" y="${y}" width="1" height="1" fill="${pal[c]}"/>`]))).join('');
  return `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">${rects}</svg>`).toString('base64')}`;
};
const cards = cast.map(([k, name, cls, note, color]) => `
  <div class="c">
    <div class="glow" style="background:radial-gradient(circle, ${color}33, transparent 65%)"></div>
    <img src="${svgSprite(SPRITES[k], SPRITE_PALETTES[k])}">
    <div class="n" style="color:${color}">${name}</div>
    <div class="k">${cls}</div>
    <div class="t">${note}</div>
  </div>`).join('');
const html = `<style>
@font-face { font-family: Cinzel; font-weight: 700; src: ${font('@fontsource/cinzel', 'cinzel-latin-700-normal.woff2')}; }
@font-face { font-family: Inter; font-weight: 500; src: ${font('@fontsource/inter', 'inter-latin-500-normal.woff2')}; }
html,body{margin:0;background:transparent}
.wrap{width:1200px;height:330px;display:flex;justify-content:center;align-items:flex-end;gap:26px;padding-bottom:26px;box-sizing:border-box;
  background:linear-gradient(180deg,#141621,#0b0c12);border:2px solid #b8955a;border-radius:16px}
.c{position:relative;width:200px;text-align:center}
.glow{position:absolute;left:10px;top:-10px;width:180px;height:180px}
.c img{position:relative;width:160px;height:160px;image-rendering:pixelated}
.n{font:700 30px Cinzel;margin-top:4px}
.k{font:500 15px Inter;color:#cfc3a8;letter-spacing:.08em;text-transform:uppercase}
.t{font:500 14px Inter;color:#8f8676;margin-top:2px}
</style><div class="wrap">${cards}</div>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 330 } });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: 'assets/brand/party.png', omitBackground: true });
await browser.close();
console.log('wrote assets/brand/party.png');
