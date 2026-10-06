/** If the scheduler fell behind (throttled tab, long stall), skip the missed beats instead of playing them at once. */
export function catchUpBeat(nextBeat: number, now: number): number {
  return nextBeat < now - 0.1 ? now + 0.05 : nextBeat;
}
