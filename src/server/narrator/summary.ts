import type { GameEvent, HeroClass } from '../../shared/events.js';

/** File basename reduced to safe characters, so file names can't smuggle instructions into the prompt. */
export const cleanName = (p: string) => p.slice(p.lastIndexOf('/') + 1).replace(/[^\w.-]/g, '').slice(0, 40);

const uniq = (xs: string[]) => [...new Set(xs)];

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
  if (test && test.kind === 'test_result') parts.push(test.failed.length ? `tests: ${test.failed.length} failing, ${test.passed} passing` : `tests: all ${test.passed} passing`);
  if (recent.some((e) => e.kind === 'compacted')) parts.push('lost their memories');
  return parts.join('; ');
}
