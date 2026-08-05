import type { SkillIndex } from '../api/gw2.ts';
import type { NormalizedLog, NormalizedPlayer } from './normalize.ts';

export interface BuildSkillRef {
  id?: number;
  name: string;
  slot?: string;
  icon?: string;
}

export type TraitEvidence = 'damage-modifier' | 'personal-buff' | 'chat-code';

export interface BuildTraitRef {
  id?: number;
  name: string;
  specialization?: string;
  icon?: string;
  tier?: number;
  /** How we know the trait was slotted. */
  evidence: TraitEvidence;
}

export interface InferredBuild {
  profession: string;
  weaponSets: string[][];
  heal?: BuildSkillRef;
  utilities: BuildSkillRef[];
  elite?: BuildSkillRef;
  traits: BuildTraitRef[];
  specializations: string[];
  /**
   * Logs do not record traits directly, so slotted traits are inferred from the
   * damage modifiers and personal buffs Elite Insights attributes to them. A
   * trait that never triggered during the fight is invisible to this.
   */
  notes: string[];
}

export interface ReferenceSpecialization {
  id?: number;
  name: string;
  traits: BuildTraitRef[];
}

export interface ReferenceBuild {
  name: string;
  source: 'metabattle' | 'chat-code';
  url?: string;
  profession: string;
  eliteSpec?: string;
  weapons: string[];
  heal?: BuildSkillRef;
  utilities: BuildSkillRef[];
  elite?: BuildSkillRef;
  specializations: ReferenceSpecialization[];
  chatCode?: string;
  attribution?: string;
}

function toSkillRef(id: number, skills: SkillIndex | undefined, fallbackName: string): BuildSkillRef {
  const skill = skills?.skill(id);
  return {
    id,
    name: skill?.name ?? fallbackName,
    slot: skill?.slot,
    icon: skill?.icon,
  };
}

/**
 * Reconstructs what the player was running from what the log actually observed:
 * weapon sets, the skills they cast, and the traits Elite Insights credited with
 * damage modifiers or personal buffs.
 */
export function inferBuild(
  log: NormalizedLog,
  player: NormalizedPlayer,
  skills: SkillIndex | undefined,
): InferredBuild {
  const notes: string[] = [];

  const weaponSets = player.weaponSets.map((set) => set.weapons);

  const seen = new Set<number>();
  let heal: BuildSkillRef | undefined;
  let elite: BuildSkillRef | undefined;
  const utilities: BuildSkillRef[] = [];

  for (const cast of player.casts) {
    if (seen.has(cast.skillId)) continue;
    seen.add(cast.skillId);
    const slot = skills?.skill(cast.skillId)?.slot;
    if (!slot) continue;
    const ref = toSkillRef(cast.skillId, skills, cast.name);
    if (slot === 'Heal' && !heal) heal = ref;
    else if (slot === 'Elite' && !elite) elite = ref;
    else if (slot === 'Utility' && utilities.length < 3) utilities.push(ref);
  }

  if (!heal) notes.push('No healing skill was cast, so it could not be identified.');
  if (utilities.length < 3) {
    notes.push('Utility skills that were never cast cannot be identified from a log.');
  }

  const traits = new Map<string, BuildTraitRef>();

  for (const modifier of player.damageModifiers) {
    if (modifier.hitCount <= 0) continue;
    const trait = skills?.traitByName(modifier.name);
    if (!trait) continue;
    traits.set(trait.name, {
      id: trait.id,
      name: trait.name,
      icon: trait.icon,
      tier: trait.tier,
      specialization: skills?.specialization(trait.specialization ?? -1)?.name,
      evidence: 'damage-modifier',
    });
  }

  const personalBuffIds = log.personalBuffs[player.profession] ?? [];
  for (const buffId of personalBuffIds) {
    const timeline = player.buffs.get(buffId);
    if (!timeline || timeline.uptimeMs() <= 0) continue;
    const buffName = log.buffs.get(buffId)?.name;
    if (!buffName) continue;
    const trait = skills?.traitByName(buffName);
    if (!trait || traits.has(trait.name)) continue;
    traits.set(trait.name, {
      id: trait.id,
      name: trait.name,
      icon: trait.icon,
      tier: trait.tier,
      specialization: skills?.specialization(trait.specialization ?? -1)?.name,
      evidence: 'personal-buff',
    });
  }

  const specializations = [
    ...new Set([...traits.values()].map((trait) => trait.specialization).filter((name): name is string => !!name)),
  ];

  if (traits.size === 0) {
    notes.push(
      'No traits could be inferred. Elite Insights only exposes traits indirectly, through damage modifiers and personal buffs.',
    );
  }

  return {
    profession: player.profession,
    weaponSets,
    heal,
    utilities,
    elite,
    traits: [...traits.values()].sort((a, b) => a.name.localeCompare(b.name)),
    specializations,
    notes,
  };
}
