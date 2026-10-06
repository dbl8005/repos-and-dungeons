import type { GameEvent } from '../../shared/events.js';

export type Timeline = {
  events: GameEvent[];
  /** Video time (ms) of each event. */
  at: number[];
  /** Real session duration (ms). */
  sessionMs: number;
  /** Video time → real session time elapsed, for the on-screen clock. */
  clock: (videoMs: number) => number;
};

/**
 * Lays the session out over `targetMs` of video. Gaps between events count for at most `maxGapMs` (idle stretches
 * are squeezed), the last event lands at `endAt` of the video, and the rest holds the final state.
 */
export function buildTimeline(input: GameEvent[], targetMs: number, o: { maxGapMs?: number; endAt?: number } = {}): Timeline {
  const maxGap = o.maxGapMs ?? 1500;
  const endAt = o.endAt ?? 0.92;
  let events = input;
  for (let i = 1; i < input.length; i++)
    if (input[i].t < input[i - 1].t) {
      events = [...input].sort((a, b) => a.t - b.t);
      break;
    }
  const n = events.length;
  if (!n) return { events, at: [], sessionMs: 0, clock: () => 0 };
  const c = new Float64Array(n);
  for (let i = 1; i < n; i++) c[i] = c[i - 1] + Math.min(events[i].t - events[i - 1].t, maxGap);
  const total = c[n - 1];
  const scale = total > 0 ? (endAt * targetMs) / total : 0;
  const at = Array.from(c, (v) => v * scale);
  const t0 = events[0].t;
  const sessionMs = events[n - 1].t - t0;
  const clock = (videoMs: number) => {
    if (scale === 0) return 0;
    const pos = videoMs / scale;
    if (pos >= total) return sessionMs;
    if (pos <= 0) return 0;
    let lo = 0, hi = n - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid] <= pos) lo = mid;
      else hi = mid;
    }
    const span = c[hi] - c[lo];
    const frac = span > 0 ? (pos - c[lo]) / span : 0;
    return events[lo].t - t0 + frac * (events[hi].t - events[lo].t);
  };
  return { events, at, sessionMs, clock };
}
