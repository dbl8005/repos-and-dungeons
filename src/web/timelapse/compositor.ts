import iconUrl from '../../../assets/brand/icon.svg?url';
import type { OverlayBubble } from './controller.js';

const icon = new Image();
icon.src = iconUrl;

const fmtClock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((v) => String(v).padStart(2, '0')).join(':');
};

function pill(g: CanvasRenderingContext2D, x: number, y: number, text: string, size: number, align: 'left' | 'right') {
  g.font = `700 ${size}px Cinzel, serif`;
  const w = g.measureText(text).width + size * 1.2, h = size * 1.9;
  const left = align === 'left' ? x : x - w;
  g.fillStyle = 'rgba(10,11,18,.82)';
  g.strokeStyle = '#b8955a';
  g.lineWidth = Math.max(1, size / 14);
  g.beginPath();
  g.roundRect(left, y, w, h, size * 0.4);
  g.fill();
  g.stroke();
  g.fillStyle = '#e6c27a';
  g.textBaseline = 'middle';
  g.fillText(text, left + size * 0.6, y + h / 2 + 1);
}

function wrap(g: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width > max && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

/** Draws the game canvas plus the export overlay (clock, explored %, bubbles, watermark) at the export size. */
export class Compositor {
  readonly canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;

  constructor(readonly width: number, readonly height: number) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.g = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }

  draw(src: HTMLCanvasElement, o: { clockMs: number; explored: number; bubbles: OverlayBubble[]; hideBubbles: boolean }): void {
    const g = this.g, W = this.width, H = this.height;
    const k = Math.max(W / src.width, H / src.height);
    const sw = W / k, sh = H / k;
    const sx = (src.width - sw) / 2, sy = (src.height - sh) / 2;
    g.imageSmoothingEnabled = W < src.width;
    g.drawImage(src, sx, sy, sw, sh, 0, 0, W, H);
    // vignette, like the live view
    const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,.5)');
    g.fillStyle = v;
    g.fillRect(0, 0, W, H);
    const u = Math.min(W, H) / 1080; // overlay scale
    if (!o.hideBubbles) {
      const placed: { x: number; y: number; w: number; h: number }[] = [];
      for (const b of [...o.bubbles].sort((p, q) => p.y - q.y)) {
        const x = (b.x - sx) * k, y = (b.y - sy) * k;
        if (x < 0 || y < 0 || x > W || y > H) continue;
        g.font = `500 ${22 * u}px Inter, sans-serif`;
        const lines = wrap(g, b.text, 360 * u);
        const tw = Math.max(...lines.map((l) => g.measureText(l).width), 80 * u);
        const bw = tw + 28 * u, bh = (lines.length * 28 + 40) * u;
        const bx = Math.min(W - bw - 10, Math.max(10, x - bw / 2));
        let by = Math.max(80 * u, y - bh - 18 * u);
        // nudge up past bubbles already drawn so lines never overlap
        for (let guard = 0; guard < 4; guard++) {
          const hit = placed.find((r) => bx < r.x + r.w && r.x < bx + bw && by < r.y + r.h + 6 && r.y < by + bh + 6);
          if (!hit) break;
          by = hit.y - bh - 8 * u;
        }
        placed.push({ x: bx, y: by, w: bw, h: bh });
        g.fillStyle = 'rgba(28,23,14,.95)';
        g.strokeStyle = '#c9a25e';
        g.lineWidth = 2 * u;
        g.beginPath();
        g.roundRect(bx, by, bw, bh, 10 * u);
        g.fill();
        g.stroke();
        g.fillStyle = b.color;
        g.font = `700 ${15 * u}px Cinzel, serif`;
        g.textBaseline = 'top';
        g.fillText(b.who, bx + 14 * u, by + 10 * u);
        g.fillStyle = '#f6ead0';
        g.font = `500 ${22 * u}px Inter, sans-serif`;
        lines.forEach((l, i) => g.fillText(l, bx + 14 * u, by + (32 + i * 28) * u));
      }
    }
    pill(g, 24 * u, 24 * u, `⏱ ${fmtClock(o.clockMs)}`, 26 * u, 'left');
    pill(g, W - 24 * u, 24 * u, `explored ${o.explored}%`, 26 * u, 'right');
    // watermark
    const s = 56 * u;
    g.globalAlpha = 0.92;
    if (icon.complete && icon.naturalWidth) {
      g.imageSmoothingEnabled = false;
      g.drawImage(icon, W - 24 * u - s, H - 24 * u - s, s, s);
    }
    g.font = `700 ${24 * u}px Cinzel, serif`;
    g.textBaseline = 'middle';
    g.textAlign = 'right';
    g.fillStyle = '#efe4cc';
    g.fillText('Repos & Dungeons', W - 36 * u - s, H - 24 * u - s / 2 - 8 * u);
    g.font = `500 ${15 * u}px Inter, sans-serif`;
    g.fillStyle = '#b9ad93';
    g.fillText('github.com/dbl8005/repos-and-dungeons', W - 36 * u - s, H - 24 * u - s / 2 + 16 * u);
    g.textAlign = 'left';
    g.globalAlpha = 1;
  }

  imageData(): ImageData {
    return this.g.getImageData(0, 0, this.width, this.height);
  }
}
