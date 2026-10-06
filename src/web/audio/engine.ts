import { Music } from './music.js';
import type { SoundCue } from './planner.js';
import { Sfx } from './sfx.js';

export type Volumes = { master: number; music: number; sfx: number };
export type SoundSettings = Volumes & { enabled: boolean };
const KEY = 'rd-sound';
export const DEFAULT_SOUND: SoundSettings = { enabled: false, master: 0.7, music: 0.5, sfx: 0.8 };

export function loadSoundSettings(): SoundSettings {
  try {
    return { ...DEFAULT_SOUND, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_SOUND };
  }
}

/**
 * Sound for the dungeon. The AudioContext is created on the first enable (a user click), as browsers require.
 * Graph: music + effects → master → compressor → speakers, with a small generated reverb for the dungeon feel.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private music!: Music;
  private sfx!: Sfx;
  settings: SoundSettings = loadSoundSettings();

  get enabled(): boolean {
    return this.settings.enabled;
  }

  setEnabled(on: boolean): void {
    this.settings.enabled = on;
    this.save();
    if (on) {
      this.ensure();
      void this.ctx!.resume();
      this.music.start();
      this.applyVolumes();
    } else if (this.ctx) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      this.music.stop();
    }
  }

  setVolumes(v: Partial<Volumes>): void {
    Object.assign(this.settings, v);
    this.save();
    this.applyVolumes();
  }

  play(cue: SoundCue): void {
    if (this.settings.enabled && this.ctx) this.sfx.play(cue.name, cue.pitch ?? 1);
  }

  /** The mixed output as a MediaStream for recording, plus `release()` to disconnect it; null before sound was on. */
  captureStream(): { stream: MediaStream; release(): void } | null {
    if (!this.ctx) return null;
    const dest = this.ctx.createMediaStreamDestination();
    this.master.connect(dest);
    return {
      stream: dest.stream,
      release: () => {
        this.master.disconnect(dest);
        dest.stream.getTracks().forEach((t) => t.stop());
      },
    };
  }

  setCombat(level: number): void {
    if (this.ctx) this.music.setCombat(level);
  }

  private ensure() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    const reverb = ctx.createConvolver();
    reverb.buffer = this.impulse(2.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.28;
    reverb.connect(wet).connect(this.master);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    for (const b of [this.musicBus, this.sfxBus]) {
      b.connect(this.master);
      b.connect(reverb);
    }
    this.music = new Music(ctx, this.musicBus);
    this.sfx = new Sfx(ctx, this.sfxBus);
  }

  private impulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return b;
  }

  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.enabled ? this.settings.master : 0, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.settings.music, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.settings.sfx, t, 0.05);
  }

  /** While a saved "on" waits for the first click, keep saving it as on (volume changes must not lose it). */
  persistOn = false;

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...this.settings, enabled: this.settings.enabled || this.persistOn }));
    } catch {
      // private mode: settings just don't persist
    }
  }
}
