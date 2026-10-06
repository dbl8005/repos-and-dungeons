import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectTestRun } from '../../src/server/tests-detect/index.js';

const fx = (n: string) => readFileSync(new URL(`../fixtures/runners/${n}.txt`, import.meta.url), 'utf8');

describe('detectTestRun', () => {
  it('vitest failures', () => {
    const r = detectTestRun('npx vitest run', fx('vitest-fail'), true)!;
    expect(r.runner).toBe('vitest');
    expect(r.failed).toHaveLength(2);
    expect(r.failed[0]).toEqual({ file: 'src/auth.test.ts', name: 'token > expires' });
    expect(r.passed).toBe(5);
  });
  it('vitest pass via npm test', () => {
    const r = detectTestRun('npm test', fx('vitest-pass'), false)!;
    expect(r.runner).toBe('vitest');
    expect(r.failed).toEqual([]);
    expect(r.passed).toBe(7);
  });
  it('jest failures', () => {
    const r = detectTestRun('npx jest', fx('jest-fail'), true)!;
    expect(r.runner).toBe('jest');
    expect(r.failed).toEqual([{ file: 'src/math.test.js', name: 'math › adds' }]);
    expect(r.passed).toBe(6);
  });
  it('pytest failures and passes', () => {
    const r = detectTestRun('python -m pytest -q', fx('pytest-fail'), true)!;
    expect(r.runner).toBe('pytest');
    expect(r.failed).toEqual([{ file: 'tests/test_x.py', name: 'test_a' }]);
    expect(r.passed).toBe(3);
    const p = detectTestRun('pytest', fx('pytest-pass'), false)!;
    expect(p.failed).toEqual([]);
    expect(p.passed).toBe(4);
  });
  it('go test failures', () => {
    const r = detectTestRun('go test ./...', fx('go-fail'), true)!;
    expect(r.runner).toBe('go');
    expect(r.failed.map((f) => f.name)).toEqual(['TestX']);
  });
  it('non-test commands return null', () => {
    expect(detectTestRun('ls -la', 'total 0', false)).toBeNull();
    expect(detectTestRun('git status', 'On branch main', false)).toBeNull();
  });
  it('unknown runner output falls back to generic', () => {
    const r = detectTestRun('npm test', 'Error: 3 checks failed\nExit code 1', true)!;
    expect(r.runner).toBe('generic');
    expect(r.failed).toEqual([{ name: 'npm test' }]);
  });
  it('generic failure names never carry command text', () => {
    expect(detectTestRun('GITHUB_TOKEN=ghp_abc npm test', 'it failed', true)!.failed).toEqual([{ name: 'npm test' }]);
    expect(detectTestRun('cd /Users/someone/clientX && npm run test:unit', 'failed', true)!.failed).toEqual([{ name: 'npm run test:unit' }]);
    expect(detectTestRun('API=1 make test', 'FAILED', true)!.failed).toEqual([{ name: 'make test' }]);
  });
  it('generic pass when exit is clean', () => {
    const r = detectTestRun('make test', 'all good', false)!;
    expect(r.runner).toBe('generic');
    expect(r.failed).toEqual([]);
  });
});
