import type { TestFailure } from '../../shared/events.js';

/** eslint "stylish": an absolute file path line, then indented `line:col  error  message  rule` lines. Warnings are ignored. */
function eslint(out: string): TestFailure[] {
  const failed: TestFailure[] = [];
  let file: string | undefined;
  for (const line of out.split('\n')) {
    if (/^\S/.test(line)) file = /^(\/|[A-Za-z]:[\\/]).*\.\w+\s*$/.test(line) ? line.trim() : undefined;
    const m = line.match(/^\s+\d+:\d+\s+error\s+.*?(?:\s{2,}(\S+))?\s*$/);
    if (m && file) failed.push({ file, name: m[1] ?? 'eslint' });
  }
  return failed;
}

const PY = String.raw`\S[^:\n]*?\.(?:pyi?|ipynb)`;

/** ruff: concise `file:line:col: CODE message`, or full output with `CODE message` then ` --> file:line:col`. */
function ruff(out: string): TestFailure[] {
  const concise = [...out.matchAll(new RegExp(String.raw`^(${PY}):\d+:\d+: ([A-Z]+\d+)\b`, 'gm'))].map((m) => ({ file: m[1], name: m[2] }));
  if (concise.length) return concise;
  return [...out.matchAll(new RegExp(String.raw`^([A-Z]+\d+)\b.*\n\s*--> (${PY}):\d+:\d+`, 'gm'))].map((m) => ({ file: m[2], name: m[1] }));
}

/** Lint errors (ruff, eslint) in the output, one failure per error; empty when there are none. */
export function lintErrors(out: string): TestFailure[] {
  const r = ruff(out);
  return r.length ? r : eslint(out);
}

/** eslint failing on warnings alone (`--max-warnings`) still found no errors. */
export const onlyWarnings = (out: string) => /\(0 errors?, \d+ warnings?\)/.test(out);
