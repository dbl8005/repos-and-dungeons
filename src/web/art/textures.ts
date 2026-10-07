import { Texture } from 'pixi.js';
import type { Species } from '../../shared/bestiary.js';
import type { HeroClass } from '../../shared/events.js';
import { PROP_PALETTE, SPRITE_PALETTES } from './palette.js';
import { monsterFrames, PROPS, SPRITES, spriteToRGBA, walkFrames } from './sprites.js';

export type PropName = keyof typeof PROPS;
export type ArtTextures = {
  hero: Record<HeroClass, Texture[]>;
  /** Two frames per species. */
  monsters: Record<Species, Texture[]>;
  props: Record<PropName, Texture>;
  /** 128 px white radial gradient, for lights and glows. */
  gradient: Texture;
};

function pixelTexture(rows: string[], palette: Record<string, string>, size: number): Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  ctx.putImageData(new ImageData(spriteToRGBA(rows, palette, size) as Uint8ClampedArray<ArrayBuffer>, size, size), 0, 0);
  const t = Texture.from(cv);
  t.source.scaleMode = 'nearest';
  return t;
}

function gradientTexture(): Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return Texture.from(cv);
}

export function buildTextures(): ArtTextures {
  const classes: HeroClass[] = ['knight', 'squire', 'scout', 'wizard', 'adventurer'];
  const hero = Object.fromEntries(classes.map((c) => [c, walkFrames(SPRITES[c]).map((f) => pixelTexture(f, SPRITE_PALETTES[c], 16))])) as Record<HeroClass, Texture[]>;
  const props = Object.fromEntries(Object.entries(PROPS).map(([k, rows]) => [k, pixelTexture(rows, PROP_PALETTE[k as PropName], 8)])) as Record<PropName, Texture>;
  const species: Species[] = ['slime', 'goblin', 'bat', 'ogre'];
  const monsters = Object.fromEntries(species.map((sp) => [sp, monsterFrames(sp).map((f) => pixelTexture(f, SPRITE_PALETTES[sp], 16))])) as Record<Species, Texture[]>;
  return { hero, monsters, props, gradient: gradientTexture() };
}
