import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { isBoss, type Species } from '../../shared/bestiary.js';
import type { GameEvent, HeroId } from '../../shared/events.js';
import { lastMonsterOf, type GameState, type Monster } from '../../shared/reducer.js';
import { CLASS_NAME_COLORS } from '../art/palette.js';
import { SPRITES } from '../art/sprites.js';
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
/** A monster: container pivoted at its feet, so it scales up (boss, overview) without sinking into the floor. */
type MonsterView = { c: Container; s: Sprite; bar: Graphics; crown: Graphics; species: Species; phase: number; flash: number; drawn: string };

/** First painted row of each monster sprite, so the HP bar and crown sit right on its head. */
const HEAD = Object.fromEntries((['slime', 'goblin', 'bat', 'ogre'] as const).map((sp) => [sp, SPRITES[sp].findIndex((r) => /[^.]/.test(r))])) as Record<Species, number>;

/** Heroes (walking sprites), monsters, and short-lived effects. Positions in world pixels (16 per tile). */
export class ActorLayer {
  readonly container = new Container();
  private heroLayer = new Container();
  private monsterLayer = new Container();
  private fx = new Container();
  private heroes = new Map<HeroId, HeroView>();
  private monsters = new Map<string, MonsterView>();
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
      const after = new Map(s.monsters.map((m) => [m.id, m]));
      for (const m of before) {
        const v = this.monsters.get(m.id);
        const hp = after.get(m.id)?.hp ?? 0;
        if (!v || hp >= m.hp) continue;
        const { x, y } = this.center(v);
        if (hp === 0) this.burst(x, y, 0xffd043, 16, 1.2); // slain
        else {
          this.burst(x, y, 0xffffff, 6, 0.8);
          v.flash = 300;
        }
        this.popup(x - 4, y - 10 * v.c.scale.y, `-${m.hp - hp}`);
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
    this.syncMonsters(s, t, dtMs, lod);
    this.tickFx(dtMs);
  }

  private syncMonsters(s: GameState, t: number, dtMs: number, lod: Lod) {
    const alive = new Set(s.monsters.map((m) => m.id));
    for (const [id, v] of this.monsters) if (!alive.has(id)) { v.c.destroy({ children: true }); this.monsters.delete(id); }
    const perRoom = new Map<string, number>();
    for (const m of s.monsters) {
      const r = s.rooms.get(m.room);
      if (!r) continue;
      const i = perRoom.get(m.room) ?? 0;
      perRoom.set(m.room, i + 1);
      let v = this.monsters.get(m.id);
      if (!v) {
        const c = new Container();
        const sprite = new Sprite(this.art.monsters[m.species][0]);
        sprite.scale.x = -1; // monsters face the heroes
        sprite.x = 16;
        v = { c, s: sprite, bar: new Graphics(), crown: new Graphics(), species: m.species, phase: (i * 1.7) % 6.28, flash: 0, drawn: '' };
        c.pivot.set(8, 16);
        c.addChild(sprite, v.crown, v.bar);
        this.monsterLayer.addChild(c);
        this.monsters.set(m.id, v);
        this.burst((r.x + 1 + i) * T + 8, (r.y + r.h - 2) * T + 8, 0xd8324a, 10, 0.8);
      }
      v.species = m.species; // a later failure of the same check can change what it is
      this.drawStatus(v, m);
      const x = (r.x + 1 + (i % Math.max(1, r.w - 2))) * T, y = (r.y + r.h - 2 - Math.floor(i / Math.max(1, r.w - 2))) * T;
      const sq = Math.abs(Math.sin(t / 180 + v.phase));
      v.s.texture = this.art.monsters[v.species][sq > 0.7 ? 1 : 0];
      v.c.scale.set((lod === 'far' ? 3 : 1) * (isBoss(m) ? 2 : 1));
      v.c.position.set(x + 8, y + 16 - Math.round(sq * 2));
      v.c.alpha = v.flash > 0 && Math.floor(v.flash / 60) % 2 ? 0.3 : 1;
      v.flash = Math.max(0, v.flash - dtMs);
    }
  }

  /** HP bar (once a monster has had more than one failure) and a crown for bosses; redrawn only when they change. */
  private drawStatus(v: MonsterView, m: Monster) {
    const key = `${m.species}/${m.hp}/${m.maxHp}/${isBoss(m)}`;
    if (v.drawn === key) return;
    v.drawn = key;
    const head = HEAD[v.species];
    v.crown.clear();
    if (isBoss(m)) {
      v.crown.rect(5, head - 3, 1, 1).rect(7, head - 3, 2, 1).rect(10, head - 3, 1, 1).rect(5, head - 2, 6, 2).fill(0xffd043);
      v.crown.rect(7, head - 2, 2, 1).fill(0xd8324a);
    }
    v.bar.clear();
    if (m.maxHp > 1) {
      const top = head - (isBoss(m) ? 6 : 3);
      v.bar.rect(1, top, 14, 2).fill({ color: 0x000000, alpha: 0.7 });
      v.bar.rect(1, top, Math.max(1, Math.round((14 * m.hp) / m.maxHp)), 2).fill(0xff4d6d);
    }
  }

  /** World position of the middle of a monster's body. */
  private center(v: MonsterView): { x: number; y: number } {
    return { x: v.c.x, y: v.c.y - 6 * v.c.scale.y };
  }

  /** After the map was regenerated: put every hero straight onto its new position. */
  remap(s: GameState): void {
    for (const [id, v] of this.heroes) {
      const h = s.heroes[id];
      if (h) v.anim.place([h.x, h.y]);
    }
  }

  /** World position of the monster `heroId`'s failing checks spawned last (the one taunting, in bubbles). */
  monsterPos(s: GameState, heroId: HeroId): { x: number; y: number } | null {
    const m = lastMonsterOf(s, heroId);
    const v = m && this.monsters.get(m.id);
    return v ? { x: v.c.x, y: v.c.y - (20 - HEAD[v.species]) * v.c.scale.y } : null;
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
    for (const v of this.monsters.values()) out.push({ ...this.center(v), r: 26, color: 0xff2850, intensity: 0.42 });
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
