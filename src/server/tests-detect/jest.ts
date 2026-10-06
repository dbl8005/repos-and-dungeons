import { count, uniqueFailures, type RunnerDetector } from './types.js';
import type { TestFailure } from '../../shared/events.js';

export const jest: RunnerDetector = (out) => {
  const summary = out.match(/^Tests:\s+(.*total)\s*$/m);
  if (!summary) return null;
  const failed: TestFailure[] = [];
  let file: string | undefined;
  for (const line of out.split('\n')) {
    const f = line.match(/^(FAIL|PASS)\s+(\S+)/);
    if (f) { file = f[1] === 'FAIL' ? f[2] : undefined; continue; }
    const t = line.match(/^\s+●\s+(.+?)\s*$/);
    if (t && file) failed.push({ file, name: t[1] });
  }
  return { runner: 'jest', failed: uniqueFailures(failed), passed: count(summary[1], /(\d+) passed/) };
};
