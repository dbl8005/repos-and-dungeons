import type { TestRun } from './types.js';

/** Last resort for a known test command: non-zero exit plus the word "fail" means one failure named after the runner. */
export function generic(name: string, out: string, isError: boolean): TestRun | null {
  if (!isError) return { runner: 'generic', failed: [], passed: 0 };
  if (/\bfail/i.test(out)) return { runner: 'generic', failed: [{ name }], passed: 0 };
  return null;
}
