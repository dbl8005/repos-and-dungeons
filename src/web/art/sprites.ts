import type { HeroClass } from '../../shared/events.js';

const pad = (rows: string[], total = 15) => [...Array(Math.max(0, total - rows.length)).fill(''), ...rows];

/** 16×16 class sprites from mockup v3, padded so feet sit on row 14. */
export const SPRITES: Record<HeroClass | 'slime', string[]> = {
  scout: pad(['...oOOOOOOOOo...', '...OhhOOOOOOO...', '...OOkOOOOkOO...', '..aOOkOOOOkOOa..', '..aOOOOOOOOOOa..', '...OOOOOOOOOO...', '...oOOOOOOOOo...', '....O.O..O.O....', '....d.d..d.d....']),
  adventurer: pad(['...oOOOOOOOOo...', '...OhhOOOOOOO...', 'bB.OOkOOOOkOO...', 'bBaOOkOOOOkOOa..', 'bBaOOOOOOOOOOa..', 'bB.OOOOOOOOOO...', '...oOOOOOOOOo...', '....O.O..O.O....', '....d.d..d.d....']),
  squire: pad(['..............w.', '...bbbbbbbbbb.w.', '..bOhhOOOOOOO.w.', '...OOkOOOOkOO.w.', '..aOOkOOOOkOOWWW', '..aOOOOOOOOOOaW.', '...OOOOOOOOOO...', '...oOOOOOOOOo...', '....O.O..O.O....', '....d.d..d.d....']),
  knight: pad(['......rr........', '.....rRr......s.', '...mmmmmmmm...s.', '..mMMMMMMMMm..s.', '..mmmmmmmmmm..s.', '...OOkOOOkOO..s.', '...OOkOOOkOO..s.', '..aOOOOOOOOOa.s.', '..apPPPPPPPpaggg', '...pPPgPPgPp..g.', '...ppppppppp....', '....O.O..O.O....', '....d.d..d.d....']),
  wizard: pad(['.........V......', '........VV....y.', '.......VVV...yYy', '......VVyVV...l.', '...VVVVVVVVVV.l.', '...OOkOOOOkOO.l.', '...OOkOOOOkOO.l.', '..aOOOOOOOOOOal.', '..avvvvvvvvvval.', '...vVvvvvvVvv.l.', '...vvvvvvvvvv...', '....d.d..d.d....']),
  slime: pad(['......rrrr......', '....rrRRRRrr....', '...rRRhhRRRRr...', '..rRRwwRRwwRRr..', '..rRRwkRRwkRRr..', '.rRRRRRRRRRRRRr.', '.rRRRRkkkkRRRRr.', '.rRRRRRRRRRRRRr.', '..rrrrrrrrrrrr..']),
};

export const PROPS = {
  crate: ['.bbbbbb.', 'bBBBBBBb', 'bBdBBdBb', 'bbbbbbbb', 'bBBBBBBb', 'bBdBBdBb', 'bBBBBBBb', '.bbbbbb.'],
  scroll: ['........', '.pppppp.', 'pPPPPPPp', 'pPkkkkPp', 'pPPPPPPp', 'pPkkkPPp', '.pppppp.', '........'],
  forged: ['...yy...', '..yYYy..', '.yYwYYy.', 'yYYYYYYy', '.yYYYYy.', '..yYYy..', '...yy...', '........'],
  torch: ['...y....', '..yYy...', '..yOy...', '...o....', '...b....', '...b....', '...b....', '........'],
};

const hex = (h: string): [number, number, number] => {
  const s = h.length === 4 ? h.slice(1).split('').map((c) => c + c).join('') : h.slice(1);
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
};

/** RGBA pixels for a `size`×`size` image; '.' and missing cells are transparent. */
export function spriteToRGBA(rows: string[], palette: Record<string, string>, size: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(size * size * 4);
  rows.forEach((row, y) => {
    for (let x = 0; x < Math.min(row.length, size); x++) {
      const c = palette[row[x]];
      if (row[x] === '.' || !c) continue;
      const [r, g, b] = hex(c);
      px.set([r, g, b, 255], (y * size + x) * 4);
    }
  });
  return px;
}

/** Frame 0 = standing; 1 and 3 lift the left / right feet with a 1-px body bob; 2 strides the feet 1 px. */
export function walkFrames(rows: string[]): string[][] {
  const last = rows.length - 1;
  const feet = [...rows[last]].map((c, i) => (c === '.' ? -1 : i)).filter((i) => i >= 0);
  const half = Math.ceil(feet.length / 2);
  const lift = (keep: (k: number) => boolean) => {
    const r = [...rows];
    r[last] = [...rows[last]].map((c, i) => (feet.includes(i) && !keep(feet.indexOf(i)) ? '.' : c)).join('');
    if (!r[0] || /^\.*$/.test(r[0])) r.push(r.shift()!); // bob up one pixel when there's headroom
    return r;
  };
  const stride = [...rows];
  stride[last] = ('.' + rows[last]).slice(0, 16);
  return [rows, lift((k) => k >= half), stride, lift((k) => k < half)];
}
