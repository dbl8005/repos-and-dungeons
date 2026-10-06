import type { HeroClass } from '../../shared/events.js';

export const CANNED_KINDS = ['monster_spawn', 'monster_slain', 'joined', 'compacted', 'forge', 'read', 'idle', 'taunt'] as const;
export type CannedKind = (typeof CANNED_KINDS)[number];

const LINES: Record<CannedKind, string[]> = {
  monster_spawn: ['A slime! Steel yourselves!', 'Foul tests stir in the dark.', 'Something failing lurks ahead.', 'To arms! The tests have turned!', 'Red eyes in the corridor. Beware.'],
  monster_slain: ['The beast is slain!', 'Green once more. Onward!', 'Another foe falls. The halls are quiet.', 'Victory! The tests pass.', 'Rest easy. The slime is no more.'],
  joined: ['I answer the call.', 'Reporting for the quest.', 'Lead on, I follow.', 'Another blade joins the party.'],
  compacted: ['My memory fades like mist...', 'Where was I? The map grows dark.', 'The fog swallows what I knew.', 'Strange... these halls feel new again.'],
  forge: ['The forge rings true.', 'Reforged and stronger.', 'Hammer to steel. It is done.', 'A fine piece of craft.'],
  read: ['These old runes speak of much.', 'Let me study this scroll.', 'Hmm. Curious writings here.', 'Knowledge lights the way.'],
  idle: ['A moment by the fire.', 'I rest, but I stay watchful.', 'The torch burns low. I wait.', 'Quiet halls. Too quiet.'],
  taunt: ['Your tests are MINE!', 'You shall not pass... CI!', 'Blub. Blub. Red forever.', 'None escape the failing suite!'],
};

const FLAVOR: Partial<Record<HeroClass, Partial<Record<CannedKind, string[]>>>> = {
  knight: { monster_spawn: ['Stand fast! I will face this beast.', 'For the codebase! Charge!'], monster_slain: ['By my blade, it is done.'] },
  wizard: { monster_spawn: ['I foresaw this foul creature.', 'The runes warned of failing tests.'], read: ['The arcane texts reveal their secrets.'] },
  scout: { read: ['Scouting ahead. Looks clear.', 'Quick look, then onward.'] },
};

/** Deterministic in-character line for a moment; `seed` picks among the options. */
export function cannedLine(kind: CannedKind, heroClass: HeroClass, seed: number): string {
  const pool = [...(FLAVOR[heroClass]?.[kind] ?? []), ...LINES[kind]];
  return pool[Math.abs(Math.floor(seed)) % pool.length];
}
