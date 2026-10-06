import type { ServerMessage } from '../shared/protocol.js';

/** Connects to the dungeon server and reconnects with backoff. Auth rides on the cookie set by the page load. */
export function connect(onMessage: (m: ServerMessage) => void, onStatus: (s: string) => void): void {
  let delay = 500;
  const open = () => {
    const key = new URLSearchParams(location.search).get('key');
    const ws = new WebSocket(`ws://${location.host}/ws${key ? `?key=${encodeURIComponent(key)}` : ''}`);
    ws.onopen = () => {
      delay = 500;
      onStatus('live');
    };
    ws.onmessage = (ev) => onMessage(JSON.parse(String(ev.data)) as ServerMessage);
    ws.onclose = () => {
      onStatus('disconnected — retrying…');
      setTimeout(open, delay);
      delay = Math.min(delay * 2, 10_000);
    };
  };
  open();
}
