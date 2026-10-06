import { timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import type { Hub } from './hub.js';

export type HttpOptions = { host: '127.0.0.1'; port: number; key: string; webDir: string; hub: Hub };

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.wasm': 'application/wasm',
};

/** Constant-time compare on bytes (string length can match while byte length differs). */
function sameKey(a: string | undefined, key: string): boolean {
  if (!a) return false;
  const x = Buffer.from(a), y = Buffer.from(key);
  return x.length === y.length && timingSafeEqual(x, y);
}

function cookieKey(req: IncomingMessage): string | undefined {
  return req.headers.cookie?.split(/;\s*/).find((c) => c.startsWith('rd_key='))?.slice(7);
}

/** Local-only HTTP + WebSocket server. Every request needs the session key (query or cookie) and a local Host. */
export async function startHttp(o: HttpOptions): Promise<{ url: string; port: number; close(): Promise<void> }> {
  let port = o.port;
  const localHost = (h: string | undefined) => h === `127.0.0.1:${port}` || h === `localhost:${port}`;
  const authorized = (req: IncomingMessage, url: URL) => sameKey(url.searchParams.get('key') ?? undefined, o.key) || sameKey(cookieKey(req), o.key);
  const root = path.resolve(o.webDir);

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (!localHost(req.headers.host) || !authorized(req, url)) return void res.writeHead(403).end('Forbidden');
    const headers: Record<string, string> = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
    if (url.searchParams.get('key')) headers['set-cookie'] = `rd_key=${o.key}; HttpOnly; SameSite=Strict; Path=/`;
    let rel: string;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      return void res.writeHead(400).end();
    }
    const file = path.resolve(root, '.' + (rel === '/' ? '/index.html' : rel));
    if (file !== root && !file.startsWith(root + path.sep)) return void res.writeHead(404).end();
    const st = await stat(file).catch(() => null);
    if (!st?.isFile()) return void res.writeHead(404, headers).end('Not found');
    res.writeHead(200, { ...headers, 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    createReadStream(file).on('error', () => res.destroy()).pipe(res);
  };

  // Browsers never send anything; a tiny payload cap stops memory abuse.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  server.on('upgrade', (req, socket, head) => {
    try {
      upgrade(req, socket, head);
    } catch {
      socket.destroy();
    }
  });
  const upgrade = (req: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const origin = req.headers.origin;
    const originOk = !origin || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
    if (url.pathname !== '/ws' || !localHost(req.headers.host) || !originOk || !authorized(req, url)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      return void socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.send(JSON.stringify({ type: 'hello', ...o.hub.snapshot() }));
      const off = o.hub.subscribe((m) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m)));
      ws.on('close', off);
      ws.on('error', () => ws.terminate()); // e.g. oversized message; never let it crash the server
    });
  };

  await new Promise<void>((resolve) => server.listen(o.port, o.host, resolve));
  port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/?key=${o.key}`,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of wss.clients) c.terminate();
        wss.close();
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}
