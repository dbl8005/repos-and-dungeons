import type { GameState } from '../../shared/reducer.js';
import { CLASS_NAME_COLORS } from '../art/palette.js';
import { minimapTransform } from './hud-model.js';

const SIZE = 188;

/** Whole-dungeon overview: explored rooms lit, hero dots, monster dots, camera box. Click to jump. */
export class Minimap {
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement, private onJump: (tileX: number, tileY: number) => void) {
    canvas.width = canvas.height = SIZE;
    this.ctx = canvas.getContext('2d')!;
    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      const mx = ((e.clientX - r.left - 6) / (r.width - 12)) * SIZE, my = ((e.clientY - r.top - 6) / (r.height - 12)) * SIZE;
      if (!this.last) return;
      const [x, y] = minimapTransform(this.last.map, SIZE).toWorld([mx, my]);
      this.onJump(x, y);
    });
  }

  private last: GameState | null = null;

  draw(s: GameState, view: { x: number; y: number; w: number; h: number } /* tiles */): void {
    this.last = s;
    const g = this.ctx, m = minimapTransform(s.map, SIZE), k = m.scale;
    g.clearRect(0, 0, SIZE, SIZE);
    const lit = new Set<string>();
    for (const id of s.seen) {
      const t = s.tiles.get(id);
      if (t) lit.add(t.room);
    }
    g.fillStyle = '#2a3040';
    for (const c of s.map.corridors) for (const [x, y] of c.cells) g.fillRect(x * k, y * k, Math.max(1, k), Math.max(1, k));
    for (const r of s.map.rooms) {
      g.fillStyle = lit.has(r.id) ? '#6a768e' : '#1d222d';
      g.fillRect(r.x * k, r.y * k, Math.max(1, r.w * k), Math.max(1, r.h * k));
    }
    for (const mo of s.monsters) {
      const r = s.rooms.get(mo.room);
      if (!r) continue;
      g.fillStyle = '#ff4d6d';
      g.fillRect((r.x + r.w / 2) * k - 2, (r.y + r.h / 2) * k - 2, 4, 4);
    }
    for (const h of Object.values(s.heroes)) {
      g.fillStyle = CLASS_NAME_COLORS[h.heroClass];
      g.beginPath();
      g.arc(h.x * k, h.y * k, 3, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = 'rgba(230,194,122,.8)';
    g.lineWidth = 1;
    g.strokeRect(view.x * k, view.y * k, view.w * k, view.h * k);
  }
}
