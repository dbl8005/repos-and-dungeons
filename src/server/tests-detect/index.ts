import { classifyCheck } from './command.js';
import { generic } from './generic.js';
import { go } from './go.js';
import { jest } from './jest.js';
import { lintErrors, onlyWarnings } from './lint.js';
import { pytest } from './pytest.js';
import type { TestRun } from './types.js';
import { typecheckErrors } from './typecheck.js';
import { vitest } from './vitest.js';

export type { TestRun } from './types.js';

const TEST_COMMAND =
  /(^|[\s;&|(])(vitest|jest|pytest|py\.test|mocha|rspec|phpunit|tox|(go|cargo|bun|deno|dotnet|mix) test|(npm|pnpm|yarn)( run)? test(:[\w-]+)?|make test|python3? -m pytest)\b/;

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

export function isTestCommand(command: string): boolean {
  return TEST_COMMAND.test(command);
}

/** The runner part of a command (`npm run test:unit`), never env vars, paths or other text around it. */
export function testCommandName(command: string): string | null {
  return command.match(TEST_COMMAND)?.[2] ?? null;
}

/**
 * A test, typecheck, lint or build command's result as a TestRun; null for any other command. Checks are keyed by
 * the command's category (so a failing and a clean run of one command share monsters) and their species comes from
 * the output: type errors are goblins even in `npm run build`, lint errors bats, any other build failure an ogre.
 */
export function detectTestRun(command: string, output: string, isError: boolean): TestRun | null {
  const out = output.replace(ANSI, '');
  const name = testCommandName(command);
  if (name) {
    for (const d of [vitest, jest, pytest, go]) {
      const r = d(out);
      if (r) return r;
    }
    return generic(name, out, isError);
  }
  const check = classifyCheck(command);
  if (!check) return null;
  const runner = check.category;
  const types = typecheckErrors(out);
  if (types.length) return { runner, species: 'goblin', failed: types, passed: 0 };
  const lint = lintErrors(out);
  if (lint.length) return { runner, species: 'bat', failed: lint, passed: 0 };
  if (check.piped) return null; // the pipe's exit code isn't the check's: neither a clean pass nor a failure
  if (!isError || (runner === 'lint' && onlyWarnings(out))) return { runner, failed: [], passed: 0 };
  return runner === 'build' ? { runner, species: 'ogre', failed: [{ name: 'build' }], passed: 0 } : null;
}
