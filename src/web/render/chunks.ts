import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { GameState } from '../../shared/reducer.js';
import type { DungeonMap, Tile } from '../../shared/map-types.js';
import { PROP_PALETTE, STONE, UI } from '../art/palette.js';
import { PROPS, spriteToRGBA } from '../art/sprites.js';
import { paintTile, T } from '../art/tiles.js';
import { buildWalkable } from '../world/walkable.js';
import { visibleChunks, type Lod, type View } from '../world/lod.js';

export const CHUNK_TILES = 32;
const CHUNK_PX = CHUNK_TILES * T;
const MAX_CACHED = 32;

type Chunk = { base: Sprite; props: Sprite; propsCanvas: HTMLCanvasElement; dirty: boolean; lastUsed: number };

const propImages = Object.fromEntries(
  (Object.keys(PROPS) as (keyof typeof PROPS)[]).map((k) => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 8;
    cv.getContext('2d')!.putImageData(new ImageData(spriteToRGBA(PROPS[k], PROP_PALETTE[k], 8) as Uint8ClampedArray<ArrayBuffer>, 8, 8), 0, 0);
    return [k, cv];
  }),
) as Record<keyof typeof PROPS, HTMLCanvasElement>;

/**
 * The static dungeon: floors, walls, wall torches and file props, baked into 32×32-tile chunk textures that
 * are only created when visible (LRU cache). At far zoom, rooms are drawn as labeled blocks instead.
 */
export class ChunkLayer {
  readonly container = new Container();
  private chunkLayer = new Container();
  private labels = new Container();
  private far = new Graphics();
  private farLabels = new Container();
  private chunks = new Map<number, Chunk>();
  private cols: number;
  private rows: number;
  private floor: Uint8Array;
  private tilesByChunk = new Map<number, Tile[]>();
  private torchesByChunk = new Map<number, [number, number][]>();
  private frame = 0;
  private farVersion = -1;

  constructor(private map: DungeonMap) {
    this.cols = Math.ceil(map.width / CHUNK_TILES);
    this.rows = Math.ceil(map.height / CHUNK_TILES);
    this.floor = buildWalkable(map).cells;
    for (const t of map.tiles) this.push(this.tilesByChunk, this.chunkOf(t.x, t.y), t);
    for (const d of map.decor) if (d.kind === 'torch') this.push(this.torchesByChunk, this.chunkOf(d.x, d.y), [d.x, d.y]);
    this.container.addChild(this.chunkLayer, this.labels, this.far, this.farLabels);
    this.buildLabels();
  }

  private aliases: Map<string, string> | null = null;

  /** Exports with folder names hidden show "Room N" instead (null restores the real names). */
  setLabelAliases(aliases: Map<string, string> | null): void {
    this.aliases = aliases;
    this.buildLabels();
    this.farVersion = -1;
    this.farLabels.removeChildren().forEach((c) => c.destroy());
  }

  private roomName(r: { id: string; path: string }, full: boolean): string {
    const alias = this.aliases?.get(r.id);
    if (alias) return alias;
    if (r.path === '') return '/';
    return full ? `${r.path}/` : r.path.slice(r.path.lastIndexOf('/') + 1);
  }

  // Room name pills on the top wall (mockup: dark pill, gold text, thin bronze border).
  private buildLabels() {
    this.labels.removeChildren().forEach((c) => c.destroy({ children: true }));
    for (const r of this.map.rooms) {
      const t = new Text({ text: this.roomName(r, true), style: { fontFamily: 'Cinzel', fontWeight: '700', fontSize: 6, fill: UI.gold, letterSpacing: 0.4 }, resolution: 6 });
      const pill = new Container();
      const bg = new Graphics().roundRect(0, 0, t.width + 8, t.height + 3, 2).fill({ color: 0x08090e, alpha: 0.85 }).stroke({ color: 0x6a5636, width: 0.6 });
      t.position.set(4, 1.5);
      pill.addChild(bg, t);
      pill.position.set(r.x * T + 2, (r.y - 1) * T + 8 - pill.height / 2);
      this.labels.addChild(pill);
    }
  }

  private push<V>(m: Map<number, V[]>, k: number, v: V) {
    const l = m.get(k);
    if (l) l.push(v);
    else m.set(k, [v]);
  }
  private chunkOf = (x: number, y: number) => Math.floor(y / CHUNK_TILES) * this.cols + Math.floor(x / CHUNK_TILES);
  private isFloor = (x: number, y: number) => x >= 0 && y >= 0 && x < this.map.width && y < this.map.height && this.floor[y * this.map.width + x] === 1;

  /** Tiles whose look changed (seen/forged); their chunks re-bake props on next update. */
  markDirty(tileIds: Iterable<number>, state: GameState): void {
    for (const id of tileIds) {
      const t = state.tiles.get(id);
      const c = t && this.chunks.get(this.chunkOf(t.x, t.y));
      if (c) c.dirty = true;
    }
  }

  update(view: View, lod: Lod, state: GameState): void {
    this.frame++;
    const isFar = lod === 'far';
    this.chunkLayer.visible = !isFar;
    this.labels.visible = lod !== 'far';
    this.far.visible = this.farLabels.visible = isFar;
    if (isFar) return this.drawFar(state);
    const want = new Set(visibleChunks(view, CHUNK_PX, this.cols, this.rows));
    for (const [i, c] of this.chunks) c.base.visible = c.props.visible = want.has(i);
    for (const i of want) {
      let c = this.chunks.get(i);
      if (!c) c = this.bake(i);
      if (c.dirty) this.bakeProps(i, c, state);
      c.lastUsed = this.frame;
    }
    if (this.chunks.size > MAX_CACHED) {
      const old = [...this.chunks.entries()].filter(([i]) => !want.has(i)).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      for (const [i, c] of old.slice(0, this.chunks.size - MAX_CACHED)) this.drop(i, c);
    }
  }

  private bake(i: number): Chunk {
    const cx = (i % this.cols) * CHUNK_TILES, cy = Math.floor(i / this.cols) * CHUNK_TILES;
    const cv = document.createElement('canvas');
    cv.width = cv.height = CHUNK_PX;
    const g = cv.getContext('2d')!;
    for (let y = cy; y < cy + CHUNK_TILES; y++)
      for (let x = cx; x < cx + CHUNK_TILES; x++) {
        const X = (x - cx) * T, Y = (y - cy) * T;
        if (this.isFloor(x, y)) paintTile(g, 'floor', x, y, X, Y, this.isFloor);
        else if (this.nearFloor(x, y)) paintTile(g, this.isFloor(x, y + 1) ? 'wallFront' : 'wallTop', x, y, X, Y, this.isFloor);
      }
    for (const [x, y] of this.torchesByChunk.get(i) ?? []) g.drawImage(propImages.torch, (x - cx) * T + 4, (y - cy) * T + 6);
    const base = this.sprite(cv, cx, cy);
    const propsCanvas = document.createElement('canvas');
    propsCanvas.width = propsCanvas.height = CHUNK_PX;
    const props = this.sprite(propsCanvas, cx, cy);
    const c: Chunk = { base, props, propsCanvas, dirty: true, lastUsed: this.frame };
    this.chunkLayer.addChild(base, props);
    this.chunks.set(i, c);
    return c;
  }

  private bakeProps(i: number, c: Chunk, s: GameState) {
    const cx = (i % this.cols) * CHUNK_TILES, cy = Math.floor(i / this.cols) * CHUNK_TILES;
    const g = c.propsCanvas.getContext('2d')!;
    g.clearRect(0, 0, CHUNK_PX, CHUNK_PX);
    for (const t of this.tilesByChunk.get(i) ?? []) {
      const img = s.forged.has(t.id) ? propImages.forged : s.seen.has(t.id) ? propImages.scroll : propImages.crate;
      g.drawImage(img, (t.x - cx) * T + 4, (t.y - cy) * T + 4);
      if (t.count > 1) {
        g.fillStyle = 'rgba(0,0,0,.5)';
        g.fillRect((t.x - cx) * T + 11, (t.y - cy) * T + 11, 4, 4);
      }
    }
    c.props.texture.source.update();
    c.dirty = false;
  }

  private sprite(cv: HTMLCanvasElement, cx: number, cy: number): Sprite {
    const tex = Texture.from(cv);
    tex.source.scaleMode = 'nearest';
    const s = new Sprite(tex);
    s.position.set(cx * T, cy * T);
    return s;
  }

  private nearFloor(x: number, y: number) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (this.isFloor(x + dx, y + dy)) return true;
    return false;
  }

  private drawFar(s: GameState) {
    if (this.farVersion === s.version) return;
    this.farVersion = s.version;
    const g = this.far.clear();
    const seenByRoom = new Map<string, number>();
    const totalByRoom = new Map<string, number>();
    for (const t of s.map.tiles) {
      totalByRoom.set(t.room, (totalByRoom.get(t.room) ?? 0) + 1);
      if (s.seen.has(t.id)) seenByRoom.set(t.room, (seenByRoom.get(t.room) ?? 0) + 1);
    }
    for (const c of s.map.corridors) for (const [x, y] of c.cells) g.rect(x * T, y * T, T, T).fill(STONE.floor[0]);
    if (this.farLabels.children.length !== s.map.rooms.length) {
      this.farLabels.removeChildren().forEach((c) => c.destroy());
      for (const r of s.map.rooms) {
        const t = new Text({ text: '', style: { fontFamily: 'Cinzel', fontWeight: '700', fontSize: 26, fill: UI.gold } });
        t.position.set(r.x * T + 6, r.y * T + 6);
        this.farLabels.addChild(t);
      }
    }
    s.map.rooms.forEach((r, i) => {
      const pct = Math.round(((seenByRoom.get(r.id) ?? 0) / Math.max(1, totalByRoom.get(r.id) ?? 0)) * 100);
      g.rect(r.x * T, r.y * T, r.w * T, r.h * T).fill(pct > 0 ? STONE.cap : STONE.front).stroke({ color: STONE.capHi, width: 4 });
      const label = this.farLabels.children[i] as Text;
      label.text = `${this.roomName(r, false)}  ${pct}%`;
      label.scale.set(Math.min(1, (r.w * T - 12) / Math.max(1, label.width / label.scale.x))); // fit inside the room
      label.alpha = pct > 0 ? 1 : 0.55;
    });
  }

  private drop(i: number, c: Chunk) {
    c.base.destroy({ texture: true, textureSource: true });
    c.props.destroy({ texture: true, textureSource: true });
    this.chunks.delete(i);
  }

  destroy(): void {
    for (const [i, c] of [...this.chunks]) this.drop(i, c);
    this.container.destroy({ children: true });
  }
}
