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

describe('detectTestRun: typecheck, lint and build', () => {
  const files = (r: ReturnType<typeof detectTestRun>) => r!.failed.map((f) => `${f.file ?? ''}|${f.name}`);
  const clean = (runner: string) => ({ runner, failed: [], passed: 0 });
  it('tsc, classic format: one failure per error, keyed by the command category, goblins', () => {
    const r = detectTestRun('npx tsc --noEmit', fx('tsc-fail'), true)!;
    expect(r).toMatchObject({ runner: 'typecheck', species: 'goblin' });
    expect(files(r)).toEqual(['src/auth/token.ts|TS2322', 'src/auth/token.ts|TS2339', 'src/a.ts|TS2304']);
  });
  it('tsc, pretty format ignores the summary table and source lines', () => {
    const r = detectTestRun('npm run typecheck', fx('tsc-pretty-fail'), true)!;
    expect(r).toMatchObject({ runner: 'typecheck', species: 'goblin' });
    expect(files(r)).toEqual(['src/auth/token.ts|TS2322', 'src/a.ts|TS2304']);
  });
  it('mypy, with and without an error code; notes ignored', () => {
    const r = detectTestRun('mypy app', fx('mypy-fail'), true)!;
    expect(r).toMatchObject({ runner: 'typecheck', species: 'goblin' });
    expect(files(r)).toEqual(['app/models.py|return-value', 'app/models.py|name-defined', 'app/views.py|mypy']);
  });
  it('pyright errors only', () => {
    const r = detectTestRun('pyright', fx('pyright-fail'), true)!;
    expect(files(r)).toEqual(['/repo/app/models.py|reportReturnType', '/repo/app/views.py|reportUndefinedVariable']);
  });
  it('a clean typecheck has the same key as the failing one', () => {
    expect(detectTestRun('npx tsc --noEmit', '', false)).toEqual(clean('typecheck'));
    expect(detectTestRun('mypy .', 'Success: no issues found in 12 source files', false)).toEqual(clean('typecheck'));
    expect(detectTestRun('uv run pyright', '0 errors, 0 warnings, 0 informations', false)).toEqual(clean('typecheck'));
  });
  it('eslint stylish: errors only, warnings ignored, never source text', () => {
    const r = detectTestRun('npx eslint .', fx('eslint-fail'), true)!;
    expect(r).toMatchObject({ runner: 'lint', species: 'bat' });
    expect(files(r)).toEqual(['/repo/src/web/main.ts|@typescript-eslint/no-unused-vars', '/repo/src/web/main.ts|no-unused-vars', '/repo/src/shared/hash.ts|eslint']);
    expect(JSON.stringify(r)).not.toMatch(/unused'|Parsing error/);
  });
  it('eslint only takes path-looking lines as file headers', () => {
    const out = 'Oops something odd\n  3:1  error  bad  no-undef\n/repo/src/a.ts\n  1:1  error  bad  no-undef\n';
    expect(files(detectTestRun('npx eslint .', out, true))).toEqual(['/repo/src/a.ts|no-undef']);
  });
  it('eslint with only warnings is a clean run', () => {
    expect(detectTestRun('npm run lint', fx('eslint-warn'), false)).toEqual(clean('lint'));
    expect(detectTestRun('npm run lint', fx('eslint-warn'), true)).toEqual(clean('lint'));
  });
  it('ruff, concise and full output', () => {
    const r = detectTestRun('ruff check .', fx('ruff-fail'), true)!;
    expect(r).toMatchObject({ runner: 'lint', species: 'bat' });
    expect(files(r)).toEqual(['app/models.py|F401', 'app/models.py|E501', 'app/views.py|E402']);
    expect(files(detectTestRun('ruff check', fx('ruff-full-fail'), true))).toEqual(['app/models.py|F401', 'app/views.py|E402']);
    expect(detectTestRun('ruff check .', 'All checks passed!', false)).toEqual(clean('lint'));
    expect(detectTestRun('ruff format .', '3 files reformatted', false)).toBeNull();
  });
  it('a failing build is one ogre; a clean build has the same key', () => {
    for (const cmd of ['npm run build', 'pnpm build', 'yarn run build:prod', 'cargo build --release', 'go build ./...', 'make', 'make -j4 all', 'npx vite build', 'swift build', 'FOO=1 npm run build']) {
      expect(detectTestRun(cmd, fx('build-fail'), true), cmd).toEqual({ runner: 'build', species: 'ogre', failed: [{ name: 'build' }], passed: 0 });
      expect(detectTestRun(cmd, 'done', false), cmd).toEqual(clean('build'));
    }
  });
  it('a build that fails on type errors spawns goblins under the build key', () => {
    const r = detectTestRun('npm run build', fx('build-tsc-fail'), true)!;
    expect(r).toMatchObject({ runner: 'build', species: 'goblin' });
    expect(files(r)).toEqual(['src/server/app.ts|TS2554', 'src/server/app.ts|TS2345']);
    expect(detectTestRun('npm run build', 'built in 1s', false)).toEqual(clean('build'));
  });
  it('category comes from the command, species from the output', () => {
    expect(detectTestRun('make lint', fx('ruff-fail'), true)).toMatchObject({ runner: 'lint', species: 'bat' });
    expect(detectTestRun('make lint', '', false)).toEqual(clean('lint'));
    expect(detectTestRun('npm run lint', fx('ruff-fail'), true)).toMatchObject({ runner: 'lint', species: 'bat' });
    expect(detectTestRun('npm run lint', '', false)).toEqual(clean('lint'));
    expect(detectTestRun('make typecheck', fx('mypy-fail'), true)).toMatchObject({ runner: 'typecheck', species: 'goblin' });
    expect(detectTestRun('make typecheck', '', false)).toEqual(clean('typecheck'));
  });
  it('other compilers\' errors are an ogre, not mypy goblins', () => {
    const c = 'gcc -c foo.c\nfoo.c:12:5: error: expected \';\' before \'}\' token\nmake: *** [foo.o] Error 1';
    expect(detectTestRun('make', c, true)).toEqual({ runner: 'build', species: 'ogre', failed: [{ name: 'build' }], passed: 0 });
    expect(detectTestRun('swift build', 'Sources/main.swift:3:5: error: cannot find \'x\' in scope', true)).toMatchObject({ runner: 'build', species: 'ogre' });
  });
  it('a piped check never reports a clean pass from exit 0', () => {
    expect(detectTestRun('npm run build 2>&1 | tail -20', fx('build-fail'), false)).toBeNull();
    expect(detectTestRun('npm run build 2>&1 | tail -20', fx('build-tsc-fail'), false)).toMatchObject({ runner: 'build', species: 'goblin' });
    expect(detectTestRun('npm run build 2>&1 | tail -20', fx('build-fail'), true)).toBeNull();
    expect(detectTestRun('npm run build 2>&1 | grep -i error', '', true)).toBeNull(); // grep found nothing: the build passed
    expect(detectTestRun('npm run build | grep -c error', '0', true)).toBeNull();
    expect(detectTestRun('npm run build > out.log 2>&1', 'x', false)).toEqual(clean('build'));
  });
  it('test commands keep their test runners', () => {
    expect(detectTestRun('npm test', fx('vitest-fail'), true)!.runner).toBe('vitest');
    expect(detectTestRun('make test', 'FAILED', true)!.runner).toBe('generic');
  });
  it('only programs in command position count; installs, help, clean and dry runs are ordinary commands', () => {
    for (const cmd of [
      'ls -la', 'git status', 'cat build.log', 'npm install', 'cmake ..', 'git commit -m "make the npm run build pass"',
      'cat eslint.config.js', 'npm install -D eslint', 'pip install ruff mypy', 'which tsc', 'grep -rn tsc package.json',
      'grep -n make Makefile', 'make clean', 'make help', 'make -n', 'brew install make', 'npx tsc --version',
      "git commit -F - <<'EOF'\nmake it build\nEOF",
    ]) {
      expect(detectTestRun(cmd, fx('tsc-fail'), true), cmd).toBeNull();
      expect(detectTestRun(cmd, '', false), cmd).toBeNull();
    }
  });
  it('chained checks of different categories are not pinned on either one', () => {
    for (const cmd of ['npm run lint && npm run build', 'npm run build && npm run lint', 'tsc --noEmit; eslint .']) {
      expect(detectTestRun(cmd, fx('tsc-fail'), true), cmd).toBeNull();
      expect(detectTestRun(cmd, '', false), cmd).toBeNull();
    }
    expect(detectTestRun('npm run lint && npx eslint .', '', false)).toEqual(clean('lint'));
    expect(detectTestRun('cd web && npm run build', '', false)).toEqual(clean('build'));
  });
  it('wrappers and package-manager or make options before the script still count', () => {
    for (const cmd of [
      'sudo make', 'nice npm run build', 'env FOO=1 npm run build', 'npm --prefix web run build', 'pnpm -C web build',
      'pnpm --filter app build', 'yarn workspace foo build', 'make -C web', 'make -j 4', 'make -j4 all',
    ]) expect(detectTestRun(cmd, '', false), cmd).toEqual(clean('build'));
    expect(detectTestRun('make check', '', false)).toBeNull(); // autotools: that's the test suite
    expect(detectTestRun('npm run check', '', false)).toEqual(clean('typecheck'));
  });
  it('here-strings and shifts are not heredocs', () => {
    expect(detectTestRun('echo $((1<<2))\nnpm run build', '', false)).toEqual(clean('build'));
    expect(detectTestRun('cat <<< "x"\nmake', '', false)).toEqual(clean('build'));
  });
  it('quotes are handled: an apostrophe inside double quotes does not hide a later make', () => {
    expect(detectTestRun(`echo "it's done"; make`, '', false)).toEqual(clean('build'));
    expect(detectTestRun('cd app && npm run lint', '', false)).toEqual(clean('lint'));
  });
});
