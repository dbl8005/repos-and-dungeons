export type HeroId = string; // sessionId, or `${sessionId}/${agentId}` for subagents
export type HeroClass = 'knight' | 'squire' | 'scout' | 'wizard' | 'adventurer';
export type TestFailure = { file?: string; name: string };

export type GameEvent = { t: number; hero: HeroId } & (
  | { kind: 'hero_joined'; heroClass: HeroClass; parent?: HeroId; label: string }
  | { kind: 'hero_left' }
  | { kind: 'move'; path: string }
  | { kind: 'scout'; paths: string[] }
  | { kind: 'forge'; path: string; created: boolean }
  | { kind: 'cast'; command: string }
  | { kind: 'test_result'; runner: string; failed: TestFailure[]; passed: number }
  | { kind: 'door_locked' }
  | { kind: 'door_opened' }
  | { kind: 'torch'; used: number; max: number }
  | { kind: 'compacted' }
  | { kind: 'speech'; text: string }
  | { kind: 'stamina'; fiveHourPct: number; weeklyPct: number; resetsAt?: number }
  | { kind: 'idle' }
  | { kind: 'thinking' }
);

export type EventKind = GameEvent['kind'];
