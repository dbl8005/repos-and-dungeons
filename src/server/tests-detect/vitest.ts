import { count, uniqueFailures, type RunnerDetector } from './types.js';

export const vitest: RunnerDetector = (out) => {
  const summary = out.match(/^\s*Tests\s+(.*\(\d+\))\s*$/m);
  if (!summary || !/^\s*Test Files\s/m.test(out)) return null;
  const failed = [...out.matchAll(/^\s*FAIL\s+(\S+)\s+>\s+(.+?)\s*$/gm)].map((m) => ({ file: m[1], name: m[2] }));
  return { runner: 'vitest', failed: uniqueFailures(failed), passed: count(summary[1], /(\d+) passed/) };
};
