import { uniqueFailures, type RunnerDetector } from './types.js';

export const go: RunnerDetector = (out) => {
  if (!/^(--- (FAIL|PASS):|ok\s+\S+\s+[\d.]+s|FAIL\s+\S+\s+[\d.]+s)/m.test(out)) return null;
  const failed = [...out.matchAll(/^\s*--- FAIL: (\S+)/gm)].map((m) => ({ name: m[1] }));
  const passed = (out.match(/^\s*--- PASS: /gm) ?? []).length;
  return { runner: 'go', failed: uniqueFailures(failed), passed };
};
