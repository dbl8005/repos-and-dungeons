import { Sprite, Texture } from 'pixi.js';
import type { GameState } from '../../shared/reducer.js';
import type { DungeonMap } from '../../shared/map-types.js';
import { STONE } from '../art/palette.js';
import { T } from '../art/tiles.js';

const PX = 8; // canvas pixels per tile

/**
 * Fog of war: a canvas with 8 px per tile, scaled up. A room (and its corridors) lifts once any of its tiles is
 * seen; fog edges get a fine checker dither like the mockup.
 */
export class FogLayer {
  readonly sprite: Sprite;
  private canvas = document.createElement('canvas');
  private lastVersion = -1;
  private dither: CanvasPattern | null = null;

  constructor(private map: DungeonMap) {
    this.canvas.width = map.width * PX;
    this.canvas.height = map.height * PX;
    const tex = Texture.from(this.canvas);
    tex.source.scaleMode = 'nearest';
    this.sprite = new Sprite(tex);
    this.sprite.scale.set(T / PX);
  }

  update(s: GameState): void {
    if (s.version === this.lastVersion) return;
    this.lastVersion = s.version;
    const { width: W, height: H } = this.map;
    const clear = new Uint8Array(W * H);
    const lit = new Set<string>();
    for (const id of s.seen) {
      const t = s.tiles.get(id);
      if (t) lit.add(t.room);
    }
    const roomPath = new Map(this.map.rooms.map((r) => [r.path, r]));
    for (const r of this.map.rooms) {
      if (!lit.has(r.id)) continue;
      for (let y = r.y - 1; y <= r.y + r.h; y++) for (let x = r.x - 1; x <= r.x + r.w; x++) if (x >= 0 && y >= 0 && x < W && y < H) clear[y * W + x] = 1;
    }
    for (const c of this.map.corridors) {
      const a = roomPath.get(c.from), b = roomPath.get(c.to);
      if (!(a && lit.has(a.id)) && !(b && lit.has(b.id))) continue;
      for (const [x, y] of c.cells)
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H) clear[ny * W + nx] = 1;
        }
    }
    const g = this.canvas.getContext('2d')!;
    if (!this.dither) {
      const p = document.createElement('canvas');
      p.width = p.height = 2;
      const pg = p.getContext('2d')!;
      pg.fillStyle = STONE.fog;
      pg.fillRect(0, 0, 1, 1);
      pg.fillRect(1, 1, 1, 1);
      this.dither = g.createPattern(p, 'repeat');
    }
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const isClear = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && clear[y * W + x] === 1;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (clear[y * W + x]) continue;
        let edge = false;
        for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1; dx++) if (isClear(x + dx, y + dy)) edge = true;
        g.fillStyle = edge ? this.dither! : STONE.fog;
        g.fillRect(x * PX, y * PX, PX, PX);
      }
    this.sprite.texture.source.update();
  }

  destroy(): void {
    this.sprite.destroy({ texture: true, textureSource: true });
  }
}
