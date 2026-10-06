import type { GameEvent } from '../../shared/events.js';
import type { Controller } from '../timelapse/controller.js';
import { runExport, type ExportOptions } from '../timelapse/exporter.js';
import { visibleFolderNames } from '../timelapse/privacy.js';

const TICKS = 400;
const COLORS: Partial<Record<GameEvent['kind'], string>> = { move: '#7aa2ff', forge: '#ffd043', hero_joined: '#c9a0ff', compacted: '#9aa0b4' };
const RANK: Partial<Record<GameEvent['kind'], number>> = { move: 1, forge: 2, hero_joined: 3, compacted: 3, test_result: 4 };

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((v) => String(v).padStart(2, '0')).join(':');
};
function el(tag: string, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElement {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

/** Bottom bar: recording clock, event ticks, Timelapse and Export (mockup v3). */
export function mountTimelineBar(c: Controller): void {
  const clock = el('span', { className: 'tl-clock', textContent: '00:00:00' });
  const ticks = el('canvas', { className: 'tl-ticks', width: TICKS, height: 18 }) as HTMLCanvasElement;
  const play = el('button', { className: 'tl-btn', textContent: '▶ Timelapse' }) as HTMLButtonElement;
  const exp = el('button', { className: 'tl-btn alt', textContent: '⤓ Export' }) as HTMLButtonElement;
  const label = el('span', { textContent: 'Recording · ' });
  const bar = el('div', { id: 'timeline', className: 'pn' }, el('span', { className: 'tl-rec' }, el('b'), label, clock), ticks, play, exp);
  document.body.appendChild(bar);
  document.getElementById('hint')?.remove();
  const toast = el('div', { id: 'tl-toast', className: 'pn' });
  toast.hidden = true;
  document.body.appendChild(toast);

  const drawTicks = (playhead: number | null) => {
    const g = ticks.getContext('2d')!;
    g.clearRect(0, 0, TICKS, 18);
    const h = c.history();
    if (h.length) {
      const t0 = h[0].t, span = Math.max(1, h[h.length - 1].t - t0);
      const best: (GameEvent | undefined)[] = new Array(TICKS);
      for (const e of h) {
        const i = Math.min(TICKS - 1, Math.floor(((e.t - t0) / span) * (TICKS - 1)));
        if ((RANK[e.kind] ?? 0) > (RANK[best[i]?.kind as GameEvent['kind']] ?? 0)) best[i] = e;
      }
      best.forEach((e, i) => {
        if (!e) return;
        g.fillStyle = e.kind === 'test_result' ? (e.failed.length ? '#ff4d6d' : '#5fd35f') : COLORS[e.kind] ?? '#555';
        g.fillRect(i, e.kind === 'test_result' ? 1 : 4, 1, e.kind === 'test_result' ? 16 : 10);
      });
    }
    if (playhead !== null) {
      g.fillStyle = '#fff';
      g.fillRect(Math.round(playhead * (TICKS - 1)), 0, 2, 18);
    }
  };

  const refresh = () => {
    const h = c.history();
    label.textContent = c.isTimelapse() ? 'Timelapse · ' : 'Recording · ';
    if (c.isTimelapse()) {
      const p = c.progress();
      clock.textContent = fmt(p.clockMs);
      drawTicks(p.targetMs ? Math.min(1, p.videoMs / p.targetMs) : 0);
    } else {
      clock.textContent = h.length ? fmt(h[h.length - 1].t - h[0].t) : '00:00:00';
      drawTicks(null);
    }
    play.disabled = busy || (!c.hasHistory() && !c.isTimelapse());
    play.title = play.disabled ? 'Nothing to replay yet' : 'Replay this session as a 30 s timelapse (Esc stops)';
    play.textContent = c.isTimelapse() && !busy ? '■ Stop' : '▶ Timelapse';
    exp.disabled = !c.hasHistory() || busy;
  };
  let busy = false;
  setInterval(refresh, 250);

  play.onclick = () => {
    if (c.isTimelapse()) return c.stopTimelapse();
    const h = c.history();
    if (!c.startTimelapse(30_000, () => (toast.hidden = true))) return;
    toast.textContent = `Timelapse · ${Math.max(1, Math.round((h[h.length - 1].t - h[0].t) / 60_000))} min → 30 s · Esc to stop`;
    toast.hidden = false;
  };
  exp.onclick = () => openDialog();

  function openDialog() {
    const live = c.live();
    if (!live) return;
    const radio = (name: string, opts: [string, string][], def: string): HTMLDivElement => {
      const seg = document.createElement('div');
      seg.className = 'seg';
      for (const [v, label] of opts) {
        const input = document.createElement('input');
        Object.assign(input, { type: 'radio', name, value: v, checked: v === def });
        const l = document.createElement('label');
        l.append(input, label);
        seg.appendChild(l);
      }
      return seg;
    };
    const hide = el('input', { type: 'checkbox' }) as HTMLInputElement;
    const sound = el('input', { type: 'checkbox', checked: c.audio.enabled }) as HTMLInputElement;
    const folders = visibleFolderNames(live.map);
    const folderLine = el('div', { className: 'folders', textContent: folders.length ? `Folder names in the video: ${folders.join(', ')}${folders.length >= 12 ? ', …' : ''}` : 'No folder names will be visible.' });
    const progress = el('div', { className: 'progress' }, el('b'));
    progress.hidden = true;
    const status = el('div', { className: 'status' });
    const go = el('button', { className: 'tl-btn', textContent: 'Render' }) as HTMLButtonElement;
    const cancel = el('button', { className: 'tl-btn alt', textContent: 'Cancel' });
    const tip = el('div', { className: 'folders', textContent: 'Keep this tab visible while a video records (background tabs record choppy).' });
    const box = el('div', { id: 'export-dialog', className: 'pn' },
      el('div', { className: 'ttl', textContent: 'Export timelapse' }),
      el('div', { className: 'row' }, el('span', { textContent: 'Format' }), radio('fmt', [['mp4', 'Video'], ['gif', 'GIF']], 'mp4')),
      el('div', { className: 'row' }, el('span', { textContent: 'Size' }), radio('size', [['square', 'Square 1080'], ['wide', 'Wide 1920×1080']], 'square')),
      el('div', { className: 'row' }, el('span', { textContent: 'Length' }), radio('len', [['15', '15 s'], ['30', '30 s'], ['60', '60 s']], '30')),
      el('label', { className: 'check' }, hide, 'Hide folder names (Room 1, Room 2…) and speech bubbles'),
      ...(c.audio.enabled ? [el('label', { className: 'check' }, sound, 'Include sound (video only)')] : []),
      folderLine, tip, progress, status,
      el('div', { className: 'actions' }, cancel, go));
    const shade = el('div', { id: 'export-shade' }, box);
    document.body.appendChild(shade);
    hide.onchange = () => {
      folderLine.style.opacity = hide.checked ? '.35' : '1';
    };
    let abort: AbortController | null = null;
    const close = () => { abort?.abort(); shade.remove(); };
    cancel.onclick = close;
    // Block body on purpose: an on* handler that returns false cancels the click (and breaks the radios inside).
    shade.onclick = (e) => {
      if (e.target === shade && !busy) close();
    };
    go.onclick = async () => {
      const val = (n: string) => (box.querySelector(`input[name=${n}]:checked`) as HTMLInputElement).value;
      const o: ExportOptions = {
        format: val('fmt') as 'mp4' | 'gif', size: val('size') as 'square' | 'wide', seconds: Number(val('len')) as 15 | 30 | 60,
        hideNames: hide.checked, sound: sound.checked && c.audio.enabled,
        onProgress: (f) => ((progress.firstChild as HTMLElement).style.width = `${Math.round(f * 100)}%`),
      };
      abort = new AbortController();
      o.signal = abort.signal;
      busy = true;
      go.disabled = true;
      progress.hidden = false;
      status.textContent = o.format === 'gif' ? 'Rendering GIF…' : `Recording ${o.seconds} s of video…`;
      try {
        const { blob, ext } = await runExport(c, o);
        const d = new Date();
        const name = `repos-and-dungeons-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.${ext}`;
        const url = URL.createObjectURL(blob);
        const a = el('a', { href: url, download: name, textContent: `Download again (${(blob.size / 1e6).toFixed(1)} MB)` }) as HTMLAnchorElement;
        status.replaceChildren(`Saved ${name} ✓ `, a);
        a.click();
        cancel.textContent = 'Close';
      } catch (err) {
        status.textContent = (err as Error).name === 'AbortError' ? 'Cancelled.' : `Export failed: ${(err as Error).message}`;
      } finally {
        busy = false;
        go.disabled = false;
        abort = null;
      }
    };
  }
}
