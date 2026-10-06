import { describe, expect, it } from 'vitest';
import { PROP_PALETTE, SPRITE_PALETTES } from '../../src/web/art/palette.js';
import { PROPS, SPRITES, spriteToRGBA, walkFrames } from '../../src/web/art/sprites.js';

describe('sprites', () => {
  it('class sprites are at most 16×16 and every pixel has a color', () => {
    for (const [name, rows] of Object.entries(SPRITES)) {
      expect(rows.length, name).toBeLessThanOrEqual(16);
      for (const r of rows) {
        expect(r.length, `${name}: ${r}`).toBeLessThanOrEqual(16);
        for (const ch of r) if (ch !== '.') expect(SPRITE_PALETTES[name as keyof typeof SPRITES][ch], `${name} '${ch}'`).toBeTypeOf('string');
      }
    }
  });
  it('props are 8×8 with colors', () => {
    for (const [name, rows] of Object.entries(PROPS)) {
      expect(rows).toHaveLength(8);
      for (const r of rows) {
        expect(r).toHaveLength(8);
        for (const ch of r) if (ch !== '.') expect(PROP_PALETTE[name as keyof typeof PROPS][ch], `${name} '${ch}'`).toBeTypeOf('string');
      }
    }
  });
  it('spriteToRGBA maps colors and transparency', () => {
    const px = spriteToRGBA(SPRITES.knight, SPRITE_PALETTES.knight, 16);
    expect(px).toHaveLength(16 * 16 * 4);
    expect(px[3]).toBe(0); // (0,0) is '.'
    const row = SPRITES.knight.findIndex((r) => r.includes('O'));
    const col = SPRITES.knight[row].indexOf('O');
    const i = (row * 16 + col) * 4;
    expect([px[i], px[i + 1], px[i + 2], px[i + 3]]).toEqual([0xd9, 0x77, 0x57, 255]);
  });
  it('walkFrames gives 4 frames; frame 0 is the original and the others differ', () => {
    const f = walkFrames(SPRITES.squire);
    expect(f).toHaveLength(4);
    expect(f[0]).toEqual(SPRITES.squire);
    expect(f[1]).not.toEqual(f[0]);
    expect(f[2]).not.toEqual(f[0]);
    for (const fr of f) expect(fr.length).toBeLessThanOrEqual(16);
  });
  it('every hero class has a sprite', () => {
    for (const c of ['knight', 'squire', 'scout', 'wizard', 'adventurer', 'slime']) expect(SPRITES).toHaveProperty(c);
  });
});
