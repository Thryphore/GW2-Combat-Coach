import { cached } from './cache.ts';

export interface SkillInfo {
  id: number;
  name: string;
  slot?: string;
  type?: string;
  weaponType?: string;
  specialization?: number;
  categories?: string[];
  flags?: string[];
  nextChain?: number;
  prevChain?: number;
  comboField?: string;
  comboFinisher?: string;
  icon?: string;
  description?: string;
  rechargeSec?: number;
  fieldDurationSec?: number;
  finisherPercent?: number;
}

export interface TraitInfo {
  id: number;
  name: string;
  icon?: string;
  tier?: number;
  order?: number;
  slot?: string;
  specialization?: number;
  description?: string;
}

export interface SpecializationInfo {
  id: number;
  name: string;
  elite: boolean;
  icon?: string;
  minorTraits: number[];
  majorTraits: number[];
}

export interface WeaponInfo {
  specialization?: number;
  flags: string[];
  skills: { id: number; slot: string; offhand?: string; attunement?: string }[];
}

export interface ProfessionSnapshot {
  generatedAt: string;
  profession: string;
  icon?: string;
  specializations: SpecializationInfo[];
  traits: Record<string, TraitInfo>;
  skills: Record<string, SkillInfo>;
  weapons: Record<string, WeaponInfo>;
  skillsByPalette: [number, number][];
}

/**
 * Elite Insights reports the elite specialization as the profession, so
 * "Virtuoso" has to resolve back to the Mesmer snapshot.
 */
const ELITE_SPEC_TO_PROFESSION: Record<string, string> = {
  dragonhunter: 'Guardian',
  firebrand: 'Guardian',
  willbender: 'Guardian',
  luminary: 'Guardian',
  berserker: 'Warrior',
  spellbreaker: 'Warrior',
  bladesworn: 'Warrior',
  paragon: 'Warrior',
  scrapper: 'Engineer',
  holosmith: 'Engineer',
  mechanist: 'Engineer',
  amalgam: 'Engineer',
  druid: 'Ranger',
  soulbeast: 'Ranger',
  untamed: 'Ranger',
  galeshot: 'Ranger',
  daredevil: 'Thief',
  deadeye: 'Thief',
  specter: 'Thief',
  antiquary: 'Thief',
  tempest: 'Elementalist',
  weaver: 'Elementalist',
  catalyst: 'Elementalist',
  evoker: 'Elementalist',
  chronomancer: 'Mesmer',
  mirage: 'Mesmer',
  virtuoso: 'Mesmer',
  troubadour: 'Mesmer',
  reaper: 'Necromancer',
  scourge: 'Necromancer',
  harbinger: 'Necromancer',
  ritualist: 'Necromancer',
  herald: 'Revenant',
  renegade: 'Revenant',
  vindicator: 'Revenant',
  conduit: 'Revenant',
};

/** Snapshots shipped with the app. Add a profession here after generating its file. */
const SNAPSHOT_LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  guardian: () => import('../data/gw2/guardian.json'),
  warrior: () => import('../data/gw2/warrior.json'),
  engineer: () => import('../data/gw2/engineer.json'),
  ranger: () => import('../data/gw2/ranger.json'),
  thief: () => import('../data/gw2/thief.json'),
  elementalist: () => import('../data/gw2/elementalist.json'),
  mesmer: () => import('../data/gw2/mesmer.json'),
  necromancer: () => import('../data/gw2/necromancer.json'),
  revenant: () => import('../data/gw2/revenant.json'),
};

export function baseProfessionOf(professionOrSpec: string): string {
  const key = professionOrSpec.toLowerCase();
  return ELITE_SPEC_TO_PROFESSION[key] ?? professionOrSpec;
}

export interface ChainPosition {
  rootId: number;
  /** 1-based position within the chain. */
  step: number;
  length: number;
  nextId?: number;
}

/** Queryable view over a profession snapshot. */
export class SkillIndex {
  private readonly byName = new Map<string, SkillInfo>();
  private readonly paletteToSkill = new Map<number, number>();
  private readonly chains = new Map<number, ChainPosition>();
  private readonly extra = new Map<number, SkillInfo>();

  constructor(private readonly snapshot: ProfessionSnapshot) {
    for (const skill of Object.values(snapshot.skills)) {
      const key = skill.name.toLowerCase();
      if (!this.byName.has(key)) this.byName.set(key, skill);
    }
    for (const [palette, skillId] of snapshot.skillsByPalette) {
      this.paletteToSkill.set(palette, skillId);
    }
    this.buildChains();
  }

  get profession(): string {
    return this.snapshot.profession;
  }

  get generatedAt(): string {
    return this.snapshot.generatedAt;
  }

  get specializations(): SpecializationInfo[] {
    return this.snapshot.specializations;
  }

  get weapons(): Record<string, WeaponInfo> {
    return this.snapshot.weapons;
  }

  private skillRecord(id: number): SkillInfo | undefined {
    return this.snapshot.skills[String(id)] ?? this.extra.get(id);
  }

  /**
   * Chains are stored as `next_chain` links; walking from every root produces the
   * ordered steps used by the auto-attack chain check.
   */
  private buildChains(): void {
    this.chains.clear();
    const skills = [...Object.values(this.snapshot.skills), ...this.extra.values()];
    const roots = skills.filter((skill) => skill.nextChain && !skill.prevChain);
    for (const root of roots) {
      const sequence: SkillInfo[] = [root];
      let cursor: SkillInfo | undefined = root;
      const guard = new Set<number>([root.id]);
      while (cursor?.nextChain) {
        const next = this.skillRecord(cursor.nextChain);
        if (!next || guard.has(next.id)) break;
        guard.add(next.id);
        sequence.push(next);
        cursor = next;
      }
      if (sequence.length < 2) continue;
      sequence.forEach((skill, i) => {
        this.chains.set(skill.id, {
          rootId: root.id,
          step: i + 1,
          length: sequence.length,
          nextId: sequence[i + 1]?.id,
        });
      });
    }
  }

  skill(id: number): SkillInfo | undefined {
    return this.snapshot.skills[String(id)] ?? this.extra.get(id);
  }

  skillByName(name: string): SkillInfo | undefined {
    return this.byName.get(name.toLowerCase());
  }

  /** Snapshot skills plus any live-fetched extras, for UI name linking. */
  listSkills(): SkillInfo[] {
    const seen = new Set<number>();
    const out: SkillInfo[] = [];
    for (const skill of Object.values(this.snapshot.skills)) {
      seen.add(skill.id);
      out.push(skill);
    }
    for (const skill of this.extra.values()) {
      if (seen.has(skill.id)) continue;
      out.push(skill);
    }
    return out;
  }

  trait(id: number): TraitInfo | undefined {
    return this.snapshot.traits[String(id)];
  }

  traitByName(name: string): TraitInfo | undefined {
    const wanted = name.toLowerCase();
    return Object.values(this.snapshot.traits).find((trait) => trait.name.toLowerCase() === wanted);
  }

  listTraits(): TraitInfo[] {
    return Object.values(this.snapshot.traits);
  }

  specialization(id: number): SpecializationInfo | undefined {
    return this.snapshot.specializations.find((spec) => spec.id === id);
  }

  specializationByName(name: string): SpecializationInfo | undefined {
    const wanted = name.toLowerCase();
    return this.snapshot.specializations.find((spec) => spec.name.toLowerCase() === wanted);
  }

  /**
   * Major traits are ordered by tier then position, so a build template's
   * (tier, position) pair maps onto index `tier * 3 + position`.
   */
  majorTrait(specializationId: number, tier: number, position: number): TraitInfo | undefined {
    const spec = this.specialization(specializationId);
    if (!spec) return undefined;
    const id = spec.majorTraits[tier * 3 + position];
    return id === undefined ? undefined : this.trait(id);
  }

  chainPosition(skillId: number): ChainPosition | undefined {
    return this.chains.get(skillId);
  }

  skillForPalette(palette: number): SkillInfo | undefined {
    const id = this.paletteToSkill.get(palette);
    return id === undefined ? undefined : this.skill(id);
  }

  /** Adds skills fetched live so later lookups hit memory. */
  addSkills(skills: SkillInfo[]): void {
    let added = false;
    for (const skill of skills) {
      if (this.snapshot.skills[String(skill.id)] || this.extra.has(skill.id)) continue;
      this.extra.set(skill.id, skill);
      const key = skill.name.toLowerCase();
      if (!this.byName.has(key)) this.byName.set(key, skill);
      added = true;
    }
    // Live-fetched chain members need to participate in chainPosition().
    if (added) this.buildChains();
  }
}

const indexCache = new Map<string, Promise<SkillIndex | undefined>>();

/** Loads the snapshot for a profession or elite specialization name. */
export function loadSkillIndex(professionOrSpec: string): Promise<SkillIndex | undefined> {
  const key = baseProfessionOf(professionOrSpec).toLowerCase();
  const existing = indexCache.get(key);
  if (existing) return existing;

  const loader = SNAPSHOT_LOADERS[key];
  if (!loader) return Promise.resolve(undefined);

  const promise = loader()
    .then((module) => new SkillIndex(module.default as ProfessionSnapshot))
    .catch(() => undefined);
  indexCache.set(key, promise);
  return promise;
}

const LIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Fallback for skill ids absent from the snapshot, such as relic procs and
 * consumables. Failures are non-fatal: the analysis just loses some metadata.
 */
export async function fetchSkillsLive(ids: number[]): Promise<SkillInfo[]> {
  const unique = [...new Set(ids)].filter((id) => Number.isFinite(id) && id > 0);
  if (unique.length === 0) return [];

  const results: SkillInfo[] = [];
  for (let i = 0; i < unique.length; i += 200) {
    const batch = unique.slice(i, i + 200);
    const key = `gw2:skills:${batch.join(',')}`;
    try {
      const skills = await cached(key, LIVE_TTL_MS, async () => {
        const response = await fetch(`https://api.guildwars2.com/v2/skills?ids=${batch.join(',')}`);
        // 206 means part of the batch does not exist; the rest is still usable.
        if (!response.ok && response.status !== 206) throw new Error(`HTTP ${response.status}`);
        const raw = (await response.json()) as Record<string, unknown>[];
        return raw.map(mapLiveSkill);
      });
      results.push(...skills);
    } catch {
      // Ignore: the snapshot already covers the skills the checks depend on.
    }
  }
  return results;
}

function mapLiveSkill(raw: Record<string, unknown>): SkillInfo {
  const facts = (raw.facts as { type?: string; value?: number; duration?: number }[] | undefined) ?? [];
  const recharge = facts.find((fact) => fact.type === 'Recharge')?.value;
  return {
    id: raw.id as number,
    name: (raw.name as string) ?? `Skill ${raw.id}`,
    slot: raw.slot as string | undefined,
    type: raw.type as string | undefined,
    weaponType: raw.weapon_type as string | undefined,
    categories: raw.categories as string[] | undefined,
    flags: raw.flags as string[] | undefined,
    nextChain: raw.next_chain as number | undefined,
    prevChain: raw.prev_chain as number | undefined,
    comboField: raw.combo_field as string | undefined,
    comboFinisher: raw.combo_finisher as string | undefined,
    icon: raw.icon as string | undefined,
    description: raw.description as string | undefined,
    rechargeSec: typeof recharge === 'number' && recharge > 0 ? recharge : undefined,
  };
}

export function skillIconUrl(skill: SkillInfo | undefined): string | undefined {
  return skill?.icon;
}
