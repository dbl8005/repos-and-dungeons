import { Container, Graphics, RenderTexture, Sprite, type Renderer, type Texture } from 'pixi.js';
import type { Lod } from '../world/lod.js';

export type Light = { x: number; y: number; r: number; color: number; intensity: number; flicker?: number };
const MAX_LIGHTS = 24;
const MAX_EMBERS = 60;

type Ember = { x: number; y: number; p: number; dx: number; s: number };

/**
 * Darkness with holes (screen space, re-rendered each frame), additive glows and rising embers (world space).
 * Positions are in world pixels; `toScreen` maps them using the camera.
 */
export class LightLayer {
  readonly world = new Container(); // glows + embers, inside the camera
  readonly screen: Sprite; // darkness overlay, on top of the camera
  private darkness = new Container();
  private dark = new Graphics();
  private holes: Sprite[] = [];
  private glows: Sprite[] = [];
  private embers: Ember[] = [];
  private emberG = new Graphics();
  private rt: RenderTexture;

  constructor(private renderer: Renderer, private gradient: Texture) {
    this.rt = RenderTexture.create({ width: renderer.width, height: renderer.height });
    this.screen = new Sprite(this.rt);
    this.darkness.addChild(this.dark);
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const h = new Sprite(gradient);
      h.anchor.set(0.5);
      h.blendMode = 'erase';
      this.holes.push(h);
      this.darkness.addChild(h);
      const g = new Sprite(gradient);
      g.anchor.set(0.5);
      g.blendMode = 'add';
      this.glows.push(g);
      this.world.addChild(g);
    }
    this.world.addChild(this.emberG);
  }

  /** `darkness` overrides the per-zoom darkness (0 = none), e.g. lighter for timelapses. */
  update(lights: Light[], center: { x: number; y: number }, toScreen: (x: number, y: number) => { x: number; y: number }, zoom: number, lod: Lod, t: number, torches: { x: number; y: number }[], darkness?: number): void {
    const { width, height } = this.renderer;
    if (this.rt.width !== width || this.rt.height !== height) this.rt.resize(width, height);
    const alpha = darkness ?? (lod === 'far' ? 0 : lod === 'mid' ? 0.6 : 0.84);
    this.screen.visible = alpha > 0;
    const nearest = [...lights].sort((a, b) => Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y)).slice(0, MAX_LIGHTS);
    this.dark.clear().rect(0, 0, width, height).fill({ color: 0x03040a, alpha });
    this.holes.forEach((h, i) => {
      const l = nearest[i];
      h.visible = !!l;
      if (!l) return;
      const p = toScreen(l.x, l.y);
      const r = l.r * (1 + (l.flicker ? Math.sin(t / 70 + i * 2) * l.flicker + Math.sin(t / 23 + i) * l.flicker * 0.5 : 0));
      h.position.set(p.x, p.y);
      h.width = h.height = r * 2 * zoom;
    });
    this.glows.forEach((g, i) => {
      const l = nearest[i];
      g.visible = !!l && lod !== 'far';
      if (!l) return;
      g.position.set(l.x, l.y);
      g.width = g.height = l.r * 1.3;
      g.tint = l.color;
      g.alpha = l.intensity;
    });
    if (this.screen.visible) this.renderer.render({ container: this.darkness, target: this.rt, clear: true });
    this.drawEmbers(torches, lod, t);
  }

  private drawEmbers(torches: { x: number; y: number }[], lod: Lod, t: number) {
    const g = this.emberG.clear();
    if (lod !== 'close' || !torches.length) return;
    while (this.embers.length < Math.min(MAX_EMBERS, torches.length * 9)) {
      const src = torches[this.embers.length % torches.length];
      this.embers.push({ x: src.x, y: src.y, p: Math.random(), dx: Math.random() * 6 - 3, s: 0.3 + Math.random() * 0.6 });
    }
    this.embers.forEach((e, i) => {
      e.p += e.s * 0.006;
      if (e.p > 1) {
        const src = torches[i % torches.length];
        Object.assign(e, { x: src.x, y: src.y, p: 0 });
      }
      const ex = e.x + e.dx * e.p * 4 + Math.sin(t / 300 + e.dx) * 2, ey = e.y - e.p * 36;
      g.rect(Math.round(ex), Math.round(ey), 1, 1).fill({ color: 0xff9a3c, alpha: 1 - e.p });
    });
  }

  destroy(): void {
    this.rt.destroy(true);
    this.world.destroy({ children: true });
    this.darkness.destroy({ children: true });
    this.screen.destroy();
  }
}
