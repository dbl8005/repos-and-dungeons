#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDungeon } from './server/app.js';

const HELP = `Usage: repos-and-dungeons [repo-path] [options]

Opens your repo as a live dungeon in the browser. Every Claude Code session
running in the repo shows up as a hero.

Options:
  --port <n>     port to listen on (default: a random free port)
  --no-open      don't open the browser
  --no-narrator  no Haiku speech lines (built-in lines still play)
  --demo         watch a scripted demo session in a fake repo (no agent needed)
  --demo-large   the same demo in a ~2,500-file monorepo
  -h, --help     show this help
`;

async function main(argv: string[]) {
  let repo = process.cwd();
  let port = 0;
  let openBrowser = true;
  let demo = false;
  let large = false;
  let narrator = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') return void process.stdout.write(HELP);
    else if (a === '--no-open') openBrowser = false;
    else if (a === '--demo') demo = true;
    else if (a === '--demo-large') demo = large = true;
    else if (a === '--no-narrator') narrator = false;
    else if (a === '--port') port = Number(argv[++i]);
    else if (a.startsWith('-')) throw new Error(`Unknown option: ${a}\n\n${HELP}`);
    else repo = a;
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be a number between 0 and 65535');

  const webDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'web');
  let projectsDir = process.env.RD_PROJECTS_DIR;
  if (demo) {
    const { startDemo } = await import('./server/demo.js');
    const dm = startDemo({ large });
    repo = dm.repo;
    projectsDir = dm.projectsDir;
  }
  const d = await startDungeon({ repo, port, webDir, narrator, ...(projectsDir ? { projectsDir } : {}), ...(demo ? { indexFile: path.join(path.dirname(projectsDir!), 'index.json'), recordingsDir: path.join(path.dirname(projectsDir!), 'recordings') } : {}) });
  process.stdout.write(`Dungeon ready for ${d.repoRoot}\n${d.url}\n`);
  if (openBrowser) await import('open').then((m) => m.default(d.url)).catch(() => {});
  const shutdown = () => void d.close().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
