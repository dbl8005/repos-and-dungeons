import type { TestFailure } from '../../shared/events.js';

export type TestRun = { runner: string; failed: TestFailure[]; passed: number };
/** Returns null when the output doesn't look like this runner's. */
export type RunnerDetector = (output: string) => TestRun | null;

export function count(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? Number(m[1]) : 0;
}

export function uniqueFailures(list: TestFailure[]): TestFailure[] {
  const seen = new Set<string>();
  return list.filter((f) => {
    const k = `${f.file ?? ''}::${f.name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
