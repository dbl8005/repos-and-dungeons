import type { Cell } from './walkable.js';

export const WALK_SPEED = 6; // tiles per second
export const CATCHUP_SPEED = 18;
export const CATCHUP_AFTER_MS = 2_000;
export const DASH_AFTER_MS = 5_000;

type Target = { cell: Cell; eventT: number };
export type AnimState = { x: number; y: number; moving: boolean; dashed: boolean; facing: 1 | -1 };

/**
 * Turns a hero's stream of move targets into smooth tile-by-tile walking that never lags far behind:
 * 3× speed past 2 s of lag, and a dash straight to the newest target past 5 s.
 */
export class HeroAnimator {
  private x: number;
  private y: number;
  private queue: Target[] = [];
  private path: Cell[] = [];
  private walkingT = 0;
  private facing: 1 | -1 = 1;

  private speed: number;
  private catchupSpeed: number;
  private catchupAfter: number;
  private dashAfter: number;

  constructor(start: Cell, private walk: (from: Cell, to: Cell) => Cell[] | null, o: { speed?: number; catchupSpeed?: number; catchupAfterMs?: number; dashAfterMs?: number } = {}) {
    [this.x, this.y] = start;
    this.speed = o.speed ?? WALK_SPEED;
    this.catchupSpeed = o.catchupSpeed ?? CATCHUP_SPEED;
    this.catchupAfter = o.catchupAfterMs ?? CATCHUP_AFTER_MS;
    this.dashAfter = o.dashAfterMs ?? DASH_AFTER_MS;
  }

  goTo(cell: Cell, eventT: number): void {
    this.queue.push({ cell, eventT });
  }

  /** Teleport without animation (map replaced, hero first seen). */
  place(cell: Cell): void {
    [this.x, this.y] = cell;
    this.queue = [];
    this.path = [];
  }

  update(dtMs: number, nowT: number): AnimState {
    const oldest = this.path.length ? this.walkingT : this.queue[0]?.eventT;
    if (oldest !== undefined && nowT - oldest > this.dashAfter) {
      const last = this.queue.length ? this.queue[this.queue.length - 1].cell : this.path[this.path.length - 1];
      if (last) return this.jump(last);
    }
    const lag = oldest === undefined ? 0 : nowT - oldest;
    let budget = ((lag > this.catchupAfter ? this.catchupSpeed : this.speed) * dtMs) / 1000;
    let moved = false;
    while (budget > 1e-9) {
      if (!this.path.length) {
        const next = this.queue.shift();
        if (!next) break;
        const from: Cell = [Math.round(this.x), Math.round(this.y)];
        const p = this.walk(from, next.cell);
        if (p === null) {
          // Unreachable: blink there but keep the rest of the queue.
          [this.x, this.y] = next.cell;
          return { x: this.x, y: this.y, moving: this.queue.length > 0, dashed: true, facing: this.facing };
        }
        this.path = p;
        this.walkingT = next.eventT;
        continue;
      }
      const [tx, ty] = this.path[0];
      const dx = tx - this.x, dy = ty - this.y;
      const dist = Math.abs(dx) + Math.abs(dy);
      if (dx) this.facing = dx < 0 ? -1 : 1;
      const step = Math.min(budget, dist);
      if (dist > 0) {
        this.x += (dx / dist) * step;
        this.y += (dy / dist) * step;
        moved = true;
      }
      budget -= step;
      if (step >= dist - 1e-9) {
        [this.x, this.y] = [tx, ty];
        this.path.shift();
      }
    }
    return { x: this.x, y: this.y, moving: moved || this.path.length > 0, dashed: false, facing: this.facing };
  }

  private jump(cell: Cell): AnimState {
    this.place(cell);
    return { x: this.x, y: this.y, moving: false, dashed: true, facing: this.facing };
  }
}
