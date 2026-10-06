import { open, stat } from 'node:fs/promises';

const CHUNK = 64 * 1024;
const NL = 0x0a;

const toLines = (parts: Buffer[]) => parts.map((b) => b.toString('utf8')).filter((l) => l.length > 0);

function splitLines(buf: Buffer): Buffer[] {
  const out: Buffer[] = [];
  let start = 0;
  for (let i = buf.indexOf(NL); i !== -1; i = buf.indexOf(NL, start)) {
    out.push(buf.subarray(start, i));
    start = i + 1;
  }
  out.push(buf.subarray(start));
  return out;
}

/**
 * Last `n` complete lines, reading backwards in 64 KB chunks. A trailing partial line is left out and
 * `endOffset` points at its start, so a LineTailer can pick it up once it's finished.
 */
export async function readLastLines(file: string, n: number): Promise<{ lines: string[]; endOffset: number }> {
  const fh = await open(file, 'r');
  try {
    const { size } = await fh.stat();
    const chunks: Buffer[] = [];
    let pos = size;
    let newlines = 0;
    while (pos > 0 && newlines <= n) {
      const len = Math.min(CHUNK, pos);
      pos -= len;
      const b = Buffer.alloc(len);
      await fh.read(b, 0, len, pos);
      for (const byte of b) if (byte === NL) newlines++;
      chunks.unshift(b);
    }
    const parts = splitLines(Buffer.concat(chunks));
    const partial = parts.pop()!; // bytes after the last newline ('' when the file ends with one)
    if (pos > 0) parts.shift(); // started mid-line
    return { lines: toLines(parts).slice(-n), endOffset: size - partial.length };
  } finally {
    await fh.close();
  }
}

/** Reads lines appended since `offset`, holding back a partial last line until its newline arrives. */
export class LineTailer {
  private remainder = Buffer.alloc(0);
  constructor(readonly file: string, private offset: number) {}

  async readNew(): Promise<string[]> {
    const { size } = await stat(this.file);
    if (size < this.offset) {
      this.offset = 0;
      this.remainder = Buffer.alloc(0);
    }
    if (size === this.offset) return [];
    const fh = await open(this.file, 'r');
    try {
      const b = Buffer.alloc(size - this.offset);
      await fh.read(b, 0, b.length, this.offset);
      this.offset = size;
      const parts = splitLines(Buffer.concat([this.remainder, b]));
      this.remainder = Buffer.from(parts.pop()!);
      return toLines(parts);
    } finally {
      await fh.close();
    }
  }
}
