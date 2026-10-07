import type { TestFailure } from '../../shared/events.js';

const TS = String.raw`\S.*?\.(?:[cm]?tsx?|[cm]?jsx?|vue)`;
const PY = String.raw`\S[^:\n]*?\.pyi?`;

/** Line patterns capturing file and an optional short code, by checker. Messages and source text are dropped. */
const FORMATS: [string, RegExp][] = [
  ['tsc', new RegExp(String.raw`^(${TS})\(\d+,\d+\): error (TS\d+):`, 'gm')],
  ['tsc', new RegExp(String.raw`^(${TS}):\d+:\d+ - error (TS\d+):`, 'gm')],
  ['pyright', new RegExp(String.raw`^\s*(${PY}):\d+:\d+ - error: .*?(?:\((report\w+)\))?\s*$`, 'gm')],
  ['mypy', new RegExp(String.raw`^(${PY}):\d+(?::\d+)?: error: .*?(?:\[([\w-]+)\])?\s*$`, 'gm')],
];

/** Type errors (tsc, pyright, mypy) in the output, one failure per error; empty when there are none. */
export function typecheckErrors(out: string): TestFailure[] {
  for (const [checker, re] of FORMATS) {
    const failed = [...out.matchAll(re)].map((m) => ({ file: m[1], name: m[2] ?? checker }));
    if (failed.length) return failed;
  }
  return [];
}
