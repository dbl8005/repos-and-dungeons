import type { DungeonMap } from '../../shared/map-types.js';
import { searchRooms, type SearchHit } from './hud-model.js';

/** "/" opens a jump-to-folder box; Enter flies the camera there. */
export class Search {
  private box = document.getElementById('search')!;
  private input: HTMLInputElement;
  private list: HTMLUListElement;
  private hits: SearchHit[] = [];
  private sel = 0;

  constructor(private getMap: () => DungeonMap | null, private onJump: (hit: SearchHit) => void) {
    this.input = Object.assign(document.createElement('input'), { placeholder: 'Jump to folder…' });
    this.list = document.createElement('ul');
    this.box.append(this.input, this.list);
    this.input.addEventListener('input', () => this.refresh());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') this.sel = Math.min(this.hits.length - 1, this.sel + 1);
      else if (e.key === 'ArrowUp') this.sel = Math.max(0, this.sel - 1);
      else if (e.key === 'Enter' && this.hits[this.sel]) { this.onJump(this.hits[this.sel]); this.close(); return; }
      else if (e.key === 'Escape') { this.close(); return; }
      else return;
      e.preventDefault();
      this.render();
    });
  }

  get isOpen(): boolean {
    return !this.box.hidden;
  }

  open(): void {
    this.box.hidden = false;
    this.input.value = '';
    this.refresh();
    this.input.focus();
  }

  close(): void {
    this.box.hidden = true;
    this.input.blur();
  }

  private refresh() {
    const map = this.getMap();
    this.hits = map ? searchRooms(map, this.input.value) : [];
    this.sel = 0;
    this.render();
  }

  private render() {
    this.list.replaceChildren(...this.hits.map((h, i) => {
      const li = Object.assign(document.createElement('li'), { textContent: h.path ? `${h.path}/` : '/ (root)' });
      if (i === this.sel) li.className = 'sel';
      li.onclick = () => { this.onJump(h); this.close(); };
      return li;
    }));
  }
}
