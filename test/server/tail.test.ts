import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LineTailer, readLastLines } from '../../src/server/tail.js';

const tmp = () => path.join(mkdtempSync(path.join(tmpdir(), 'rd-tail-')), 'f.jsonl');

describe('readLastLines', () => {
  it('returns the last n lines of a big file', async () => {
    const f = tmp();
    const lines = Array.from({ length: 40_000 }, (_, i) => `{"i":${i},"pad":"${'x'.repeat(60)}"}`);
    writeFileSync(f, lines.join('\n') + '\n');
    const r = await readLastLines(f, 5);
    expect(r.lines).toEqual(lines.slice(-5));
    expect(r.endOffset).toBe(Buffer.byteLength(lines.join('\n') + '\n'));
  });
  it('leaves a trailing partial line for the tailer', async () => {
    const f = tmp();
    writeFileSync(f, '{"a":1}\n{"b":');
    const r = await readLastLines(f, 10);
    expect(r.lines).toEqual(['{"a":1}']);
    expect(r.endOffset).toBe(8);
  });
  it('handles empty files and multibyte text', async () => {
    const f = tmp();
    writeFileSync(f, '');
    expect((await readLastLines(f, 3)).lines).toEqual([]);
    writeFileSync(f, '{"s":"ü→🐉"}\n');
    expect((await readLastLines(f, 3)).lines).toEqual(['{"s":"ü→🐉"}']);
  });
});

describe('LineTailer', () => {
  it('buffers partial lines until the newline arrives', async () => {
    const f = tmp();
    writeFileSync(f, '');
    const t = new LineTailer(f, 0);
    appendFileSync(f, '{"a":1}\n{"b"');
    expect(await t.readNew()).toEqual(['{"a":1}']);
    appendFileSync(f, ':2}\n');
    expect(await t.readNew()).toEqual(['{"b":2}']);
    expect(await t.readNew()).toEqual([]);
  });
  it('starts over when the file is truncated', async () => {
    const f = tmp();
    writeFileSync(f, '{"a":1}\n{"b":2}\n');
    const t = new LineTailer(f, 16);
    writeFileSync(f, '{"c":3}\n');
    expect(await t.readNew()).toEqual(['{"c":3}']);
  });
});
