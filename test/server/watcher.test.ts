import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cwdReadCount, isInsideRepo, readSessionCwd } from '../../src/server/session-index.js';
import { SessionWatcher, type LineSource } from '../../src/server/watcher.js';

const line = (cwd: string, i: number) => JSON.stringify({ type: 'user', cwd, i }) + '\n';

describe('isInsideRepo', () => {
  it('handles sibling prefixes and sub-folders', () => {
    expect(isInsideRepo('/a/app-old', '/a/app')).toBe(false);
    expect(isInsideRepo('/a/app/pkg', '/a/app')).toBe(true);
    expect(isInsideRepo('/a/app', '/a/app/')).toBe(true);
    expect(isInsideRepo('/a', '/a/app')).toBe(false);
  });
});

describe('readSessionCwd', () => {
  it('finds cwd in the first lines and caches it in the index file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rd-idx-'));
    const f = path.join(dir, 's.jsonl');
    writeFileSync(f, JSON.stringify({ type: 'summary' }) + '\n' + line('/repo', 1));
    const indexFile = path.join(dir, 'index.json');
    expect(await readSessionCwd(f, indexFile)).toBe('/repo');
    writeFileSync(f, line('/changed', 1));
    expect(await readSessionCwd(f, indexFile)).toBe('/repo');
  });
  it('finds a cwd that appears after the first 64 KB', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rd-idx-'));
    const f = path.join(dir, 's.jsonl');
    writeFileSync(f, JSON.stringify({ type: 'file-history-snapshot', blob: 'x'.repeat(300_000) }) + '\n' + line('/late', 1));
    expect(await readSessionCwd(f, path.join(dir, 'index.json'))).toBe('/late');
  });
  it('does not re-read a cwd-less file until it changes', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rd-idx-'));
    const f = path.join(dir, 's.jsonl');
    writeFileSync(f, '{"type":"ai-title","title":"x"}\n');
    const idx = path.join(dir, 'index.json');
    const before = cwdReadCount();
    for (let i = 0; i < 5; i++) expect(await readSessionCwd(f, idx)).toBeNull();
    expect(cwdReadCount() - before).toBe(1);
    appendFileSync(f, line('/now', 2));
    expect(await readSessionCwd(f, idx)).toBe('/now');
  });
  it('returns null when no cwd is present yet', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rd-idx-'));
    const f = path.join(dir, 's.jsonl');
    writeFileSync(f, '{"type":"summary"}\n');
    expect(await readSessionCwd(f, path.join(dir, 'index.json'))).toBeNull();
  });
});

describe('SessionWatcher', () => {
  let w: SessionWatcher | undefined;
  afterEach(async () => w?.stop());

  it('emits only lines from sessions inside the repo, including subagents', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rd-proj-'));
    const projects = path.join(root, 'projects');
    mkdirSync(path.join(projects, 'p1'), { recursive: true });
    mkdirSync(path.join(projects, 'p2'), { recursive: true });
    const s1 = path.join(projects, 'p1', 's1.jsonl');
    const s2 = path.join(projects, 'p2', 's2.jsonl');
    const old = path.join(projects, 'p1', 'old.jsonl');
    writeFileSync(s1, line('/repo', 0));
    writeFileSync(s2, line('/repo-old', 0));
    writeFileSync(old, line('/repo', 99));
    const longAgo = new Date(Date.now() - 3_600_000);
    utimesSync(old, longAgo, longAgo);

    const got: [LineSource, string][] = [];
    w = new SessionWatcher({ projectsDir: projects, repoRoot: '/repo', indexFile: path.join(root, 'index.json'), pollMs: 30, discoverMs: 60 });
    w.on('line', (src: LineSource, l: string) => got.push([src, l]));
    await w.start();

    await vi.waitFor(() => expect(got.map(([s]) => s.hero)).toContain('s1'), { timeout: 3000 });
    appendFileSync(s1, line('/repo', 1));
    appendFileSync(s2, line('/repo-old', 1));
    mkdirSync(path.join(projects, 'p1', 's1', 'subagents'), { recursive: true });
    writeFileSync(path.join(projects, 'p1', 's1', 'subagents', 'agent-x.jsonl'), line('/repo', 2));
    await vi.waitFor(() => expect(got.some(([s]) => s.hero === 's1/x' && s.parent === 's1')).toBe(true), { timeout: 3000 });
    await vi.waitFor(() => expect(got.filter(([s]) => s.hero === 's1')).toHaveLength(2), { timeout: 3000 });
    expect(got.every(([s]) => s.hero !== 's2')).toBe(true);
    expect(got.some(([, l]) => l.includes('"i":99'))).toBe(false);

    appendFileSync(old, line('/repo', 100));
    await vi.waitFor(() => expect(got.some(([, l]) => l.includes('"i":100'))).toBe(true), { timeout: 3000 });
  });

  it('picks up a brand-new project folder', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rd-proj-'));
    const projects = path.join(root, 'projects');
    mkdirSync(projects);
    const got: string[] = [];
    w = new SessionWatcher({ projectsDir: projects, repoRoot: '/repo', indexFile: path.join(root, 'index.json'), pollMs: 30, discoverMs: 60 });
    w.on('line', (src: LineSource) => got.push(src.hero));
    await w.start();
    mkdirSync(path.join(projects, 'new'));
    writeFileSync(path.join(projects, 'new', 'fresh.jsonl'), line('/repo/sub', 0));
    await vi.waitFor(() => expect(got).toContain('fresh'), { timeout: 3000 });
  });

  it('matches sessions whose cwd goes through a symlink, and reports the alias root', async () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'rd-proj-')));
    const real = path.join(root, 'real-repo');
    mkdirSync(path.join(real, 'pkg'), { recursive: true });
    symlinkSync(real, path.join(root, 'link'));
    const projects = path.join(root, 'projects');
    mkdirSync(path.join(projects, 'p'), { recursive: true });
    writeFileSync(path.join(projects, 'p', 'via-link.jsonl'), line(path.join(root, 'link', 'pkg'), 0));
    const got: LineSource[] = [];
    w = new SessionWatcher({ projectsDir: projects, repoRoot: real, indexFile: path.join(root, 'index.json'), pollMs: 30, discoverMs: 60 });
    w.on('line', (src: LineSource) => got.push(src));
    await w.start();
    await vi.waitFor(() => expect(got[0]).toMatchObject({ hero: 'via-link', aliasRoot: path.join(root, 'link') }), { timeout: 3000 });
  });

  it('emits idle for sessions that stop changing', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rd-proj-'));
    const projects = path.join(root, 'projects');
    mkdirSync(path.join(projects, 'p'), { recursive: true });
    writeFileSync(path.join(projects, 'p', 'quiet.jsonl'), line('/repo', 0));
    const idle: string[] = [];
    w = new SessionWatcher({ projectsDir: projects, repoRoot: '/repo', indexFile: path.join(root, 'index.json'), pollMs: 30, discoverMs: 60, idleAfterMs: 100, idleCheckMs: 50 });
    w.on('idle', (hero: string) => idle.push(hero));
    await w.start();
    await vi.waitFor(() => expect(idle).toEqual(['quiet']), { timeout: 3000 });
  });
});
