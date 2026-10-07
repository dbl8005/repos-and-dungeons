import { describe, expect, it } from 'vitest';
import { createParser } from '../../src/server/parser/transcript-parser.js';
import type { DungeonMap } from '../../src/shared/map-types.js';
import { initialState, reduce } from '../../src/shared/reducer.js';
import type { GameEvent } from '../../src/shared/events.js';

const map: DungeonMap = {
  seed: 'x', width: 20, height: 10,
  rooms: [{ id: 'r0', path: '', x: 1, y: 1, w: 6, h: 4, alcoves: [] }],
  tiles: [], corridors: [], decor: [],
};
let n = 0;
const ts = () => new Date(Date.parse('2026-10-06T10:00:00.000Z') + n++ * 1000).toISOString();
const line = (o: object) => JSON.stringify({ timestamp: ts(), cwd: '/repo', sessionId: 's1', ...o });
const bash = (id: string, command: string) => line({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
const result = (id: string, out: string, isError: boolean) =>
  line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: out }] }, toolUseResult: { stdout: out, stderr: '' } });

/** Runs `command` failing with `failOut`, then clean; returns the monsters after each step. */
function failThenPass(command: string, failOut: string) {
  const p = createParser({ repoRoot: '/repo', hero: 'h', now: () => 42 });
  const s = initialState(map, {});
  const feed = (l: string) => p.feed(l).forEach((e: GameEvent) => reduce(s, e));
  feed(bash('a', command));
  feed(result('a', failOut, true));
  const failing = s.monsters.map((m) => m.species);
  feed(bash('b', command));
  feed(result('b', 'ok', false));
  return { failing, after: s.monsters };
}

describe('failing check then the same check clean (parser + reducer)', () => {
  const tsc = "src/a.ts(3,1): error TS2304: Cannot find name 'foo'.";
  const ruff = 'app/x.py:1:8: F401 [*] `os` imported but unused';
  const mypy = 'app/x.py:3: error: Name "foo" is not defined  [name-defined]';
  for (const [command, out, species] of [
    ['npm run build', tsc, 'goblin'],
    ['make lint', ruff, 'bat'],
    ['npm run lint', ruff, 'bat'],
    ['make typecheck', mypy, 'goblin'],
    ['npx tsc --noEmit', tsc, 'goblin'],
    ['npm run build', 'Build failed', 'ogre'],
  ] as const) {
    it(`${command} (${species})`, () => {
      const r = failThenPass(command, out);
      expect(r.failing).toEqual([species]);
      expect(r.after).toEqual([]);
    });
  }
});

describe('commands whose exit code or category is ambiguous leave monsters alone', () => {
  const tsc = "src/a.ts(3,1): error TS2304: Cannot find name 'foo'.";
  function run(steps: [command: string, out: string, isError: boolean][]) {
    const p = createParser({ repoRoot: '/repo', hero: 'h', now: () => 42 });
    const s = initialState(map, {});
    steps.forEach(([command, out, isError], i) => {
      for (const l of [bash(`c${i}`, command), result(`c${i}`, out, isError)]) p.feed(l).forEach((e: GameEvent) => reduce(s, e));
    });
    return s.monsters.map((m) => `${m.runner}:${m.species}`);
  }
  it('a chained lint && build failing on type errors spawns nothing, so nothing gets stuck', () => {
    expect(run([['npm run lint && npm run build', tsc, true]])).toEqual([]);
  });
  it('a passing build filtered through grep (non-zero exit) neither spawns nor kills an ogre', () => {
    expect(run([['npm run build', 'Build failed', true], ['npm run build 2>&1 | grep -i error', '', true]])).toEqual(['build:ogre']);
    expect(run([['npm run build 2>&1 | grep -i error', '', true]])).toEqual([]);
  });
});
