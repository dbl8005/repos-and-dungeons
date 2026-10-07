import { describe, expect, it, vi } from 'vitest';
import type { GameEvent } from '../../src/shared/events.js';
import { cannedLine, tauntLine } from '../../src/server/narrator/lines.js';
import { Narrator } from '../../src/server/narrator/narrator.js';
import { fnv1a32 } from '../../src/shared/hash.js';

const NOW = 1_000_000;
const mk = (o: { run?: (p: string) => Promise<string>; enabled?: boolean; now?: () => number }) => {
  const out: GameEvent[] = [];
  const n = new Narrator({ publish: (e) => out.push(...e), run: o.run ?? (async () => 'Onward, brave friends!'), now: o.now ?? (() => NOW), enabled: o.enabled ?? true });
  return { n, out, speech: () => out.filter((e) => e.kind === 'speech') as Extract<GameEvent, { kind: 'speech' }>[] };
};
const ev = (hero: string, body: object, t = NOW) => ({ t, hero, ...body }) as GameEvent;
const join = (hero: string, t = NOW) => ev(hero, { kind: 'hero_joined', heroClass: 'knight', label: hero }, t);

describe('Narrator', () => {
  it('speaks instantly when tests start failing, and the slime taunts', () => {
    const { n, speech } = mk({ enabled: false });
    n.observe([join('h1'), ev('h1', { kind: 'test_result', runner: 'vitest', passed: 1, failed: [{ name: 'x' }] })]);
    expect(speech().map((s) => s.hero)).toContain('h1');
    expect(speech().map((s) => s.hero)).toContain('monster:h1');
  });

  it('the taunt comes from the spawning species', () => {
    const { n, speech } = mk({ enabled: false });
    n.observe([join('h1'), ev('h1', { kind: 'test_result', runner: 'build', species: 'goblin', passed: 0, failed: [{ file: 'src/a.ts', name: 'TS2322' }] })]);
    const taunt = speech().find((s) => s.hero === 'monster:h1')!;
    expect(taunt.text).toBe(tauntLine('goblin', fnv1a32(`h1${NOW}`)));
    expect(tauntLine('goblin', 0)).not.toBe(tauntLine('slime', 0));
  });

  it('the victory line is about the species that was beaten, even when a clean build ends a goblin fight', () => {
    // a moment where the goblin and ogre victory lines differ, so the assertion can tell them apart
    const line = (t: number, sp: 'goblin' | 'ogre') => cannedLine('monster_slain', 'knight', fnv1a32(`h1:monster_slain:${t}`), sp);
    let later = NOW + 10_000;
    while (line(later, 'goblin') === line(later, 'ogre')) later++;
    let now = NOW;
    const { n, speech } = mk({ enabled: false, now: () => now });
    n.observe([join('h1'), ev('h1', { kind: 'test_result', runner: 'build', species: 'goblin', passed: 0, failed: [{ file: 'src/a.ts', name: 'TS2322' }] })]);
    const before = speech().length;
    now = later;
    n.observe([ev('h1', { kind: 'test_result', runner: 'build', passed: 0, failed: [] }, later)]);
    const slain = speech().slice(before).find((s) => s.hero === 'h1')!;
    expect(slain.text).toBe(line(later, 'goblin'));
  });

  it('calls Haiku once for fresh activity and publishes the sanitized reply', async () => {
    const run = vi.fn(async (_prompt: string) => '"Onward, brave friends! 🗡️"');
    let now = NOW - 7_000;
    const { n, speech } = mk({ run, now: () => now });
    n.observe([join('h1', now)]); // greeting starts the 6 s bubble cooldown
    now = NOW;
    n.observe([ev('h1', { kind: 'move', path: 'src/a.ts' })]);
    await vi.waitFor(() => expect(speech().some((s) => s.text === 'Onward, brave friends!')).toBe(true));
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toContain('a.ts');
    expect(run.mock.calls[0][0]).not.toContain('src/a.ts');
  });

  it('a storm of events makes at most one Haiku call per hero', async () => {
    const run = vi.fn(async () => 'Steady now, friends.');
    let now = NOW - 7_000;
    const { n } = mk({ run, now: () => now });
    n.observe([join('h1', now)]);
    now = NOW;
    for (let i = 0; i < 50; i++) n.observe([ev('h1', { kind: 'move', path: `f${i}.ts` })]);
    await new Promise((r) => setTimeout(r, 20));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('backs off after repeated failures and never rejects unhandled', async () => {
    let now = NOW;
    const run = vi.fn(async () => { throw new Error('logged out'); });
    const { n, speech } = mk({ run, now: () => now });
    for (let i = 0; i < 6; i++) {
      now += 16_000;
      n.observe([join(`h${i}`, now), ev(`h${i}`, { kind: 'move', path: 'a.ts' }, now)]);
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(run.mock.calls.length).toBe(3);
    expect(speech().length).toBeGreaterThan(0); // canned lines keep flowing
  });

  it('never calls Haiku when disabled, and ignores old history replayed on startup', async () => {
    const run = vi.fn(async () => 'Hello there friends.');
    const off = mk({ run, enabled: false });
    off.n.observe([join('h1'), ev('h1', { kind: 'move', path: 'a.ts' })]);
    const on = mk({ run });
    on.n.observe([join('old', NOW - 120_000), ev('old', { kind: 'move', path: 'a.ts' }, NOW - 120_000)]);
    await new Promise((r) => setTimeout(r, 10));
    expect(run).not.toHaveBeenCalled();
    expect(on.speech()).toEqual([]);
  });
  it('with Haiku off, routine activity still gets built-in lines (paced)', () => {
    let now = NOW - 7_000;
    const { n, speech } = mk({ enabled: false, now: () => now });
    n.observe([join('h1', now)]);
    now = NOW;
    n.observe([ev('h1', { kind: 'move', path: 'a.ts' })]);
    expect(speech().filter((s) => s.hero === 'h1')).toHaveLength(2);
    n.observe([ev('h1', { kind: 'move', path: 'b.ts' })]);
    expect(speech().filter((s) => s.hero === 'h1')).toHaveLength(2);
  });
});
