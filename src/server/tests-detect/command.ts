export type CheckCategory = 'typecheck' | 'lint' | 'build';
export type CheckCommand = { category: CheckCategory; /** its output goes into another command, so the exit code is not its own */ piped: boolean };

type Segment = { words: string[]; piped: boolean };

const HEREDOC = /(?<!<)<<(?!<)-?[ \t]*(['"]?)([A-Za-z_][\w-]*)\1([^\n]*)\n[\s\S]*?(?:\n[ \t]*\2[ \t]*(?=\n|$)|$)/g;

/** Splits a shell command into simple commands (on `;`, `&&`, `||`, `|`, `&`, newlines, parens), quote-aware. */
function segments(command: string): Segment[] {
  const src = command.replace(HEREDOC, (_m, _q, _tag, rest: string) => rest);
  const out: Segment[] = [];
  let words: string[] = [];
  let w = '';
  let inWord = false;
  let quote: string | null = null;
  const endWord = () => {
    if (inWord) words.push(w);
    w = '';
    inWord = false;
  };
  const endSegment = (piped: boolean) => {
    endWord();
    if (words.length) out.push({ words, piped });
    words = [];
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = null;
      else w += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      inWord = true;
    } else if (c === '\\' && i + 1 < src.length) {
      w += src[++i];
      inWord = true;
    } else if (c === '|') {
      const or = src[i + 1] === '|';
      if (or) i++;
      endSegment(!or);
    } else if (c === '&' && (w.endsWith('>') || src[i + 1] === '>')) {
      w += c; // redirect: 2>&1, &>file
      inWord = true;
    } else if (c === '&' || c === ';' || c === '\n' || c === '(' || c === ')') {
      if (c === '&' && src[i + 1] === '&') i++;
      endSegment(false);
    } else if (/\s/.test(c)) {
      endWord();
    } else {
      w += c;
      inWord = true;
    }
  }
  endSegment(false);
  return out;
}

const WRAPPERS: string[][] = [['npx'], ['bunx'], ['pnpm', 'exec'], ['pnpm', 'dlx'], ['yarn', 'exec'], ['uv', 'run'], ['poetry', 'run'], ['python', '-m'], ['python3', '-m'], ['time'], ['sudo'], ['nice'], ['env']];
const NOT_A_RUN = new Set(['--help', '-h', '--version', '-V', '--init', '--showConfig', '--print-config', '-n', '--dry-run', '--just-print', '--recon']);
const SCRIPT = /^(build|lint|typecheck|type-check|check-types|types|tsc|check)(:[\w-]+)?$/;
const MAKE_TARGET = /^(build|lint|typecheck|type-check|all)$/; // not `check`: autotools runs the test suite with it
/** Package-manager options that take a value before the script name (`npm --prefix web run build`, `pnpm -C web build`). */
const PM_VALUE_FLAGS = new Set(['--prefix', '-C', '--dir', '--cwd', '--filter', '-F', '--workspace', '-w']);
/** make options that take a value (`make -C web`); -j and -l only when a number follows. */
const MAKE_VALUE_FLAGS = new Set(['-C', '-f', '--directory', '--file', '-I', '-o', '-W']);
const SUBCOMMANDS: Record<string, Record<string, CheckCategory>> = {
  cargo: { build: 'build', check: 'typecheck', clippy: 'lint' },
  go: { build: 'build', vet: 'lint' },
  ruff: { check: 'lint' },
  mvn: { compile: 'build', package: 'build', install: 'build' },
  ...Object.fromEntries(['vite', 'next', 'nuxt', 'astro', 'swift', 'zig', 'dotnet', 'gradle', 'gradlew'].map((p) => [p, { build: 'build' as const }])),
};
const PROGRAMS: Record<string, CheckCategory> = { tsc: 'typecheck', 'vue-tsc': 'typecheck', mypy: 'typecheck', pyright: 'typecheck', eslint: 'lint' };

/** typecheck/lint/build from a script or make target name. */
const byName = (name: string): CheckCategory => (/^lint/.test(name) ? 'lint' : /^(build|all)/.test(name) ? 'build' : 'typecheck');

function classifySegment(raw: string[]): CheckCategory | null {
  let words = raw.filter((x) => !/^\d?[<>]|^&>/.test(x)); // drop redirects
  for (let again = true; again; ) {
    again = false;
    while (words.length && /^[A-Za-z_]\w*=/.test(words[0])) words = words.slice(1); // env assignments
    for (const wr of WRAPPERS) {
      if (wr.every((x, i) => words[i] === x)) {
        words = words.slice(wr.length);
        while (words[0]?.startsWith('-')) words = words.slice(1);
        again = true;
      }
    }
  }
  if (!words.length || words.some((x) => NOT_A_RUN.has(x))) return null;
  const prog = words[0].split('/').pop()!;
  if (PROGRAMS[prog]) return PROGRAMS[prog];
  if (SUBCOMMANDS[prog]) return SUBCOMMANDS[prog][words[1]] ?? null;
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(prog)) {
    words = [prog, ...words.slice(1)];
    while (words[1]?.startsWith('-')) words.splice(1, PM_VALUE_FLAGS.has(words[1]) ? 2 : 1);
    if (prog === 'yarn' && words[1] === 'workspace') words.splice(1, 2);
    const script = words[1] === 'run' || words[1] === 'run-script' ? words[2] : prog === 'npm' ? undefined : words[1];
    return script && SCRIPT.test(script) ? byName(script) : null;
  }
  if (prog === 'make') {
    const targets: string[] = [];
    for (let i = 1; i < words.length; i++) {
      const x = words[i];
      if (MAKE_VALUE_FLAGS.has(x) || ((x === '-j' || x === '-l') && /^\d+$/.test(words[i + 1] ?? ''))) i++;
      else if (!x.startsWith('-') && !x.includes('=')) targets.push(x);
    }
    if (!targets.length) return 'build';
    return targets.every((t) => MAKE_TARGET.test(t)) ? byName(targets[0]) : null;
  }
  return null;
}

/**
 * The typecheck, lint or build command in program position, if any. A command chaining checks of different
 * categories (`npm run lint && npm run build`) is null: its output can't be pinned on one of them, and keying it to
 * either would leave monsters the other one spawned with nothing to kill them.
 */
export function classifyCheck(command: string): CheckCommand | null {
  let category: CheckCategory | null = null;
  let piped = false;
  for (const seg of segments(command)) {
    const c = classifySegment(seg.words);
    if (!c) continue;
    if (category && category !== c) return null;
    category = c;
    piped ||= seg.piped;
  }
  return category && { category, piped };
}
