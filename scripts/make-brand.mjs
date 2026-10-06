// Generates the logo icon (SVG + PNGs), wordmark and social cards into assets/brand/.
// Usage: node scripts/make-brand.mjs   (needs `npm i` for fonts + playwright)
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const out = 'assets/brand';
mkdirSync(out, { recursive: true });

const KNIGHT = ['......rr........', '.....rRr......s.', '...mmmmmmmm...s.', '..mMMMMMMMMm..s.', '..mmmmmmmmmm..s.', '...OOkOOOkOO..s.', '...OOkOOOkOO..s.', '..aOOOOOOOOOa.s.', '..apPPPPPPPpaggg', '...pPPgPPgPp..g.', '...ppppppppp....', '....O.O..O.O....', '....d.d..d.d....'];
const PAL = { O: '#d97757', o: '#b65f3e', k: '#1a0f0a', a: '#d97757', d: '#7a3a22', m: '#5d6672', M: '#b4bdc8', r: '#a8202c', R: '#e8505e', s: '#eef3f6', g: '#d4a43a', p: '#59626e', P: '#a0aab6' };
const TORCH = ['.y.', 'yYy', 'yOy', '.o.', '.b.', '.b.', '.b.'];
const TPAL = { y: '#ffb030', Y: '#fff0a0', O: '#ff7020', o: '#c04010', b: '#5a3a1a' };

/** 32×32 pixel icon: knight Claude in a torch-lit stone archway. */
function iconSVG() {
  const px = [];
  const rect = (x, y, c, w = 1, h = 1) => px.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`);
  // stone arch: wall blocks with a rounded opening
  for (let y = 3; y < 30; y++)
    for (let x = 2; x < 30; x++) {
      const dx = x - 15.5, dy = y - 15;
      const inside = (y >= 15 && Math.abs(dx) <= 8.5) || (y < 15 && dx * dx + dy * dy <= 8.5 * 8.5);
      if (inside) continue;
      const row = Math.floor((y - 3) / 3), off = row % 2 ? 2 : 0;
      const edge = (x + off) % 4 === 0 || (y - 3) % 3 === 0;
      rect(x, y, edge ? '#1d222d' : (x * 7 + y * 3) % 5 === 0 ? '#3a4356' : '#323949');
    }
  rect(2, 29, '#4f5a70', 28, 1);
  // torches on the pillars
  for (const tx of [3, 26]) TORCH.forEach((r, j) => [...r].forEach((c, i) => c !== '.' && rect(tx + i, 9 + j, TPAL[c])));
  // knight in the doorway (16 wide), standing on the floor line
  KNIGHT.forEach((r, j) => [...r].forEach((c, i) => c !== '.' && rect(8 + i, 16 + j, PAL[c])));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges">
  <defs>
    <radialGradient id="glow" cx="50%" cy="66%" r="45%"><stop offset="0" stop-color="#ff9a4a" stop-opacity=".55"/><stop offset="1" stop-color="#ff9a4a" stop-opacity="0"/></radialGradient>
    <radialGradient id="tl" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffb347" stop-opacity=".7"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="32" height="32" rx="5" fill="#07080c"/>
  <rect x="7" y="6" width="18" height="24" fill="#0b0c12"/>
  <rect x="6" y="10" width="20" height="20" fill="url(#glow)"/>
  ${px.join('')}
  <circle cx="4.5" cy="10" r="4" fill="url(#tl)"/><circle cx="27.5" cy="10" r="4" fill="url(#tl)"/>
  <rect x=".5" y=".5" width="31" height="31" rx="4.5" fill="none" stroke="#b8955a" stroke-width="1"/>
</svg>`;
}

const icon = iconSVG();
writeFileSync(path.join(out, 'icon.svg'), icon);

const fontCSS = (pkg, file) => {
  const p = path.resolve('node_modules', pkg, 'files', file);
  return existsSync(p) ? `url(data:font/woff2;base64,${readFileSync(p).toString('base64')}) format('woff2')` : 'local(serif)';
};
const fonts = `
@font-face { font-family: Cinzel; font-weight: 700; src: ${fontCSS('@fontsource/cinzel', 'cinzel-latin-700-normal.woff2')}; }
@font-face { font-family: Inter; font-weight: 500; src: ${fontCSS('@fontsource/inter', 'inter-latin-500-normal.woff2')}; }
@font-face { font-family: Inter; font-weight: 700; src: ${fontCSS('@fontsource/inter', 'inter-latin-700-normal.woff2')}; }`;
const iconImg = `data:image/svg+xml;base64,${Buffer.from(icon).toString('base64')}`;
const shot = existsSync('assets/media/demo-still.png') ? `data:image/png;base64,${readFileSync('assets/media/demo-still.png').toString('base64')}` : null;

const pages = {
  'icon-512.png': { w: 512, h: 512, transparent: true, html: `<img src="${iconImg}" style="width:512px;height:512px;image-rendering:pixelated">` },
  'icon-128.png': { w: 128, h: 128, transparent: true, html: `<img src="${iconImg}" style="width:128px;height:128px;image-rendering:pixelated">` },
  'wordmark.png': {
    w: 1400, h: 300, transparent: true,
    html: `<div style="display:flex;align-items:center;gap:36px;height:300px;padding:0 40px">
      <img src="${iconImg}" style="width:220px;height:220px;image-rendering:pixelated">
      <div><div style="font:700 88px/1 Cinzel;color:#efe4cc;letter-spacing:.02em;text-shadow:0 4px 0 #000;white-space:nowrap">Repos <span style="color:#e6c27a">&amp;</span> Dungeons</div>
      <div style="font:500 30px Inter;color:#b9ad93;margin-top:16px">Your coding agent's session, as a roguelike.</div></div></div>`,
  },
  'social-1280x640.png': {
    w: 1280, h: 640,
    html: `<div style="width:1280px;height:640px;background:radial-gradient(120% 100% at 30% 0%,#1c1f2c,#07080c 70%);display:flex;align-items:center;gap:40px;padding:0 56px;box-sizing:border-box;position:relative;overflow:hidden">
      <div style="flex:0 0 520px">
        <img src="${iconImg}" style="width:150px;height:150px;image-rendering:pixelated">
        <div style="font:700 70px/1.02 Cinzel;color:#efe4cc;margin-top:18px">Repos <span style="color:#e6c27a">&amp;</span><br>Dungeons</div>
        <div style="font:500 26px/1.35 Inter;color:#cfc3a8;margin-top:22px">Watch Claude Code explore your repo as a pixel dungeon. Folders are rooms, unread code is fog, failing tests are monsters.</div>
        <div style="font:700 18px Inter;color:#e6c27a;margin-top:22px;letter-spacing:.06em">FREE · OPEN SOURCE · RUNS LOCALLY</div>
      </div>
      ${shot ? `<div style="flex:1;height:520px;border:2px solid #b8955a;border-radius:12px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.6)"><img src="${shot}" style="width:100%;height:100%;object-fit:cover;object-position:50% 45%"></div>` : ''}
    </div>`,
  },
};

const browser = await chromium.launch();
for (const [name, p] of Object.entries(pages)) {
  const page = await browser.newPage({ viewport: { width: p.w, height: p.h } });
  await page.setContent(`<style>${fonts} html,body{margin:0;background:${p.transparent ? 'transparent' : '#07080c'}}</style>${p.html}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(out, name), omitBackground: !!p.transparent });
  await page.close();
}
await browser.close();
console.log('brand assets written to', out);
