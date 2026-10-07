import { describe, expect, it } from 'vitest';
import { contextLimit, modelToClass } from '../../src/server/parser/model-class.js';
import { createParser, programName } from '../../src/server/parser/transcript-parser.js';

const T0 = Date.parse('2026-10-06T10:00:00.000Z');
let n = 0;
const ts = () => new Date(T0 + n++ * 1000).toISOString();

const assistant = (content: unknown[], model = 'claude-opus-5-5', usage?: object) =>
  JSON.stringify({ type: 'assistant', timestamp: ts(), cwd: '/repo', sessionId: 's1', message: { model, content, usage } });
const toolUse = (id: string, name: string, input: object, model?: string) => assistant([{ type: 'tool_use', id, name, input }], model);
const toolResult = (id: string, content: string, isError = false, extra: object = {}) =>
  JSON.stringify({ type: 'user', timestamp: ts(), message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content }] }, toolUseResult: extra });

const make = () => createParser({ repoRoot: '/repo', hero: 's1-abcdefgh', now: () => 42 });
const kinds = (evs: { kind: string }[]) => evs.map((e) => e.kind);

describe('modelToClass / contextLimit', () => {
  it('maps model families to classes', () => {
    expect(modelToClass('claude-opus-5-5')).toBe('knight');
    expect(modelToClass('claude-sonnet-5-5')).toBe('squire');
    expect(modelToClass('claude-haiku-4-5-20251001')).toBe('scout');
    expect(modelToClass('claude-fable-5-1')).toBe('wizard');
    expect(modelToClass('<synthetic>')).toBe('adventurer');
  });
  it('bumps context limit past 200k', () => {
    expect(contextLimit('claude-opus-5-5', 150_000)).toBe(200_000);
    expect(contextLimit('claude-opus-5-5', 250_000)).toBe(1_000_000);
  });
});

describe('programName', () => {
  it.each([
    ["KEY='a secret' npm test", 'npm'],
    ['KEY="x y\\" z" TOKEN=1 git push', 'git'],
    ['"API_KEY=sk-live" npm', ''],
    ["'my secret tool' --x", ''],
    ['$SECRET_CMD run', ''],
    ['`cat token` run', ''],
    ['  ls -la', 'ls'],
    ['./node_modules/.bin/vitest run', 'vitest'],
    ['a'.repeat(60), ''],
  ])('%s → %s', (cmd, want) => {
    expect(programName(cmd)).toBe(want);
  });
});

describe('createParser', () => {
  it('joins the hero on the first assistant line, then emits tool events', () => {
    const p = make();
    const evs = p.feed(toolUse('t1', 'Read', { file_path: '/repo/src/a.ts' }));
    expect(evs[0]).toMatchObject({ kind: 'hero_joined', hero: 's1-abcdefgh', heroClass: 'knight', label: 's1-abcde' });
    expect(evs[1]).toMatchObject({ kind: 'move', path: 'src/a.ts', t: T0 + (n - 1) * 1000 });
  });
  it('drops paths outside the repo', () => {
    const p = make();
    expect(kinds(p.feed(toolUse('t1', 'Read', { file_path: '/elsewhere/x.ts' })))).toEqual(['hero_joined']);
    expect(kinds(p.feed(toolUse('t2', 'Read', { file_path: '/repo-old/x.ts' })))).toEqual([]);
  });
  it('accepts paths under an alias root (symlinked checkout)', () => {
    const p = createParser({ repoRoot: '/real/repo', aliasRoots: ['/link/repo'], hero: 'h' });
    expect(p.feed(toolUse('t1', 'Read', { file_path: '/link/repo/src/a.ts' })).at(-1)).toMatchObject({ kind: 'move', path: 'src/a.ts' });
  });
  it('Edit forges an existing file', () => {
    const p = make();
    const evs = p.feed(toolUse('t1', 'Edit', { file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' }));
    expect(evs.at(-1)).toMatchObject({ kind: 'forge', path: 'src/a.ts', created: false });
  });
  it('Write marks created when the result says so', () => {
    const p = make();
    p.feed(toolUse('t1', 'Write', { file_path: '/repo/src/new.ts', content: 'SECRET' }));
    const evs = p.feed(toolResult('t1', 'File created successfully at: /repo/src/new.ts'));
    expect(evs).toEqual([expect.objectContaining({ kind: 'forge', path: 'src/new.ts', created: true })]);
    expect(JSON.stringify(evs)).not.toContain('SECRET');
  });
  it('Write over an existing file is not created', () => {
    const p = make();
    p.feed(toolUse('t1', 'Write', { file_path: '/repo/src/a.ts', content: 'x' }));
    expect(p.feed(toolResult('t1', 'The file /repo/src/a.ts has been updated successfully.'))).toEqual([
      expect.objectContaining({ kind: 'forge', created: false }),
    ]);
  });
  it('Grep/Glob scout the paths in the result', () => {
    const p = make();
    p.feed(toolUse('t1', 'Grep', { pattern: 'token', path: '/repo' }));
    const evs = p.feed(toolResult('t1', 'src/auth/token.ts:12:const token\n/repo/src/b.ts\n/outside/c.ts\nFound 3 files'));
    expect(evs).toEqual([expect.objectContaining({ kind: 'scout', paths: ['src/auth/token.ts', 'src/b.ts'] })]);
  });
  it('scout never leaks grep content lines', () => {
    const p = make();
    p.feed(toolUse('t1', 'Grep', { pattern: 'KEY', output_mode: 'content' }));
    const evs = p.feed(toolResult('t1', "src/a.ts:const API_KEY='sk-live-123'\nsrc/b.ts-12-  token = 'x'\n/repo/src/c.ts"));
    expect(JSON.stringify(evs)).not.toMatch(/sk-live|token =/);
    expect(evs[0]).toMatchObject({ kind: 'scout', paths: ['src/a.ts', 'src/b.ts', 'src/c.ts'] });
  });
  it('scout keeps only known paths when isKnownPath is given', () => {
    const p = createParser({ repoRoot: '/repo', hero: 'h', isKnownPath: (x) => x === 'src/a.ts' });
    p.feed(toolUse('t1', 'Glob', { pattern: '**/*' }));
    expect(p.feed(toolResult('t1', '/repo/src/a.ts\n/repo/src/ghost.ts'))[0]).toMatchObject({ paths: ['src/a.ts'] });
  });
  it('non-test Bash casts with only the first word', () => {
    const p = make();
    p.feed(toolUse('t1', 'Bash', { command: 'git commit -m "password=hunter2"' }));
    const evs = p.feed(toolResult('t1', 'ok', false, { stdout: 'ok', stderr: '' }));
    expect(evs).toEqual([expect.objectContaining({ kind: 'cast', command: 'git' })]);
    expect(JSON.stringify(evs)).not.toContain('hunter2');
  });
  it('cast never leaks env assignments or full paths', () => {
    const p = make();
    for (const [i, cmd, want] of [
      [1, 'API_KEY=sk-123 TOKEN=x npm install', 'npm'],
      [2, '/Users/me/secret-dir/bin/tool --flag', 'tool'],
      [3, 'export GITHUB_TOKEN=ghp_abc', 'export'],
      [4, 'FOO=bar', ''],
    ] as const) {
      p.feed(toolUse(`c${i}`, 'Bash', { command: cmd }));
      const evs = p.feed(toolResult(`c${i}`, 'ok', false, { stdout: 'ok', stderr: '' }));
      expect(evs).toEqual([expect.objectContaining({ kind: 'cast', command: want })]);
      expect(JSON.stringify(evs)).not.toMatch(/sk-123|secret-dir|ghp_abc|bar/);
    }
  });
  it('test Bash yields test_result', () => {
    const p = make();
    p.feed(toolUse('t1', 'Bash', { command: 'pytest' }));
    const out = 'FAILED tests/test_x.py::test_a - boom\n==== 1 failed, 3 passed in 0.1s ====';
    const evs = p.feed(toolResult('t1', `Exit code 1\n${out}`, true, { stdout: out, stderr: '' }));
    expect(evs).toEqual([expect.objectContaining({ kind: 'test_result', runner: 'pytest', passed: 3, failed: [{ file: 'tests/test_x.py', name: 'test_a' }] })]);
  });
  it('build, typecheck and lint Bash yield test_result without leaking the command; file paths become repo-relative', () => {
    const p = make();
    p.feed(toolUse('b1', 'Bash', { command: 'API_KEY=sk-123 npm run build' }));
    const out = "src/a.ts(3,1): error TS2304: Cannot find name 'foo'.";
    const evs = p.feed(toolResult('b1', out, true, { stdout: out, stderr: '' }));
    expect(evs).toEqual([expect.objectContaining({ kind: 'test_result', runner: 'build', species: 'goblin', failed: [{ file: 'src/a.ts', name: 'TS2304' }] })]);
    expect(JSON.stringify(evs)).not.toMatch(/sk-123|Cannot find/);
    p.feed(toolUse('l1', 'Bash', { command: 'npx eslint .' }));
    const lint = '/repo/src/a.ts\n  1:1  error  bad  no-undef\n/elsewhere/x.ts\n  1:1  error  bad  no-undef\nC:\\Users\\me\\repo\\src\\a.ts\n  1:1  error  bad  no-undef\n';
    const evs2 = p.feed(toolResult('l1', lint, true, { stdout: lint, stderr: '' }));
    expect(evs2).toEqual([
      expect.objectContaining({ kind: 'test_result', runner: 'lint', species: 'bat', failed: [{ file: 'src/a.ts', name: 'no-undef' }, { name: 'no-undef' }, { name: 'no-undef' }] }),
    ]);
    expect(JSON.stringify(evs2)).not.toMatch(/Users|elsewhere/);
  });
  it('ordinary Bash stays a cast even when its output mentions errors', () => {
    const p = make();
    p.feed(toolUse('o1', 'Bash', { command: 'cat build.log' }));
    const out = "src/a.ts(3,1): error TS2304: Cannot find name 'foo'.";
    expect(p.feed(toolResult('o1', out, true, { stdout: out, stderr: '' }))).toEqual([expect.objectContaining({ kind: 'cast', command: 'cat' })]);
  });
  it('usage becomes a torch event', () => {
    const p = make();
    const evs = p.feed(assistant([{ type: 'text', text: 'hi' }], 'claude-opus-5-5', { input_tokens: 2, cache_read_input_tokens: 55044, cache_creation_input_tokens: 710, output_tokens: 5 }));
    expect(evs).toContainEqual(expect.objectContaining({ kind: 'torch', used: 55756, max: 200000 }));
  });
  it('compact_boundary becomes compacted; the summary line is ignored', () => {
    const p = make();
    expect(kinds(p.feed(JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: ts() })))).toEqual(['compacted']);
    expect(p.feed(JSON.stringify({ type: 'user', isCompactSummary: true, message: { content: 'summary' } }))).toEqual([]);
  });
  it('re-joins with a new class when the model changes', () => {
    const p = make();
    p.feed(toolUse('t1', 'Read', { file_path: '/repo/a' }, 'claude-sonnet-5-5'));
    const evs = p.feed(toolUse('t2', 'Read', { file_path: '/repo/b' }, 'claude-opus-5-5'));
    expect(evs[0]).toMatchObject({ kind: 'hero_joined', heroClass: 'knight' });
  });
  it('ignores junk without throwing', () => {
    const p = make();
    expect(p.feed('not json')).toEqual([]);
    expect(p.feed('')).toEqual([]);
    expect(p.feed('{"type":"weird"}')).toEqual([]);
    expect(p.feed('[1,2]')).toEqual([]);
    expect(p.feed('{"type":"assistant","message":null}')).toEqual([]);
  });
  it('text-only assistant lines mean thinking; missing timestamp falls back to now()', () => {
    const p = make();
    const evs = p.feed(JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'x' }] } }));
    expect(kinds(evs)).toEqual(['hero_joined', 'thinking']);
    expect(evs[1].t).toBe(42);
  });
  it('carries the parent for subagents', () => {
    const p = createParser({ repoRoot: '/repo', hero: 's1/agent1', parent: 's1' });
    expect(p.feed(toolUse('t1', 'Read', { file_path: '/repo/a' }))[0]).toMatchObject({ kind: 'hero_joined', parent: 's1' });
  });
});
