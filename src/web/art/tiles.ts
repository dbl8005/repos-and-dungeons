import { fnv1a32 } from '../../shared/hash.js';
import { STONE } from './palette.js';

export const T = 16;
const hs = (x: number, y: number) => fnv1a32(`${x},${y}`) / 4294967296;

export type TileKindPaint = 'floor' | 'wallFront' | 'wallTop';

/**
 * Paints one 16×16 stone tile at pixel (X, Y), deterministic per tile coordinate (ported from mockup v3).
 * `isFloor(x, y)` tells the painter about neighbors for wall caps and shadows.
 */
export function paintTile(c: CanvasRenderingContext2D, kind: TileKindPaint, x: number, y: number, X: number, Y: number, isFloor: (x: number, y: number) => boolean): void {
  if (kind === 'floor') {
    c.fillStyle = STONE.floor[Math.floor(hs(x, y) * 4)];
    c.fillRect(X, Y, T, T);
    c.fillStyle = STONE.seam;
    c.fillRect(X, Y, T, 1);
    c.fillRect(X, Y, 1, T);
    if (hs(x, y + 9) > 0.5) c.fillRect(X + 8, Y + 1, 1, 7);
    if (hs(x + 7, y) > 0.55) {
      c.fillStyle = STONE.chip;
      c.fillRect(X + 3 + Math.floor(hs(x, y + 3) * 9), Y + 4 + Math.floor(hs(y, x) * 9), 2, 1);
    }
    if (hs(x + 3, y + 5) > 0.88) {
      c.fillStyle = STONE.moss;
      c.fillRect(X + 2, Y + 12, 3, 2);
      c.fillRect(X + 4, Y + 11, 2, 1);
    }
    if (!isFloor(x, y - 1)) {
      c.fillStyle = 'rgba(0,0,0,.4)';
      c.fillRect(X, Y, T, 4);
    }
    return;
  }
  if (kind === 'wallFront') {
    c.fillStyle = STONE.front;
    c.fillRect(X, Y, T, T);
    for (let r = 0; r < 3; r++) {
      const off = (r % 2) * 4;
      for (let b = -4; b < T; b += 8) {
        const bx = Math.max(X, X + b + off + 1), bw = Math.min(X + T, X + b + off + 7) - bx;
        if (bw <= 0) continue;
        c.fillStyle = STONE.brick;
        c.fillRect(bx, Y + 4 + r * 4, bw, 3);
        c.fillStyle = STONE.brickHi;
        c.fillRect(bx, Y + 4 + r * 4, bw, 1);
      }
    }
    c.fillStyle = STONE.cap;
    c.fillRect(X, Y, T, 3);
    c.fillStyle = STONE.capHi;
    c.fillRect(X, Y, T, 1);
    return;
  }
  c.fillStyle = STONE.top;
  c.fillRect(X, Y, T, T);
  c.fillStyle = STONE.cap;
  if (isFloor(x, y - 1)) c.fillRect(X, Y, T, 2);
  if (isFloor(x + 1, y)) c.fillRect(X + T - 2, Y, 2, T);
  if (isFloor(x - 1, y)) c.fillRect(X, Y, 2, T);
}
