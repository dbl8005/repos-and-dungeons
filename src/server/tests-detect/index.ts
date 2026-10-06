import { generic } from './generic.js';
import { go } from './go.js';
import { jest } from './jest.js';
import { pytest } from './pytest.js';
import type { TestRun } from './types.js';
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

export function detectTestRun(command: string, output: string, isError: boolean): TestRun | null {
  const name = testCommandName(command);
  if (!name) return null;
  const out = output.replace(ANSI, '');
  for (const d of [vitest, jest, pytest, go]) {
    const r = d(out);
    if (r) return r;
  }
  return generic(name, out, isError);
}
