import type { GameEvent } from '../../shared/events.js';
import type { DungeonMap, PathIndex } from '../../shared/map-types.js';
import { initialState, reduce, type GameState } from '../../shared/reducer.js';
import { buildTimeline, type Timeline } from './timeline.js';

/**
 * Replays a session into its own GameState over `targetMs` of video. Events come out re-timed to video ms
 * (`t = at[i]`), so animation, bubbles and effects can simply run on the video clock.
 */
export class Timelapse {
  readonly state: GameState;
  private tl: Timeline;
  private i = 0;

  constructor(map: DungeonMap, index: PathIndex, events: GameEvent[], readonly targetMs: number) {
    this.state = initialState(map, index);
    this.tl = buildTimeline([...events], targetMs); // own copy: the live history keeps changing
  }

  get isEmpty(): boolean {
    return this.tl.events.length === 0;
  }

  get sessionMs(): number {
    return this.tl.sessionMs;
  }

  /**
   * Feeds every event up to `videoMs`; returns them (re-timed) plus progress. `onEvent` runs right after each
   * event is applied, so effects see that event's positions (not the end of the batch).
   */
  advance(videoMs: number, onEvent?: (e: GameEvent, s: GameState, monstersBefore: GameState['monsters']) => void): { fed: GameEvent[]; done: boolean; sessionMs: number; clockMs: number } {
    const fed: GameEvent[] = [];
    const { events, at } = this.tl;
    while (this.i < events.length && at[this.i] <= videoMs) {
      const e = { ...events[this.i], t: Math.round(at[this.i]) } as GameEvent;
      const before = this.state.monsters;
      reduce(this.state, e);
      onEvent?.(e, this.state, before);
      fed.push(e);
      this.i++;
    }
    return { fed, done: videoMs >= this.targetMs, sessionMs: this.tl.sessionMs, clockMs: this.tl.clock(videoMs) };
  }
}
