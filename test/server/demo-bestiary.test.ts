import { describe, expect, it } from 'vitest';
import { demoSteps } from '../../src/server/demo.js';
import { createParser } from '../../src/server/parser/transcript-parser.js';
import { isBoss } from '../../src/shared/bestiary.js';
import type { GameEvent } from '../../src/shared/events.js';
import type { DungeonMap } from '../../src/shared/map-types.js';
import { initialState, reduce } from '../../src/shared/reducer.js';

const root = '/fake/acme-app';
const abs = (f: string) => `${root}/${f}`;
const map: DungeonMap = {
  seed: 'x', width: 20, height: 10,
  rooms: [{ id: 'r0', path: '', x: 1, y: 1, w: 6, h: 4, alcoves: [] }],
  tiles: [], corridors: [], decor: [],
};

function play() {
  const steps = demoSteps('bestiary', abs);
  const parsers = new Map<string, ReturnType<typeof createParser>>();
  const s = initialState(map, {});
  let n = 0;
  const ts = () => new Date(Date.parse('2026-10-06T10:00:00.000Z') + n++ * 1000).toISOString();
  const snaps: { hp: number; maxHp: number; species: string; file?: string }[][] = [];
  steps.forEach((st, i) => {
    let p = parsers.get(st.hero);
    if (!p) parsers.set(st.hero, (p = createParser({ repoRoot: root, hero: st.hero, now: () => 42 })));
    const id = `toolu_${i}`;
    const lines = [JSON.stringify({ type: 'assistant', cwd: root, sessionId: 's1', timestamp: ts(), message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name: st.tool, input: st.input ?? {} }] } })];
    if (st.result !== undefined || st.tool === 'Bash' || st.tool === 'Write') {
      const out = st.result ?? '';
      lines.push(JSON.stringify({ type: 'user', cwd: root, sessionId: 's1', timestamp: ts(), message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: !!st.isError, content: out }] }, toolUseResult: { stdout: out, stderr: '' } }));
    }
    for (const l of lines) p.feed(l).forEach((e: GameEvent) => reduce(s, e));
    snaps.push(s.monsters.map((m) => ({ hp: m.hp, maxHp: m.maxHp, species: m.species, file: (m as { file?: string }).file })));
  });
  return { steps, snaps, s };
}

describe('bestiary demo scenario', () => {
  const { steps, snaps, s } = play();
  const idx = (cmd: string, nth: number) => steps.map((x, i) => [x, i] as const).filter(([x]) => (x.input as { command?: string })?.command === cmd)[nth][1];

  it('spawns the full bestiary after the build fails', () => {
    const m = snaps[idx('npm run build', 0)];
    const sp = (k: string) => m.filter((x) => x.species === k).map((x) => x.hp).sort();
    expect(sp('goblin')).toEqual([1, 6]);
    expect(isBoss({ hp: 6 })).toBe(true);
    expect(sp('bat')).toEqual([1, 3]);
    expect(sp('ogre')).toHaveLength(1);
  });
  it('the typecheck rerun halves the boss and kills the users.ts goblin', () => {
    const m = snaps[idx('npm run typecheck', 1)].filter((x) => x.species === 'goblin');
    expect(m).toHaveLength(1);
    expect(m[0].hp).toBe(3);
    expect(m[0].maxHp).toBe(6);
  });
  it('ends with no monsters', () => {
    expect(snaps[snaps.length - 1]).toEqual([]);
    expect(s.monsters).toEqual([]);
  });
  it('default scenario is unchanged', () => {
    const d = demoSteps('default', abs);
    expect(d).toHaveLength(18);
    expect(d[0]).toEqual({ hero: 'lead', tool: 'Read', input: { file_path: abs('README.md') } });
  });
});
