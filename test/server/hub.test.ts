import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateMap } from '../../src/server/map/generate.js';
import { Hub } from '../../src/server/hub.js';
import type { ServerMessage } from '../../src/shared/protocol.js';

const read = (id: string, file: string) =>
  JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: `/repo/${file}` } }] } });

describe('Hub', () => {
  let hub: Hub | undefined;
  afterEach(() => hub?.close());

  it('parses lines per hero and flushes batches to subscribers', async () => {
    const { map, index } = generateMap(['src/a.ts', 'src/b.ts']);
    hub = new Hub({ repoRoot: '/repo', map, index, flushMs: 20 });
    const got: ServerMessage[] = [];
    hub.subscribe((m) => got.push(m));
    hub.ingest({ hero: 's1', file: 'x' }, read('t1', 'src/a.ts'));
    hub.ingest({ hero: 's1/a', parent: 's1', file: 'y' }, read('t2', 'src/b.ts'));
    await vi.waitFor(() => expect(got.length).toBeGreaterThan(0));
    const evs = got.flatMap((m) => (m.type === 'events' ? m.events : []));
    expect(evs.filter((e) => e.kind === 'move').map((e) => e.hero)).toEqual(['s1', 's1/a']);
    expect(evs.find((e) => e.kind === 'hero_joined' && e.hero === 's1/a')).toMatchObject({ parent: 's1' });
    expect(hub.snapshot().events).toHaveLength(evs.length);
  });

  it('idle and leaving', async () => {
    const { map, index } = generateMap(['a.ts']);
    let now = 1_000;
    hub = new Hub({ repoRoot: '/repo', map, index, flushMs: 10, leaveAfterMs: 500, leaveCheckMs: 20, now: () => now });
    hub.ingest({ hero: 's1', file: 'x' }, read('t1', 'a.ts'));
    hub.onIdle('s1');
    now = 2_000;
    await vi.waitFor(() => expect(hub!.snapshot().events.map((e) => e.kind)).toContain('hero_left'));
    expect(hub.snapshot().events.map((e) => e.kind)).toContain('idle');
  });

  it('caps history but keeps every hero join', () => {
    const { map, index } = generateMap(['a.ts']);
    hub = new Hub({ repoRoot: '/repo', map, index, flushMs: 1, maxHistory: 50 });
    hub.ingest({ hero: 'early', file: 'x' }, read('t0', 'a.ts'));
    for (let i = 0; i < 200; i++) hub.publish([{ t: i, hero: 'h', kind: 'speech', text: String(i) }]);
    const evs = hub.snapshot().events;
    expect(evs.length).toBeLessThanOrEqual(52);
    expect(evs.some((e) => e.kind === 'hero_joined' && e.hero === 'early')).toBe(true);
    expect(evs.at(-1)).toMatchObject({ text: '199' });
  });

  it('updateMap broadcasts the new map', () => {
    const a = generateMap(['a.ts']);
    hub = new Hub({ repoRoot: '/repo', ...a });
    const got: ServerMessage[] = [];
    hub.subscribe((m) => got.push(m));
    const b = generateMap(['a.ts', 'b.ts']);
    hub.updateMap(b.map, b.index);
    expect(got).toEqual([{ type: 'map', map: b.map, index: b.index }]);
    expect(hub.snapshot().map).toBe(b.map);
  });
});
