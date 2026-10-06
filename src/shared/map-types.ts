export type TileKind = 'code' | 'test' | 'doc' | 'config' | 'asset';

export type Rect = { x: number; y: number; w: number; h: number };
export type Alcove = Rect & { path: string };
export type Room = Rect & { id: string; path: string; alcoves: Alcove[] };

/** One floor tile. Holds a contiguous, sorted range of files (a bucket) when a room is crowded. */
export type Tile = {
  id: number;
  room: string;
  x: number;
  y: number;
  kind: TileKind;
  files: [first: string, last: string];
  count: number;
};

export type Corridor = { from: string; to: string; cells: [number, number][] };
export type Decor = { x: number; y: number; kind: string };

export type DungeonMap = {
  seed: string;
  width: number;
  height: number;
  rooms: Room[];
  tiles: Tile[];
  corridors: Corridor[];
  decor: Decor[];
};

/** Repo-relative path → tile id. */
export type PathIndex = Record<string, number>;
