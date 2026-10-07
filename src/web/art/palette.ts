/** Colors from the approved mockup v3 (moody hi-bit). */
const CLAUDE = { O: '#d97757', o: '#b65f3e', h: '#f2a98a', k: '#1a0f0a', a: '#d97757', d: '#7a3a22' };

export const SPRITE_PALETTES: Record<'scout' | 'adventurer' | 'squire' | 'knight' | 'wizard' | 'slime' | 'goblin' | 'bat' | 'ogre', Record<string, string>> = {
  scout: CLAUDE,
  adventurer: { ...CLAUDE, b: '#6a4a2a', B: '#9a6a3a' },
  squire: { ...CLAUDE, w: '#d6a061', W: '#7a4e2a', b: '#3f7f5a' },
  knight: { ...CLAUDE, m: '#5d6672', M: '#b4bdc8', r: '#a8202c', R: '#e8505e', s: '#eef3f6', g: '#d4a43a', p: '#59626e', P: '#a0aab6' },
  wizard: { ...CLAUDE, V: '#4a2a8c', v: '#5f38ab', y: '#a8f4ff', Y: '#ffffff', l: '#7a4e2a' },
  slime: { r: '#6a0e1c', R: '#d8324a', h: '#ff8a9a', w: '#fff', k: '#2a0008' },
  goblin: { g: '#2f5a1e', G: '#5fa83a', h: '#9be06a', r: '#ff3a3a', k: '#140a04', w: '#fff', b: '#4a3220', B: '#7e5a38', s: '#c8d0d8' },
  bat: { n: '#2a1838', N: '#4a2e66', m: '#7a4a9a', r: '#ff3a4a', w: '#fff' },
  ogre: { e: '#55602a', E: '#8a9a48', h: '#c0cc7a', k: '#1a1208', w: '#fff', b: '#4a2e14', B: '#7a4e24', c: '#4a3220', C: '#7e5a38' },
};

const PROP_BASE = { b: '#4a3220', B: '#7e5a38', d: '#2e2014', p: '#a89878', P: '#e6dcc0', k: '#5a4a3a', y: '#c08a10', Y: '#ffd040', w: '#fffbe0', O: '#ff7020', o: '#c04010' };

export const PROP_PALETTE: Record<'crate' | 'scroll' | 'forged' | 'torch', Record<string, string>> = {
  crate: PROP_BASE,
  scroll: PROP_BASE,
  forged: PROP_BASE,
  torch: { ...PROP_BASE, y: '#ffb030', Y: '#fff0a0' },
};

export const STONE = {
  floor: ['#2f3542', '#343a48', '#2b313d', '#313744'],
  seam: '#222731',
  chip: '#262b36',
  moss: '#2f4a3a',
  front: '#1d222d',
  brick: '#282e3c',
  brickHi: '#323949',
  cap: '#4f5a70',
  capHi: '#6a768e',
  top: '#0f1218',
  void: '#05060a',
  fog: '#040408',
};

export const UI = { gold: '#e6c27a', edge: '#b8955a', ink: '#efe4cc', danger: '#ff4d6d' };

export const CLASS_NAME_COLORS = { knight: '#ffb38a', squire: '#f0c27a', wizard: '#c7a6ff', scout: '#f6c3a6', adventurer: '#d97757' };
