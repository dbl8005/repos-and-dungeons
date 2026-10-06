import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Recorder } from '../../src/server/recorder.js';
import { generateMap } from '../../src/server/map/generate.js';

describe('Recorder', () => {
  it('writes the map, then events, lazily and with a dated name', async () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), 'rd-rec-')), 'recordings');
    const r = new Recorder({ dir, repoName: 'acme', now: () => new Date(2026, 9, 6, 14, 5, 9) });
    const a = generateMap(['a.ts']);
    r.map(a.map, a.index);
    expect(existsSync(dir) && readdirSync(dir).length).toBeFalsy();
    r.events([{ t: 1, hero: 'h', kind: 'move', path: 'a.ts' }]);
    const b = generateMap(['a.ts', 'b.ts']);
    r.map(b.map, b.index);
    r.events([{ t: 2, hero: 'h', kind: 'idle' }]);
    await r.close();
    expect(path.basename(r.file!)).toBe('acme-20261006-140509.jsonl');
    const lines = readFileSync(r.file!, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.type)).toEqual(['map', 'event', 'map', 'event']);
    expect(lines[0].map.rooms.length).toBe(1);
    expect(lines[1].event).toMatchObject({ kind: 'move', path: 'a.ts' });
  });
  it('keeps recordings private (dir 0700, files 0600)', async () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), 'rd-rec-')), 'recordings');
    const r = new Recorder({ dir, repoName: 'x' });
    r.events([{ t: 1, hero: 'h', kind: 'idle' }]);
    await r.close();
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(r.file!).mode & 0o777).toBe(0o600);
  });
  it('an unwritable recordings dir never throws; recording just turns off', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'rd-rec-'));
    writeFileSync(path.join(base, 'file'), 'x');
    const r = new Recorder({ dir: path.join(base, 'file', 'recordings'), repoName: 'x' });
    expect(() => r.events([{ t: 1, hero: 'h', kind: 'idle' }])).not.toThrow();
    expect(() => r.events([{ t: 2, hero: 'h', kind: 'idle' }])).not.toThrow();
    expect(r.file).toBeNull();
  });
});
