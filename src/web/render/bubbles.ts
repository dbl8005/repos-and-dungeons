import type { HeroId } from '../../shared/events.js';
import { lastMonsterOf, type GameState } from '../../shared/reducer.js';
import { CLASS_NAME_COLORS } from '../art/palette.js';

const SHOW_MS = 5_000;
const MAX_VISIBLE = 3;
const TYPE_MS = 30;
const NAMES = { knight: 'OPUS', squire: 'SONNET', scout: 'HAIKU', wizard: 'FABLE', adventurer: 'ADVENTURER' } as const;

type Bubble = { key: string; who: string; color: string; text: string; t: number; taunt: boolean; pos: { x: number; y: number } };
type Pos = (id: HeroId) => { x: number; y: number } | null;

/** HTML speech bubbles (mockup v3 style) that follow heroes and monsters, typing their line out. */
export class BubbleLayer {
  private els = new Map<string, HTMLDivElement>();

  constructor(private root: HTMLElement) {}

  update(s: GameState, now: number, heroPos: Pos, monsterPos: Pos, screenW: number): void {
    const list: Bubble[] = [];
    for (const h of Object.values(s.heroes)) {
      if (!h.speech || now - h.speech.t > SHOW_MS) continue;
      const pos = heroPos(h.id);
      if (pos) list.push({ key: h.id, who: NAMES[h.heroClass], color: CLASS_NAME_COLORS[h.heroClass], text: h.speech.text, t: h.speech.t, taunt: false, pos });
    }
    for (const [hero, tt] of Object.entries(s.taunts)) {
      if (now - tt.t > SHOW_MS) continue;
      const pos = monsterPos(hero);
      if (pos) list.push({ key: `monster:${hero}`, who: (lastMonsterOf(s, hero)?.species ?? 'slime').toUpperCase(), color: '#ff6b81', text: tt.text, t: tt.t, taunt: true, pos });
    }
    const shown = list.sort((a, b) => b.t - a.t).slice(0, MAX_VISIBLE);
    const keep = new Set(shown.map((b) => b.key));
    for (const [k, el] of this.els) if (!keep.has(k)) { el.remove(); this.els.delete(k); }
    for (const b of shown) {
      let el = this.els.get(b.key);
      if (!el) {
        el = document.createElement('div');
        el.append(Object.assign(document.createElement('span'), { className: 'who' }), Object.assign(document.createElement('span'), { className: 'text' }));
        this.root.appendChild(el);
        this.els.set(b.key, el);
      }
      el.className = `bubble${b.taunt ? ' taunt' : ''}`;
      const who = el.firstChild as HTMLSpanElement;
      who.textContent = b.who;
      who.style.color = b.color;
      const typed = b.text.slice(0, Math.max(0, Math.floor((now - b.t) / TYPE_MS)) + 1);
      const text = el.lastChild as HTMLSpanElement;
      if (text.textContent !== typed) text.textContent = typed;
      el.style.opacity = String(Math.min(1, (SHOW_MS - (now - b.t)) / 400));
      el.dataset.side = b.pos.x < screenW * 0.25 ? 'left' : b.pos.x > screenW * 0.75 ? 'right' : 'center';
      el.dataset.below = String(b.pos.y < 190); // too close to the top HUD: show under the speaker instead
      el.style.left = `${Math.round(b.pos.x)}px`;
      el.style.top = `${Math.round(b.pos.y)}px`;
    }
  }
}
