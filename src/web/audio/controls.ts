import type { AudioEngine } from './engine.js';
import { SoundToggle } from './toggle-state.js';

/** Speaker button, volume popover and the M key. Sound stays off until the user turns it on. */
export function mountSoundControls(engine: AudioEngine): void {
  const box = document.getElementById('sound')!;
  const btn = document.getElementById('snd')!;
  const more = document.getElementById('snd-more')!;
  const mixer = document.getElementById('mixer')!;
  const state = new SoundToggle(engine.enabled);
  engine.settings.enabled = false; // nothing plays before a click
  engine.persistOn = state.pending;
  const render = () => {
    btn.textContent = state.enabled ? '🔊' : '🔇';
    box.classList.toggle('on', state.enabled);
    box.classList.toggle('pending', state.pending);
  };
  const toggle = () => {
    engine.persistOn = false;
    engine.setEnabled(state.toggle());
    render();
  };
  btn.onclick = toggle;
  more.onclick = () => {
    mixer.hidden = !mixer.hidden;
  };
  for (const input of mixer.querySelectorAll('input')) {
    const k = input.dataset.k as 'master' | 'music' | 'sfx';
    input.value = String(engine.settings[k]);
    input.oninput = () => engine.setVolumes({ [k]: Number(input.value) });
  }
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'm' || e.key === 'M') && !(e.target instanceof HTMLInputElement)) toggle();
  });
  window.addEventListener('pointerdown', (ev) => {
    if (ev.target === btn) return; // the button's own click handles it
    if (state.firstClick()) {
      engine.persistOn = false;
      engine.setEnabled(true);
      render();
    }
  });
  render();
}
