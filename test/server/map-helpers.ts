import { fnv1a32 } from '../../src/shared/hash.js';

/** Deterministic fake repo: `files` files spread over `folders` folders of depth 1..maxDepth. */
export function fakeRepo(files: number, folders: number, maxDepth = 6): string[] {
  const dirs: string[] = [''];
  for (let i = 1; i < folders; i++) {
    const parent = dirs[fnv1a32(`p${i}`) % dirs.length];
    const depth = parent ? parent.split('/').length : 0;
    dirs.push(depth >= maxDepth ? parent : `${parent ? parent + '/' : ''}d${i}`);
  }
  const out = new Set<string>();
  for (let i = 0; out.size < files; i++) {
    const d = dirs[fnv1a32(`f${i}`) % dirs.length];
    out.add(`${d ? d + '/' : ''}file${i}.${['ts', 'md', 'json', 'test.ts'][i % 4]}`);
  }
  return [...out].sort();
}

export function shuffle<T>(a: T[]): T[] {
  return [...a].sort((x, y) => fnv1a32(String(x)) - fnv1a32(String(y)));
}
