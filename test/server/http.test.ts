import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startHttp } from '../../src/server/http.js';
import { Hub } from '../../src/server/hub.js';
import { generateMap } from '../../src/server/map/generate.js';

const KEY = 'a'.repeat(32);

async function setup() {
  const webDir = mkdtempSync(path.join(tmpdir(), 'rd-web-'));
  writeFileSync(path.join(webDir, 'index.html'), '<h1>dungeon</h1>');
  mkdirSync(path.join(webDir, 'assets'));
  writeFileSync(path.join(webDir, 'assets', 'x.js'), 'console.log(1)');
  const { map, index } = generateMap(['src/a.ts']);
  const hub = new Hub({ repoRoot: '/repo', map, index });
  const srv = await startHttp({ host: '127.0.0.1', port: 0, key: KEY, webDir, hub });
  return { hub, srv, base: new URL(srv.url).origin };
}

describe('startHttp', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => close?.());

  it('requires the key, then sets a cookie', async () => {
    const { srv, hub, base } = await setup();
    close = async () => { await srv.close(); hub.close(); };
    expect((await fetch(`${base}/`)).status).toBe(403);
    expect((await fetch(`${base}/?key=wrong`)).status).toBe(403);
    const ok = await fetch(`${base}/?key=${KEY}`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('dungeon');
    const cookie = ok.headers.get('set-cookie')!;
    expect(cookie).toMatch(/rd_key=a{32}.*HttpOnly.*SameSite=Strict/i);
    const asset = await fetch(`${base}/assets/x.js`, { headers: { cookie: `rd_key=${KEY}` } });
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('javascript');
  });

  it('a multibyte key never crashes the server', async () => {
    const { srv, hub, base } = await setup();
    close = async () => { await srv.close(); hub.close(); };
    const bad = encodeURIComponent('a'.repeat(31) + 'é');
    expect((await fetch(`${base}/?key=${bad}`)).status).toBe(403);
    expect((await fetch(`${base}/`, { headers: { cookie: `rd_key=${'a'.repeat(31)}é` } }).catch(() => ({ status: 0 }))).status).toBe(403);
    const ws = await new Promise<boolean>((resolve) => {
      const s = new WebSocket(`${base.replace('http', 'ws')}/ws?key=${bad}`);
      s.on('open', () => resolve(false));
      s.on('error', () => resolve(true));
    });
    expect(ws).toBe(true);
    expect((await fetch(`${base}/?key=${KEY}`)).status).toBe(200);
  });

  it('blocks path traversal and foreign Host headers', async () => {
    const { srv, hub, base } = await setup();
    close = async () => { await srv.close(); hub.close(); };
    expect((await fetch(`${base}/../../etc/passwd?key=${KEY}`)).status).not.toBe(200);
    expect((await fetch(`${base}/%2e%2e/%2e%2e/etc/passwd?key=${KEY}`)).status).toBe(404);
    const port = new URL(base).port;
    const res = await new Promise<number>((resolve) => {
      import('node:http').then(({ request }) => {
        const r = request({ host: '127.0.0.1', port, path: `/?key=${KEY}`, headers: { host: `evil.example:${port}` } }, (m) => resolve(m.statusCode!));
        r.end();
      });
    });
    expect(res).toBe(403);
  });

  it('WebSocket needs the key and receives hello', async () => {
    const { srv, hub, base } = await setup();
    close = async () => { await srv.close(); hub.close(); };
    const ws = base.replace('http', 'ws');
    const denied = await new Promise<boolean>((resolve) => {
      const s = new WebSocket(`${ws}/ws`);
      s.on('open', () => resolve(false));
      s.on('error', () => resolve(true));
    });
    expect(denied).toBe(true);
    const foreign = await new Promise<boolean>((resolve) => {
      const s = new WebSocket(`${ws}/ws?key=${KEY}`, { headers: { origin: 'https://evil.example' } });
      s.on('open', () => resolve(false));
      s.on('error', () => resolve(true));
    });
    expect(foreign).toBe(true);
    const hello = await new Promise<any>((resolve, reject) => {
      const s = new WebSocket(`${ws}/ws?key=${KEY}`);
      s.on('message', (d) => { resolve(JSON.parse(String(d))); s.close(); });
      s.on('error', reject);
    });
    expect(hello.type).toBe('hello');
    const closed = await new Promise<number>((resolve) => {
      const s = new WebSocket(`${ws}/ws?key=${KEY}`);
      s.on('open', () => s.send('x'.repeat(10_000)));
      s.on('close', (code) => resolve(code));
    });
    expect(closed).toBe(1009);
    expect(hello.map.rooms.length).toBeGreaterThanOrEqual(1);
  });
});
