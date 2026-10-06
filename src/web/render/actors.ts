import { Container, Graphics, Sprite, Text } from 'pixi.js';
import type { GameEvent, HeroId } from '../../shared/events.js';
import type { GameState, Monster } from '../../shared/reducer.js';
import { CLASS_NAME_COLORS } from '../art/palette.js';
import type { ArtTextures } from '../art/textures.js';
import { T } from '../art/tiles.js';
import { HeroAnimator } from '../world/anim-queue.js';
import { isFresh } from '../hud/hud-model.js';
import type { Lod } from '../world/lod.js';
import type { Cell } from '../world/walkable.js';
import type { Light } from './lights.js';

const PLATE = { knight: 'Opus', squire: 'Sonnet', scout: 'Haiku', wizard: 'Fable', adventurer: 'Adventurer' } as const;

type HeroView = { c: Container; sprite: Sprite; plate: Text; anim: HeroAnimator; heroClass: string; blink: number; px: number; py: number };
type Particle = { g: Graphics; x: number; y: number; vx: number; vy: number; life: number; max: number };
type Popup = { t: Text; life: number };

/** Heroes (walking sprites), slimes, and short-lived effects. Positions in world pixels (16 per tile). */
export class ActorLayer {
  readonly container = new Container();
  private heroLayer = new Container();
  private monsterLayer = new Container();
  private fx = new Container();
  private heroes = new Map<HeroId, HeroView>();
  private monsters = new Map<string, { s: Sprite; phase: number }>();
  private particles: Particle[] = [];
  private popups: Popup[] = [];

  /** `timelapse`: events run on video time — faster walking, no dash blink, effects for every event. */
  constructor(private art: ArtTextures, private walk: (from: Cell, to: Cell) => Cell[] | null, private opts: { timelapse?: boolean } = {}) {
    this.container.addChild(this.monsterLayer, this.heroLayer, this.fx);
  }

  /** Call after the reducer applied `e`; `before` is the monster list from before it. */
  onEvent(e: GameEvent, s: GameState, before: Monster[]): void {
    const h = s.heroes[e.hero];
    if ((e.kind === 'move' || e.kind === 'forge') && h) this.ensure(e.hero, s).anim.goTo([h.x, h.y], e.t);
    if (!this.opts.timelapse && !isFresh(e.t, Date.now())) return; // history replayed on connect: positions only, no effects
    if (e.kind === 'forge' && h) this.burst(h.x * T + 8, h.y * T + 8, 0xffc85a, 12, e.created ? 1.6 : 1);
    if (e.kind === 'test_result') {
      const alive = new Set(s.monsters.map((m) => m.id));
      for (const m of before) {
        if (alive.has(m.id)) continue;
        const v = this.monsters.get(m.id);
        if (!v) continue;
        this.burst(v.s.x + 8, v.s.y + 8, 0xffd043, 16, 1.2);
        this.popup(v.s.x + 4, v.s.y - 2, '-1');
      }
    }
  }

  private ensure(id: HeroId, s: GameState): HeroView {
    let v = this.heroes.get(id);
    const h = s.heroes[id];
    if (!v) {
      const c = new Container();
      const shadow = new Graphics().ellipse(8, 15, 5, 1.5).fill({ color: 0x000000, alpha: 0.45 });
      const sprite = new Sprite(this.art.hero[h.heroClass][0]);
      const plate = new Text({ text: '', style: { fontFamily: 'Inter', fontWeight: '600', fontSize: 4, fill: CLASS_NAME_COLORS[h.heroClass] }, resolution: 8 });
      plate.anchor.set(0.5, 1);
      plate.position.set(8, -1);
      c.addChild(shadow, sprite, plate);
      this.heroLayer.addChild(c);
      v = { c, sprite, plate, anim: new HeroAnimator([h.x, h.y], this.walk, this.opts.timelapse ? { speed: 24, catchupSpeed: 48, catchupAfterMs: 600, dashAfterMs: 2500 } : {}), heroClass: h.heroClass, blink: 0, px: h.x * T, py: h.y * T };
      this.heroes.set(id, v);
    }
    if (v.heroClass !== h.heroClass) {
      v.heroClass = h.heroClass;
      v.plate.style.fill = CLASS_NAME_COLORS[h.heroClass];
    }
    return v;
  }

  update(s: GameState, dtMs: number, nowT: number, t: number, lod: Lod): void {
    for (const [id, v] of this.heroes) {
      if (!s.heroes[id]) {
        v.c.destroy({ children: true });
        this.heroes.delete(id);
      }
    }
    for (const id of Object.keys(s.heroes)) this.ensure(id, s);
    for (const [id, v] of this.heroes) {
      const h = s.heroes[id];
      const a = v.anim.update(dtMs, nowT);
      if (a.dashed && !this.opts.timelapse) v.blink = 240;
      v.px = a.x * T;
      v.py = a.y * T;
      const frames = this.art.hero[v.heroClass as keyof ArtTextures['hero']];
      const bob = h.status === 'idle' ? 0 : Math.round(Math.sin(t / 250 + id.length) * 0.6);
      v.sprite.texture = a.moving ? frames[Math.floor(t / 110) % 4] : frames[0];
      v.sprite.scale.x = a.facing;
      v.sprite.x = a.facing === -1 ? 16 : 0;
      const big = lod === 'far' ? 4 : 1; // overview: heroes stay visible as big figures
      v.c.scale.set(big);
      v.c.position.set(Math.round(v.px) - (big - 1) * 8, Math.round(v.py) + bob - (big - 1) * 14);
      v.c.alpha = v.blink > 0 ? (Math.floor(v.blink / 60) % 2 ? 0.25 : 1) : h.status === 'idle' ? 0.75 : 1;
      v.blink = Math.max(0, v.blink - dtMs);
      v.plate.visible = lod === 'close';
      v.plate.text = PLATE[h.heroClass];
    }
    this.syncMonsters(s, t);
    this.monsterLayer.scale.set(1);
    for (const v of this.monsters.values()) v.s.scale.set(lod === 'far' ? -3 : -1, lod === 'far' ? 3 : 1);
    this.tickFx(dtMs);
  }

  private syncMonsters(s: GameState, t: number) {
    const alive = new Set(s.monsters.map((m) => m.id));
    for (const [id, v] of this.monsters) if (!alive.has(id)) { v.s.destroy(); this.monsters.delete(id); }
    const perRoom = new Map<string, number>();
    for (const m of s.monsters) {
      const r = s.rooms.get(m.room);
      if (!r) continue;
      const i = perRoom.get(m.room) ?? 0;
      perRoom.set(m.room, i + 1);
      let v = this.monsters.get(m.id);
      if (!v) {
        v = { s: new Sprite(this.art.slime[0]), phase: (i * 1.7) % 6.28 };
        v.s.scale.x = -1;
        this.monsterLayer.addChild(v.s);
        this.monsters.set(m.id, v);
        this.burst((r.x + 1 + i) * T + 8, (r.y + r.h - 2) * T + 8, 0xd8324a, 10, 0.8);
      }
      const x = (r.x + 1 + (i % Math.max(1, r.w - 2))) * T, y = (r.y + r.h - 2 - Math.floor(i / Math.max(1, r.w - 2))) * T;
      const sq = Math.abs(Math.sin(t / 180 + v.phase));
      v.s.texture = this.art.slime[sq > 0.7 ? 1 : 0];
      v.s.position.set(x + 16, y - Math.round(sq * 2));
    }
  }

  /** After the map was regenerated: put every hero straight onto its new position. */
  remap(s: GameState): void {
    for (const [id, v] of this.heroes) {
      const h = s.heroes[id];
      if (h) v.anim.place([h.x, h.y]);
    }
  }

  /** World position of the first slime spawned by `heroId`'s failing tests (for taunt bubbles). */
  monsterPos(s: GameState, heroId: HeroId): { x: number; y: number } | null {
    const m = s.monsters.find((mo) => mo.hero === heroId);
    const v = m && this.monsters.get(m.id);
    return v ? { x: v.s.x - 8, y: v.s.y + 2 } : null;
  }

  /** World positions of heroes and monsters, for the camera and the lights. */
  heroPos(id: HeroId): { x: number; y: number } | null {
    const v = this.heroes.get(id);
    return v ? { x: v.px + 8, y: v.py + 8 } : null;
  }

  lights(s: GameState, followed: HeroId | null): Light[] {
    const out: Light[] = [];
    for (const [id, v] of this.heroes) {
      const cls = s.heroes[id]?.heroClass;
      const torch = s.heroes[id]?.torch;
      const fuel = torch && torch.max ? 1 - torch.used / torch.max : 1;
      const base = id === followed ? 66 : 40;
      out.push({ x: v.px + 8, y: v.py + 10, r: base * (fuel < 0.25 ? 0.6 + fuel * 1.6 : 1), color: cls === 'wizard' ? 0x9b7bff : 0xff9a6a, intensity: 0.18 });
      if (cls === 'wizard') out.push({ x: v.px + 14, y: v.py + 2, r: 22, color: 0x8ce0ff, intensity: 0.4, flicker: 0.08 });
    }
    for (const v of this.monsters.values()) out.push({ x: v.s.x - 8, y: v.s.y + 10, r: 26, color: 0xff2850, intensity: 0.42 });
    return out;
  }

  private burst(x: number, y: number, color: number, n: number, speed: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = (0.02 + Math.random() * 0.04) * speed;
      const g = new Graphics().rect(0, 0, 1, 1).fill(color);
      g.position.set(x, y);
      this.fx.addChild(g);
      this.particles.push({ g, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.02, life: 0, max: 500 + Math.random() * 300 });
    }
  }

  private popup(x: number, y: number, text: string) {
    const t = new Text({ text, style: { fontFamily: 'Inter', fontWeight: '800', fontSize: 7, fill: 0xffe28a, stroke: { color: 0x000000, width: 2 } }, resolution: 6 });
    t.position.set(x, y);
    this.fx.addChild(t);
    this.popups.push({ t, life: 900 });
  }

  private tickFx(dt: number) {
    this.particles = this.particles.filter((p) => {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 0.00006 * dt;
      p.g.position.set(Math.round(p.x), Math.round(p.y));
      p.g.alpha = 1 - p.life / p.max;
      if (p.life < p.max) return true;
      p.g.destroy();
      return false;
    });
    this.popups = this.popups.filter((p) => {
      p.life -= dt;
      p.t.y -= dt * 0.012;
      p.t.alpha = Math.min(1, p.life / 300);
      if (p.life > 0) return true;
      p.t.destroy();
      return false;
    });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
