import type { GameEvent, HeroClass } from '../../shared/events.js';

/** File basename reduced to safe characters, so file names can't smuggle instructions into the prompt. */
export const cleanName = (p: string) => p.slice(p.lastIndexOf('/') + 1).replace(/[^\w.-]/g, '').slice(0, 40);

const uniq = (xs: string[]) => [...new Set(xs)];

/** A test, typecheck, lint or build result in words, so the narrator doesn't call lint errors failing tests. */
function checkSummary(e: Extract<GameEvent, { kind: 'test_result' }>): string {
  const n = e.failed.length;
  if (e.runner === 'build') return !n ? 'build: passing' : e.species === 'goblin' ? `build: ${n} type errors` : e.species === 'bat' ? `build: ${n} lint errors` : 'build: failing';
  if (e.runner === 'typecheck') return n ? `typecheck: ${n} type errors` : 'typecheck: all clear';
  if (e.runner === 'lint') return n ? `lint: ${n} errors` : 'lint: all clear';
  return n ? `tests: ${n} failing, ${e.passed} passing` : `tests: all ${e.passed} passing`;
}

/**
 * A short, secret-free description of what a hero just did, for the narrator prompt. Only event kinds,
 * cleaned file basenames and test counts; never paths, commands or output. Empty when nothing happened.
 */
export function summarize(_heroClass: HeroClass, events: GameEvent[]): string {
  const recent = events.filter((e) => !['torch', 'thinking', 'speech', 'stamina', 'idle'].includes(e.kind)).slice(-6);
  const parts: string[] = [];
  const reads = uniq(recent.flatMap((e) => (e.kind === 'move' ? [cleanName(e.path)] : [])));
  const forged = uniq(recent.flatMap((e) => (e.kind === 'forge' ? [cleanName(e.path)] : [])));
  if (reads.length) parts.push(`read ${reads.join(', ')}`);
  if (forged.length) parts.push(`changed ${forged.join(', ')}`);
  if (recent.some((e) => e.kind === 'scout')) parts.push('searched the halls');
  if (recent.some((e) => e.kind === 'cast')) parts.push('cast a spell');
  const test = [...recent].reverse().find((e) => e.kind === 'test_result');
  if (test && test.kind === 'test_result') parts.push(checkSummary(test));
  if (recent.some((e) => e.kind === 'compacted')) parts.push('lost their memories');
  return parts.join('; ');
}
