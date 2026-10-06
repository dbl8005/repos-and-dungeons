import type { CueName } from './planner.js';

/** Short synthesized effects. `out` is the effects bus; every call schedules nodes that clean themselves up. */
export class Sfx {
  private noise: AudioBuffer;

  constructor(private ctx: AudioContext, private out: AudioNode) {
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  play(name: CueName, pitch = 1, volume = 1): void {
    const t = this.ctx.currentTime + 0.005;
    const p = pitch * (0.92 + Math.random() * 0.16);
    const v = volume * (0.85 + Math.random() * 0.3);
    this[name](t, p, v);
  }

  private env(t: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.out);
    return g;
  }

  private tone(t: number, type: OscillatorType, f0: number, f1: number, dur: number, gain: GainNode | AudioNode) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    o.connect(gain);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private hiss(t: number, dur: number, type: BiquadFilterType, f0: number, f1: number, q: number, gain: AudioNode) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    s.connect(f).connect(gain);
    s.start(t, Math.random() * 0.5, dur + 0.05);
  }

  private step(t: number, p: number, v: number) { this.hiss(t, 0.07, 'lowpass', 500 * p, 300 * p, 1, this.env(t, 0.35 * v, 0.004, 0.07)); }
  private page(t: number, p: number, v: number) { this.hiss(t, 0.14, 'highpass', 2500 * p, 5000 * p, 0.7, this.env(t, 0.12 * v, 0.02, 0.12)); }
  private whoosh(t: number, p: number, v: number) { this.hiss(t, 0.45, 'bandpass', 300 * p, 2200 * p, 2, this.env(t, 0.3 * v, 0.12, 0.33)); }
  private anvil(t: number, p: number, v: number) {
    for (const [f, a] of [[880, 0.25], [2420, 0.12], [3720, 0.07]] as const) this.tone(t, 'sine', f * p, f * p, 0.9, this.env(t, a * v, 0.002, 0.9));
    this.hiss(t, 0.03, 'highpass', 3000, 3000, 0.5, this.env(t, 0.25 * v, 0.001, 0.03));
  }
  private sparkle(t: number, p: number, v: number) {
    [1047, 1319, 1568, 2093].forEach((f, i) => this.tone(t + i * 0.06, 'triangle', f * p, f * p, 0.25, this.env(t + i * 0.06, 0.12 * v, 0.004, 0.25)));
  }
  private shimmer(t: number, p: number, v: number) {
    this.tone(t, 'sine', 660 * p, 990 * p, 0.6, this.env(t, 0.12 * v, 0.08, 0.5));
    this.tone(t, 'triangle', 1320 * p, 1980 * p, 0.6, this.env(t, 0.05 * v, 0.1, 0.5));
  }
  private squelch(t: number, p: number, v: number) {
    this.tone(t, 'sine', 320 * p, 55 * p, 0.4, this.env(t, 0.4 * v, 0.01, 0.4));
    this.hiss(t, 0.35, 'lowpass', 900, 200, 4, this.env(t, 0.2 * v, 0.02, 0.33));
    this.tone(t + 0.15, 'sawtooth', 70 * p, 55 * p, 0.35, this.env(t + 0.15, 0.08 * v, 0.05, 0.3));
  }
  private hit(t: number, p: number, v: number) {
    this.hiss(t, 0.09, 'highpass', 1200, 800, 0.8, this.env(t, 0.4 * v, 0.002, 0.09));
    this.tone(t, 'square', 1300 * p, 500 * p, 0.07, this.env(t, 0.1 * v, 0.002, 0.07));
  }
  private coins(t: number, p: number, v: number) {
    [1568, 2093, 2637].forEach((f, i) => this.tone(t + 0.08 + i * 0.08, 'triangle', f * p, f * p, 0.3, this.env(t + 0.08 + i * 0.08, 0.13 * v, 0.003, 0.3)));
  }
  private chains(t: number, p: number, v: number) {
    for (let i = 0; i < 6; i++) {
      const at = t + i * 0.05 + Math.random() * 0.02, f = (1800 + Math.random() * 1600) * p;
      this.tone(at, 'square', f, f * 0.8, 0.04, this.env(at, 0.05 * v, 0.001, 0.04));
    }
  }
  private creak(t: number, p: number, v: number) {
    const g = this.env(t, 0.12 * v, 0.1, 0.6);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700;
    f.Q.value = 8;
    f.connect(g);
    this.tone(t, 'sawtooth', 110 * p, 190 * p, 0.7, f);
  }
  private horn(t: number, p: number, v: number) {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    lp.connect(this.env(t, 0.16 * v, 0.06, 0.7));
    this.tone(t, 'sawtooth', 220 * p, 220 * p, 0.28, lp);
    this.tone(t + 0.28, 'sawtooth', 330 * p, 330 * p, 0.45, lp);
  }
  private blip(t: number, p: number, v: number) { this.tone(t, 'square', 620 * p, 700 * p, 0.04, this.env(t, 0.05 * v, 0.003, 0.04)); }
  private wind(t: number, p: number, v: number) { this.hiss(t, 1.6, 'bandpass', 250 * p, 900 * p, 3, this.env(t, 0.25 * v, 0.6, 1.0)); }
  private victory(t: number, p: number, v: number) {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(t + i * 0.12, 'triangle', f * p, f * p, 0.5, this.env(t + i * 0.12, 0.14 * v, 0.005, 0.5)));
    [523, 659, 784].forEach((f) => this.tone(t + 0.5, 'sine', f * p, f * p, 1.0, this.env(t + 0.5, 0.06 * v, 0.05, 1.0)));
  }
}
