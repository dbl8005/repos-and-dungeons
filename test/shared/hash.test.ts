import { describe, expect, it } from 'vitest';
import { fnv1a32 } from '../../src/shared/hash.js';

describe('fnv1a32', () => {
  it('matches the FNV-1a reference values', () => {
    expect(fnv1a32('')).toBe(2166136261);
    expect(fnv1a32('a')).toBe(0xe40c292c);
  });
  it('is stable and unsigned', () => {
    expect(fnv1a32('src/auth/token.ts')).toBe(fnv1a32('src/auth/token.ts'));
    for (const s of ['x', 'hello world', 'ü', 'a'.repeat(1000)]) expect(fnv1a32(s)).toBeGreaterThanOrEqual(0);
  });
});
