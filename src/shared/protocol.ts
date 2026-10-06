import type { GameEvent } from './events.js';
import type { DungeonMap, PathIndex } from './map-types.js';

/** Server → browser messages over the WebSocket. */
export type ServerMessage =
  | { type: 'hello'; map: DungeonMap; index: PathIndex; events: GameEvent[] }
  | { type: 'events'; events: GameEvent[] }
  | { type: 'map'; map: DungeonMap; index: PathIndex };
