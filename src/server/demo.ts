import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const FILES = [
  'README.md', 'package.json', 'src/index.ts', 'src/server.ts', 'src/config.ts', 'src/routes/users.ts', 'src/routes/billing.ts',
  'src/auth/token.ts', 'src/auth/session.ts', 'src/auth/login.ts', 'src/auth/token.test.ts', 'src/auth/session.test.ts',
  'src/db/schema.ts', 'src/db/migrate.ts', 'src/db/pool.ts', 'src/ui/App.tsx', 'src/ui/Login.tsx', 'src/ui/theme.css',
  'docs/architecture.md', 'docs/api.md', 'scripts/deploy.sh', 'scripts/seed.ts', 'tests/e2e/login.spec.ts',
];

/** A plausible ~2,500-file monorepo for the "big repo" shot (deterministic names). */
function largeTree(): string[] {
  const pkgs = ['web', 'api', 'auth', 'billing', 'search', 'notifications', 'admin', 'mobile', 'analytics', 'design-system', 'workers', 'gateway'];
  const dirs = ['components', 'hooks', 'routes', 'services', 'models', 'utils', 'store', 'jobs', 'middleware', 'pages'];
  const nouns = ['User', 'Account', 'Invoice', 'Session', 'Token', 'Order', 'Cart', 'Payment', 'Profile', 'Team', 'Report', 'Webhook', 'Plan', 'Coupon', 'Audit', 'Feed', 'Inbox', 'Avatar', 'Badge', 'Chart'];
  const out: string[] = [];
  pkgs.forEach((p, pi) => {
    out.push(`packages/${p}/package.json`, `packages/${p}/README.md`, `packages/${p}/tsconfig.json`);
    dirs.forEach((d, di) => {
      if ((pi + di) % 3 === 2) return;
      nouns.forEach((n, ni) => {
        if ((pi * 7 + di * 3 + ni) % 4 === 0) return;
        out.push(`packages/${p}/src/${d}/${n}${d === 'hooks' ? 'Hook' : d === 'services' ? 'Service' : ''}.ts`);
        if (ni % 3 === 0) out.push(`packages/${p}/src/${d}/${n}.test.ts`);
      });
    });
  });
  for (let i = 0; i < 40; i++) out.push(`docs/adr/${String(i + 1).padStart(4, '0')}-decision.md`);
  for (const f of ['ci.yml', 'release.yml', 'lint.yml']) out.push(`.github/workflows/${f}`);
  return out;
}

type Step = { hero: 'lead' | 'scout' | 'squire'; tool: string; input?: object; result?: string; isError?: boolean };

/**
 * Creates a small fake repo plus a projects folder, then appends a scripted session to it over time, so the
 * dungeon can be watched live without a real agent. Returns the folders to point the dungeon at.
 */
export function startDemo(o: { stepMs?: number; large?: boolean } = {}): { repo: string; projectsDir: string; stop(): void } {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'rd-demo-')));
  const repo = path.join(root, 'acme-app');
  for (const f of o.large ? [...FILES, ...largeTree()] : FILES) {
    mkdirSync(path.dirname(path.join(repo, f)), { recursive: true });
    writeFileSync(path.join(repo, f), '');
  }
  const projectsDir = path.join(root, 'projects');
  const dir = path.join(projectsDir, 'demo');
  mkdirSync(path.join(dir, 'lead', 'subagents'), { recursive: true });
  const files = {
    lead: path.join(dir, 'lead.jsonl'),
    scout: path.join(dir, 'lead', 'subagents', 'agent-scout.jsonl'),
    squire: path.join(dir, 'squire.jsonl'),
  };
  const models = { lead: 'claude-opus-5-5', scout: 'claude-haiku-4-5-20251001', squire: 'claude-sonnet-5-5' };
  writeFileSync(files.lead, JSON.stringify({ type: 'user', cwd: repo, timestamp: new Date().toISOString(), message: { content: 'Fix the login bug' } }) + '\n');

  const abs = (f: string) => path.join(repo, f);
  const vitestFail = ' FAIL  src/auth/token.test.ts > token > expires\n FAIL  src/auth/session.test.ts > session > refresh\n Test Files  2 failed (2)\n      Tests  2 failed | 9 passed (11)';
  const vitestPass = ' Test Files  2 passed (2)\n      Tests  11 passed (11)';
  const steps: Step[] = [
    { hero: 'lead', tool: 'Read', input: { file_path: abs('README.md') } },
    { hero: 'lead', tool: 'Read', input: { file_path: abs('src/index.ts') } },
    { hero: 'lead', tool: 'Read', input: { file_path: abs('src/server.ts') } },
    { hero: 'lead', tool: 'Bash', input: { command: 'npx vitest run' }, result: vitestFail, isError: true },
    { hero: 'scout', tool: 'Grep', input: { pattern: 'expires' }, result: `${abs('src/auth/token.ts')}\n${abs('src/auth/session.ts')}` },
    { hero: 'scout', tool: 'Read', input: { file_path: abs('docs/architecture.md') } },
    { hero: 'lead', tool: 'Read', input: { file_path: abs('src/auth/token.ts') } },
    { hero: 'squire', tool: 'Read', input: { file_path: abs('src/db/schema.ts') } },
    { hero: 'scout', tool: 'Read', input: { file_path: abs('src/auth/session.ts') } },
    { hero: 'lead', tool: 'Read', input: { file_path: abs('src/auth/token.test.ts') } },
    { hero: 'squire', tool: 'Edit', input: { file_path: abs('src/db/migrate.ts') } },
    { hero: 'lead', tool: 'Edit', input: { file_path: abs('src/auth/token.ts') } },
    { hero: 'scout', tool: 'Read', input: { file_path: abs('src/auth/login.ts') } },
    { hero: 'lead', tool: 'Edit', input: { file_path: abs('src/auth/session.ts') } },
    { hero: 'squire', tool: 'Read', input: { file_path: abs('src/db/pool.ts') } },
    { hero: 'lead', tool: 'Bash', input: { command: 'npx vitest run' }, result: vitestPass },
    { hero: 'squire', tool: 'Write', input: { file_path: abs('src/db/seed.ts') }, result: 'File created successfully' },
    { hero: 'lead', tool: 'Read', input: { file_path: abs('src/ui/Login.tsx') } },
  ];

  let i = 0;
  const timer = setInterval(() => {
    const s = steps[i % steps.length];
    i++;
    const id = `toolu_${i}`;
    const now = () => new Date().toISOString();
    const usage = { input_tokens: 4, cache_read_input_tokens: 40_000 + i * 6_000, cache_creation_input_tokens: 500 };
    appendFileSync(files[s.hero], JSON.stringify({ type: 'assistant', cwd: repo, timestamp: now(), message: { model: models[s.hero], usage, content: [{ type: 'tool_use', id, name: s.tool, input: s.input ?? {} }] } }) + '\n');
    if (s.result !== undefined || s.tool === 'Bash' || s.tool === 'Write') {
      const result = s.result ?? '';
      appendFileSync(files[s.hero], JSON.stringify({ type: 'user', cwd: repo, timestamp: now(), message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: !!s.isError, content: result }] }, toolUseResult: { stdout: result, stderr: '' } }) + '\n');
    }
  }, o.stepMs ?? 1_400);
  timer.unref();
  return { repo, projectsDir, stop: () => clearInterval(timer) };
}
