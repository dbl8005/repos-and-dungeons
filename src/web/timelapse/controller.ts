import type { Application } from 'pixi.js';
import type { GameEvent } from '../../shared/events.js';
import type { GameState } from '../../shared/reducer.js';
import type { AudioEngine } from '../audio/engine.js';

export type OverlayBubble = { who: string; color: string; text: string; x: number; y: number };

/** What the timelapse UI and exporter can do with the running dungeon view. */
export type Controller = {
  app: Application;
  audio: AudioEngine;
  hasHistory(): boolean;
  isTimelapse(): boolean;
  live(): GameState | null;
  history(): GameEvent[];
  /** Starts playback over `targetMs` of video; false when there is nothing to replay. */
  startTimelapse(targetMs: number, onEnd?: () => void): boolean;
  stopTimelapse(onEnd?: () => void): void;
  progress(): { videoMs: number; targetMs: number; clockMs: number };
  overlay(): { clockMs: number; explored: number; bubbles: OverlayBubble[] };
  /** Advances and draws one frame of `dt` ms (used by the exporter with the ticker stopped). */
  frame(dt: number): void;
  setLabelAliases(aliases: Map<string, string> | null): void;
  /** While true, Esc can't stop the timelapse (the export owns it). */
  setExporting(on: boolean): void;
};
