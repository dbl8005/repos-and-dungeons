import { catchUpBeat } from './music-clock.js';

/**
 * Generated dungeon music: a slow minor-key pad and plucked-lute arpeggio (explore layer) plus low drums and
 * tremolo strings (combat layer). Scheduled ahead with a small lookahead loop.
 */
const BPM = 72;
const BEAT = 60 / BPM;
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
// Am – F – C – G, then Am – Dm – E – Am (one chord per bar of 4 beats).
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62], [57, 60, 64], [50, 53, 57], [52, 56, 59], [57, 60, 64]];
const ARP = [0, 1, 2, 1, 0, 2, 1, 2];

export class Music {
  readonly explore: GainNode;
  readonly combat: GainNode;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextBeat = 0;
  private beat = 0;
  private noise: AudioBuffer;

  constructor(private ctx: AudioContext, out: AudioNode) {
    this.explore = ctx.createGain();
    this.combat = ctx.createGain();
    this.combat.gain.value = 0;
    this.explore.connect(out);
    this.combat.connect(out);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  start(): void {
    if (this.timer) return;
    this.nextBeat = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 50);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setCombat(level: number): void {
    this.combat.gain.setTargetAtTime(level, this.ctx.currentTime, 0.4);
  }

  private schedule() {
    this.nextBeat = catchUpBeat(this.nextBeat, this.ctx.currentTime);
    while (this.nextBeat < this.ctx.currentTime + 0.25) {
      this.playBeat(this.beat, this.nextBeat);
      this.nextBeat += BEAT / 2; // eighth notes
      this.beat++;
    }
  }

  private playBeat(i: number, t: number) {
    const bar = Math.floor(i / 8) % CHORDS.length;
    const chord = CHORDS[bar];
    if (i % 8 === 0) {
      for (const n of chord) this.pad(midi(n - 12), t, BEAT * 4);
      this.drone(midi(chord[0] - 24), t, BEAT * 4);
    }
    this.pluck(midi(chord[ARP[i % 8]] + (i % 16 >= 8 ? 12 : 0)), t);
    // combat layer
    if (i % 4 === 0) this.kick(t);
    if (i % 8 === 6) this.tom(t, 90);
    if (i % 8 === 7) this.tom(t, 70);
    if (i % 2 === 0) this.strings(midi(chord[0] - 12), t, BEAT / 2);
    if (i % 4 === 2) this.crackle(t);
  }

  private voice(type: OscillatorType, f: number, t: number, dur: number, peak: number, attack: number, out: AudioNode, cutoff: number) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  private pad(f: number, t: number, dur: number) {
    this.voice('sawtooth', f, t, dur, 0.035, 0.8, this.explore, 700).detune.value = -6;
    this.voice('sawtooth', f, t, dur, 0.035, 0.8, this.explore, 700).detune.value = 7;
  }
  private drone(f: number, t: number, dur: number) { this.voice('sine', f, t, dur, 0.08, 0.5, this.explore, 400); }
  private pluck(f: number, t: number) { this.voice('triangle', f, t, 0.6, 0.07, 0.005, this.explore, 2600); }
  private strings(f: number, t: number, dur: number) { this.voice('sawtooth', f, t, dur, 0.05, 0.03, this.combat, 1100); }
  private kick(t: number) {
    const o = this.voice('sine', 120, t, 0.35, 0.5, 0.003, this.combat, 2000);
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.3);
  }
  private tom(t: number, f: number) {
    const o = this.voice('sine', f * 1.6, t, 0.3, 0.25, 0.003, this.combat, 1500);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.25);
  }
  /** Quiet torch crackle under the explore layer. */
  private crackle(t: number) {
    for (let k = 0; k < 3; k++) {
      if (Math.random() < 0.4) continue;
      const at = t + Math.random() * BEAT;
      const s = this.ctx.createBufferSource();
      s.buffer = this.noise;
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1500 + Math.random() * 2500;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.02 + Math.random() * 0.02, at + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
      s.connect(f).connect(g).connect(this.explore);
      s.start(at, Math.random() * 0.8, 0.05);
    }
  }
}
