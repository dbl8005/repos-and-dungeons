import { describe, expect, it } from 'vitest';
import { generateMap } from '../../src/server/map/generate.js';
import { gifFrameTimes, pickMimeType } from '../../src/web/timelapse/formats.js';
import { roomAliases, visibleFolderNames } from '../../src/web/timelapse/privacy.js';

describe('pickMimeType', () => {
  it('prefers mp4, falls back to webm', () => {
    expect(pickMimeType(() => true)).toEqual({ mime: 'video/mp4;codecs=avc1', ext: 'mp4' });
    expect(pickMimeType((t) => t.startsWith('video/webm'))).toEqual({ mime: 'video/webm;codecs=vp9', ext: 'webm' });
    expect(pickMimeType((t) => t === 'video/webm')).toEqual({ mime: 'video/webm', ext: 'webm' });
  });
});

describe('gifFrameTimes', () => {
  it('samples at the frame rate', () => {
    const f = gifFrameTimes(2000, 15);
    expect(f).toHaveLength(30);
    expect(f[0]).toBe(0);
    expect(f[1]).toBeCloseTo(66.67, 1);
  });
});

describe('privacy', () => {
  const { map } = generateMap(['src/a.ts', 'src/auth/b.ts', 'docs/x.md', 'secret-client/y.ts', 'README.md']);
  it('renames rooms in map order, root stays "/"', () => {
    const a = roomAliases(map);
    expect(a.get(map.rooms[0].id)).toBe('/');
    expect([...a.values()].slice(1)).toEqual(map.rooms.slice(1).map((_, i) => `Room ${i + 1}`));
  });
  it('lists the folder names that would be visible', () => {
    expect(visibleFolderNames(map)).toEqual(expect.arrayContaining(['docs', 'secret-client', 'src']));
    expect(visibleFolderNames(map, 2)).toHaveLength(2);
  });
});
