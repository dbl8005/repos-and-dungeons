import { inflateSync } from 'node:zlib';

/** RGBA of the first pixel of an 8-bit RGBA/RGB PNG (enough for 1×1 screenshot clips). */
export function firstPixel(png: Buffer): [number, number, number] {
  let pos = 8;
  let colorType = 6;
  const idat: Buffer[] = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString('ascii', pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') colorType = data[9];
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : 3;
  void bpp;
  return [raw[1], raw[2], raw[3]];
}
