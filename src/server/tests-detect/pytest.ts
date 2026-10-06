import { count, uniqueFailures, type RunnerDetector } from './types.js';

export const pytest: RunnerDetector = (out) => {
  const summary = out.match(/^=*\s*((?:\d+ \w+(?:, )?)+) in [\d.]+s\b.*$/m);
  if (!summary) return null;
  const failed = [...out.matchAll(/^(?:FAILED|ERROR) (\S+?)::(\S+)/gm)].map((m) => ({ file: m[1], name: m[2] }));
  return { runner: 'pytest', failed: uniqueFailures(failed), passed: count(summary[1], /(\d+) passed/) };
};
