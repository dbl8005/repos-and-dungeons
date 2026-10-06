import type { HeroClass, HeroId } from '../../shared/events.js';
import type { GameState } from '../../shared/reducer.js';
import { CLASS_NAME_COLORS, SPRITE_PALETTES } from '../art/palette.js';
import { SPRITES, spriteToRGBA } from '../art/sprites.js';
import { partyRows, stableOrder, torchPct, type PartyRow } from './hud-model.js';

const NAMES: Record<HeroClass, string> = { knight: 'Opus', squire: 'Sonnet', scout: 'Haiku', wizard: 'Fable', adventurer: 'Adventurer' };
const CLASS_LABEL: Record<HeroClass, string> = { knight: 'knight', squire: 'squire', scout: 'scout', wizard: 'wizard', adventurer: 'adventurer' };
const MAX_CARDS = 4;

const portraits = new Map<HeroClass, string>();
function portrait(c: HeroClass): string {
  let url = portraits.get(c);
  if (!url) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 16;
    cv.getContext('2d')!.putImageData(new ImageData(spriteToRGBA(SPRITES[c], SPRITE_PALETTES[c], 16) as Uint8ClampedArray<ArrayBuffer>, 16, 16), 0, 0);
    url = cv.toDataURL();
    portraits.set(c, url);
  }
  return url;
}

/** Party cards and torch/stamina meters (mockup v3 layout). Built with DOM APIs, never innerHTML from data. */
export class Hud {
  private party = document.getElementById('party')!;
  private meters = document.getElementById('meters')!;
  private logEl = document.getElementById('log')!;
  private cards = new Map<HeroId, HTMLElement>();
  private order: HeroId[] = [];
  private more = Object.assign(document.createElement('div'), { className: 'hero pn more' });
  private moreList = Object.assign(document.createElement('div'), { className: 'more-list pn' });

  constructor(private onPick: (hero: HeroId) => void) {
    this.meters.innerHTML = `
      <div class="mrow"><span class="ttl">🔥 Torch</span><span class="v" id="torch-v">—</span></div>
      <div class="gbar"><b id="torch-b" style="width:0;background:linear-gradient(90deg,#ff5a1f,#ffc04a)"></b></div>
      <div class="sub" id="torch-s">Context window · compaction brings the fog back</div>
      <div class="mrow"><span class="ttl">⚡ Stamina</span><span class="v" id="stam-v">—</span></div>
      <div class="gbar"><b id="stam-b" style="width:0;background:linear-gradient(90deg,#2fa36b,#8ff0b8)"></b></div>
      <div class="sub" id="stam-s" style="margin-bottom:0">Plan usage · estimated</div>`;
  }

  update(s: GameState, followed: HeroId | null, locked: HeroId | null): void {
    const byId = new Map(partyRows(s).map((r) => [r.id, r]));
    this.order = stableOrder(this.order, [...byId.keys()]);
    // Followed hero always gets a visible card; the rest keep their places so cards never jump under the cursor.
    const visible = this.order.slice(0, MAX_CARDS);
    if (followed && byId.has(followed) && !visible.includes(followed)) visible[MAX_CARDS - 1] = followed;
    for (const [id, el] of this.cards) if (!byId.has(id)) { el.remove(); this.cards.delete(id); }
    visible.forEach((id, i) => {
      const r = byId.get(id)!;
      let el = this.cards.get(id);
      if (!el) {
        el = this.card(r);
        this.cards.set(id, el);
      }
      this.fill(el, r, id === followed, id === locked);
      if (this.party.children[i] !== el) this.party.insertBefore(el, this.party.children[i] ?? null);
    });
    for (const [id, el] of this.cards) if (!visible.includes(id) && el.parentElement) el.remove();
    const hidden = this.order.filter((id) => !visible.includes(id));
    if (hidden.length) {
      this.more.textContent = `+${hidden.length} more`;
      this.more.onclick = (e) => { e.stopPropagation(); this.moreList.hidden = !this.moreList.hidden; };
      this.moreList.replaceChildren(...hidden.map((id) => {
        const r = byId.get(id)!;
        const item = Object.assign(document.createElement('div'), { textContent: `${NAMES[r.heroClass]} · ${r.label} — ${r.status}` });
        item.onclick = () => { this.onPick(id); this.moreList.hidden = true; };
        return item;
      }));
      if (!this.more.parentElement) this.party.appendChild(this.more);
      else this.party.appendChild(this.more);
      if (!this.moreList.parentElement) { this.moreList.hidden = true; document.body.appendChild(this.moreList); }
    } else {
      this.more.remove();
      this.moreList.hidden = true;
    }
    const h = followed ? s.heroes[followed] : undefined;
    const tp = h ? torchPct(h.torch) : null;
    this.set('torch-v', tp === null ? '—' : `${tp}%`);
    (document.getElementById('torch-b') as HTMLElement).style.width = `${tp ?? 0}%`;
    this.set('torch-s', h ? `${NAMES[h.heroClass]}'s context · compaction brings the fog back` : 'Context window · compaction brings the fog back');
    const st = s.stamina;
    this.set('stam-v', st ? `${Math.max(0, 100 - st.fiveHourPct)}%` : '—');
    (document.getElementById('stam-b') as HTMLElement).style.width = `${st ? Math.max(0, 100 - st.fiveHourPct) : 0}%`;
    if (st) this.set('stam-s', `5-hour limit${st.resetsAt ? ` · resets ${new Date(st.resetsAt * 1000).toTimeString().slice(0, 5)}` : ''} · weekly ${Math.max(0, 100 - st.weeklyPct)}%`);
  }

  log(lines: string[]): void {
    this.logEl.replaceChildren(...lines.slice(0, 3).map((l) => Object.assign(document.createElement('div'), { textContent: l })));
    this.logEl.style.display = lines.length ? '' : 'none';
  }

  /** Builds a card once; `fill` updates its text in place. */
  private card(r: PartyRow): HTMLElement {
    const el = document.createElement('div');
    el.className = 'hero pn';
    el.onclick = () => this.onPick(r.id);
    const img = document.createElement('canvas');
    img.width = img.height = 16;
    const im = new Image();
    im.onload = () => img.getContext('2d')!.drawImage(im, 0, 0);
    im.src = portrait(r.heroClass);
    const text = document.createElement('div');
    text.style.minWidth = '0';
    const nm = Object.assign(document.createElement('div'), { className: 'nm' });
    const cls = Object.assign(document.createElement('div'), { className: 'cls' });
    const st = Object.assign(document.createElement('div'), { className: 'st' });
    const bar = document.createElement('div');
    bar.className = 'tbar';
    bar.appendChild(document.createElement('b'));
    const kids = Object.assign(document.createElement('div'), { className: 'kids' });
    text.append(nm, cls, st, bar, kids);
    el.append(img, text);
    el.dataset.cls = r.heroClass;
    return el;
  }

  private fill(el: HTMLElement, r: PartyRow, active: boolean, locked: boolean) {
    el.className = `hero pn${active ? ' active' : ''}${locked ? ' locked' : ''}`;
    const q = (c: string) => el.querySelector(`.${c}`) as HTMLElement;
    const setText = (c: string, t: string) => { if (q(c).textContent !== t) q(c).textContent = t; };
    setText('nm', NAMES[r.heroClass]);
    q('nm').style.color = CLASS_NAME_COLORS[r.heroClass];
    setText('cls', `${CLASS_LABEL[r.heroClass]} · ${r.label}`);
    setText('st', r.status);
    (el.querySelector('.tbar b') as HTMLElement).style.width = `${r.torchPct}%`;
    setText('kids', r.children.length ? `+ ${r.children.length} subagent${r.children.length > 1 ? 's' : ''}: ${r.children.map((c) => NAMES[c.heroClass]).join(', ')}` : '');
    if (el.dataset.cls !== r.heroClass) {
      el.dataset.cls = r.heroClass;
      const img = el.querySelector('canvas')!;
      const im = new Image();
      im.onload = () => { const g = img.getContext('2d')!; g.clearRect(0, 0, 16, 16); g.drawImage(im, 0, 0); };
      im.src = portrait(r.heroClass);
    }
  }

  private set(id: string, text: string) {
    const e = document.getElementById(id);
    if (e && e.textContent !== text) e.textContent = text;
  }
}
