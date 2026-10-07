import type { Species } from '../../shared/bestiary.js';
import type { HeroClass } from '../../shared/events.js';

export const CANNED_KINDS = ['monster_spawn', 'monster_slain', 'joined', 'compacted', 'forge', 'read', 'idle', 'taunt'] as const;
export type CannedKind = (typeof CANNED_KINDS)[number];

const LINES: Record<CannedKind, string[]> = {
  monster_spawn: ['Something lurks ahead.', 'To arms!', 'Red eyes in the corridor. Beware.'],
  monster_slain: ['The beast is slain!', 'Another foe falls. The halls are quiet.', 'Onward!'],
  joined: ['I answer the call.', 'Reporting for the quest.', 'Lead on, I follow.', 'Another blade joins the party.'],
  compacted: ['My memory fades like mist...', 'Where was I? The map grows dark.', 'The fog swallows what I knew.', 'Strange... these halls feel new again.'],
  forge: ['The forge rings true.', 'Reforged and stronger.', 'Hammer to steel. It is done.', 'A fine piece of craft.'],
  read: ['These old runes speak of much.', 'Let me study this scroll.', 'Hmm. Curious writings here.', 'Knowledge lights the way.'],
  idle: ['A moment by the fire.', 'I rest, but I stay watchful.', 'The torch burns low. I wait.', 'Quiet halls. Too quiet.'],
  taunt: ['Your tests are MINE!', 'You shall not pass... CI!', 'Blub. Blub. Red forever.', 'None escape the failing suite!'],
};

const FLAVOR: Partial<Record<HeroClass, Partial<Record<CannedKind, string[]>>>> = {
  knight: { monster_spawn: ['Stand fast! I will face this beast.', 'For the codebase! Charge!'], monster_slain: ['By my blade, it is done.'] },
  wizard: { monster_spawn: ['I foresaw this foul creature.', 'The runes warned of this.'], read: ['The arcane texts reveal their secrets.'] },
  scout: { read: ['Scouting ahead. Looks clear.', 'Quick look, then onward.'] },
};

/** What heroes say when a species appears or is beaten, on top of the generic monster lines. */
const SPECIES_LINES: Record<Species, { monster_spawn: string[]; monster_slain: string[] }> = {
  slime: {
    monster_spawn: ['A slime! Steel yourselves!', 'Foul tests stir in the dark.', 'To arms! The tests have turned!'],
    monster_slain: ['Green once more. Onward!', 'Victory! The tests pass.', 'Rest easy. The slime is no more.'],
  },
  goblin: {
    monster_spawn: ['Goblins! The types have turned!', 'Mismatched types, and goblins with them.'],
    monster_slain: ['The goblins flee. The types hold.', 'Every type in its place again.'],
  },
  bat: {
    monster_spawn: ['Bats in the rafters! Lint ahead.', 'A swarm of lint bats. Mind your style.'],
    monster_slain: ['The bats scatter. Clean code at last.', 'Not a bat left in the cave.'],
  },
  ogre: {
    monster_spawn: ['An ogre blocks the build!', 'The build is broken. An ogre stirs.'],
    monster_slain: ['The ogre falls. The build stands!', 'It compiles! The ogre is no more.'],
  },
};

/** What the freshly spawned monster shouts, by species (slimes use the generic taunts). */
const TAUNTS: Record<Species, string[]> = {
  slime: LINES.taunt,
  goblin: ['Wrong type, adventurer! Hehehe!', 'Your string is no number!', 'Goblins love a missing property.', 'Cast me if you dare!'],
  bat: ['Skreee! Unused vars, everywhere!', 'Your style offends the cave!', 'Flap flap. Lint forever.', 'Semicolons? We ate them.'],
  ogre: ['OGRE SMASH BUILD!', 'Nothing compiles past me!', 'Ogre eat your artifacts.', 'Build broken. Ogre happy.'],
};

export function tauntLine(species: Species, seed: number): string {
  const pool = TAUNTS[species];
  return pool[Math.abs(Math.floor(seed)) % pool.length];
}

/** Deterministic in-character line for a moment; `seed` picks among the options. */
export function cannedLine(kind: CannedKind, heroClass: HeroClass, seed: number, species: Species = 'slime'): string {
  const bySpecies = kind === 'monster_spawn' || kind === 'monster_slain' ? SPECIES_LINES[species][kind] : [];
  const pool = [...(FLAVOR[heroClass]?.[kind] ?? []), ...bySpecies, ...LINES[kind]];
  return pool[Math.abs(Math.floor(seed)) % pool.length];
}
