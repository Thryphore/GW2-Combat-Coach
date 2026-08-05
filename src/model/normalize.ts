import type {
  EIBuffDesc,
  EIConsumable,
  EIDamageModDesc,
  EILog,
  EIPlayer,
  EIPlayerBuffsGeneration,
  EISkillDesc,
} from '../api/eiTypes.ts';
import type { LogSource } from '../api/logSource.ts';
import { StackTimeline, type Interval } from './timeline.ts';

/** Food = Nourishment, utility = Enhancement (oils, writs, stones). */
export type ConsumableKind = 'food' | 'utility' | 'other';

export interface NormalizedConsumable {
  id: number;
  name: string;
  kind: ConsumableKind;
  icon?: string;
  /** ms from fight start; negative means the buff was already active. */
  time: number;
  durationMs: number;
}

export interface NormalizedCast {
  /** Position in the player's cast sequence. */
  index: number;
  skillId: number;
  name: string;
  /** ms from log start. */
  time: number;
  /** Animation duration in ms. */
  duration: number;
  endTime: number;
  /** Positive: cancelled after firing. Negative: aborted, time wasted. */
  timeGained: number;
  quickness: number;
  isAutoAttack: boolean;
  isInstant: boolean;
  isWeaponSwap: boolean;
}

export interface NormalizedWeaponSet {
  weapons: string[];
  start: number;
  end: number;
}

/**
 * Where a tracked damage bonus comes from. Prefer a specific label over the
 * generic "damage modifier" wording in the UI.
 */
export type DamageModifierSource =
  | 'food'
  | 'utility'
  | 'relic'
  | 'sigil'
  | 'rune'
  | 'trait'
  | 'skill'
  | 'item'
  | 'other';

export interface NormalizedDamageModifier {
  id: number;
  name: string;
  hitCount: number;
  totalHitCount: number;
  damageGain: number;
  /** Share of eligible hits that benefited, 0-1. */
  hitRatio: number;
  source: DamageModifierSource;
}

export interface NormalizedSkillDamage {
  skillId: number;
  name: string;
  damage: number;
  hits: number;
  connectedHits: number;
  indirect: boolean;
}

export interface NormalizedPlayer {
  name: string;
  account: string;
  group: number;
  profession: string;
  firstAware: number;
  lastAware: number;
  activeTimeMs: number;
  dps: number;
  damage: number;
  casts: NormalizedCast[];
  buffs: Map<number, StackTimeline>;
  weaponSets: NormalizedWeaponSet[];
  damageModifiers: NormalizedDamageModifier[];
  damageBySkill: Map<number, NormalizedSkillDamage>;
  /**
   * Outgoing squad/group buff generation keyed by buff id.
   * Values are Elite Insights generation percentages for the full fight.
   */
  buffGeneration: Map<number, number>;
  /** Food / utility / other consumables active at fight start. */
  consumables: NormalizedConsumable[];
  deaths: number;
  downs: number;
  dodges: number;
  weaponSwaps: number;
  /** Time in ms lost to aborted casts, as reported by Elite Insights. */
  reportedTimeWastedMs: number;
  reportedTimeSavedMs: number;
}

export interface NormalizedPhase extends Interval {
  name: string;
  isFullFight: boolean;
}

export interface NormalizedLog {
  source: LogSource;
  fightName: string;
  durationMs: number;
  success: boolean;
  isCM: boolean;
  isLateStart: boolean;
  gw2Build: number;
  eliteInsightsVersion: string;
  arcVersion: string;
  recordedBy: string;
  startedAt: string;
  fullFight: NormalizedPhase;
  phases: NormalizedPhase[];
  players: NormalizedPlayer[];
  skills: Map<number, EISkillDesc>;
  buffs: Map<number, EIBuffDesc>;
  damageMods: Map<number, EIDamageModDesc>;
  personalBuffs: Record<string, number[]>;
  targetNames: string[];
  logErrors: string[];
}

/** Strips the "s"/"b"/"d" prefix Elite Insights uses on map keys. */
function parseMap<T>(source: Record<string, T> | undefined): Map<number, T> {
  const map = new Map<number, T>();
  if (!source) return map;
  for (const [key, value] of Object.entries(source)) {
    const id = Number(key.replace(/^[a-z]/i, ''));
    if (Number.isFinite(id)) map.set(id, value);
  }
  return map;
}

/** Rewrites Wingman/EI cache icon paths to render.guildwars2.com URLs. */
export function resolveEiIcon(icon: string | undefined): string | undefined {
  if (!icon) return undefined;
  if (icon.startsWith('https://') || icon.startsWith('http://')) return icon;
  const cached = icon.match(/^\/cache\/https_render\.guildwars2\.com_file_([A-Fa-f0-9]+)_(\d+)\.png$/i);
  if (cached) return `https://render.guildwars2.com/file/${cached[1]}/${cached[2]}.png`;
  return undefined;
}

export function consumableKindFromBuff(
  desc: EIBuffDesc | undefined,
  uniqueSlot?: number,
): ConsumableKind {
  const classification = desc?.classification;
  if (classification === 'Nourishment' || uniqueSlot === 1) return 'food';
  if (classification === 'Enhancement' || uniqueSlot === 2) return 'utility';
  return 'other';
}

const SKIPPED_CONSUMABLE_NAMES = new Set(['malnourished', 'diminished']);

/**
 * Picks the food, utility, and other consumable that were active when the fight
 * started (one per kind). Mid-fight refreshes are ignored for build display.
 */
export function normalizeConsumables(
  consumables: EIConsumable[] | undefined,
  buffs: Map<number, EIBuffDesc>,
): NormalizedConsumable[] {
  const activeAtStart: NormalizedConsumable[] = [];
  for (const entry of consumables ?? []) {
    const desc = buffs.get(entry.id);
    const name = desc?.name ?? `Consumable ${entry.id}`;
    if (SKIPPED_CONSUMABLE_NAMES.has(name.toLowerCase())) continue;
    const normalized: NormalizedConsumable = {
      id: entry.id,
      name,
      kind: consumableKindFromBuff(desc, entry.uniqueSlot),
      icon: resolveEiIcon(desc?.icon),
      time: entry.time,
      durationMs: entry.duration,
    };
    if (normalized.time <= 0 && normalized.time + normalized.durationMs > 0) {
      activeAtStart.push(normalized);
    }
  }
  activeAtStart.sort((a, b) => a.time - b.time);

  const byKind = new Map<ConsumableKind, NormalizedConsumable>();
  for (const entry of activeAtStart) {
    if (!byKind.has(entry.kind)) byKind.set(entry.kind, entry);
  }

  const ordered: NormalizedConsumable[] = [];
  for (const kind of ['food', 'utility', 'other'] as const) {
    const entry = byKind.get(kind);
    if (entry) ordered.push(entry);
  }
  return ordered;
}

function consumableKindByName(
  buffs: Map<number, EIBuffDesc>,
  name: string,
): Exclude<ConsumableKind, 'other'> | undefined {
  const wanted = name.toLowerCase();
  for (const desc of buffs.values()) {
    if (desc.name?.toLowerCase() !== wanted) continue;
    const kind = consumableKindFromBuff(desc);
    if (kind === 'food' || kind === 'utility') return kind;
  }
  return undefined;
}

const DAMAGE_MODIFIER_SOURCE_LABEL: Record<DamageModifierSource, string> = {
  food: 'Food',
  utility: 'Utility',
  relic: 'Relic',
  sigil: 'Sigil',
  rune: 'Rune',
  trait: 'Trait',
  skill: 'Skill',
  item: 'Item',
  other: 'Bonus',
};

export function damageModifierSourceLabel(source: DamageModifierSource): string {
  return DAMAGE_MODIFIER_SOURCE_LABEL[source];
}

/** "Utility · Writ of Masterful Malice" */
export function formatDamageModifierName(mod: {
  name: string;
  source: DamageModifierSource;
}): string {
  return `${damageModifierSourceLabel(mod.source)} · ${mod.name}`;
}

/**
 * Classifies a damage bonus so the UI can say food / relic / trait / etc.
 * instead of the generic "damage modifier".
 */
export function classifyDamageModifierSource(
  name: string,
  options: {
    buffs?: Map<number, EIBuffDesc>;
    personalIds?: Set<number>;
    modId?: number;
    skillBased?: boolean;
  } = {},
): DamageModifierSource {
  const consumable = options.buffs ? consumableKindByName(options.buffs, name) : undefined;
  if (consumable) return consumable;

  if (/^Relic of /i.test(name) || name === 'Bloodstone Fervor') return 'relic';
  if (/sigil/i.test(name)) return 'sigil';
  if (/rune/i.test(name)) return 'rune';
  // EI names food-sourced strike bonuses this way (e.g. Seaweed Salad → Moving Bonus).
  if (name === 'Moving Bonus' || /^Food:/i.test(name) || /^Ascended Food:/i.test(name)) {
    return 'food';
  }

  if (options.modId !== undefined && options.personalIds?.has(options.modId)) return 'trait';
  if (options.skillBased) return 'skill';
  return 'item';
}

function normalizeWeaponSets(player: EIPlayer, fightEnd: number): NormalizedWeaponSet[] {
  const sets = player.weaponSets
    ?.map((set) => ({
      weapons: (set.weapons ?? []).filter((w) => w && w !== 'Unknown' && w !== '2Hand'),
      start: set.start ?? 0,
      end: set.end ?? fightEnd,
    }))
    .filter((set) => set.weapons.length > 0);

  if (sets?.length) return sets;

  // Older logs only expose the deprecated flat `weapons` array: indices 0-1 are
  // the first land set and 2-3 the second.
  const flat = player.weapons ?? [];
  const land = [flat.slice(0, 2), flat.slice(2, 4)]
    .map((weapons) => weapons.filter((w) => w && w !== 'Unknown' && w !== '2Hand'))
    .filter((weapons) => weapons.length > 0);
  return land.map((weapons) => ({ weapons, start: 0, end: fightEnd }));
}

function normalizePlayer(
  player: EIPlayer,
  log: EILog,
  skills: Map<number, EISkillDesc>,
  buffDescs: Map<number, EIBuffDesc>,
): NormalizedPlayer {
  const fightEnd = log.durationMS ?? 0;

  const casts: NormalizedCast[] = [];
  for (const rotation of player.rotation ?? []) {
    const desc = skills.get(rotation.id);
    for (const cast of rotation.skills ?? []) {
      casts.push({
        index: 0,
        skillId: rotation.id,
        name: desc?.name ?? `Skill ${rotation.id}`,
        time: cast.castTime,
        duration: cast.duration,
        endTime: cast.castTime + Math.max(0, cast.duration),
        timeGained: cast.timeGained ?? 0,
        quickness: cast.quickness ?? 0,
        isAutoAttack: desc?.autoAttack === true,
        isInstant: desc?.isInstantCast === true || cast.duration === 0,
        isWeaponSwap: desc?.isSwap === true,
      });
    }
  }
  casts.sort((a, b) => a.time - b.time);
  casts.forEach((cast, index) => {
    cast.index = index;
  });

  const buffs = new Map<number, StackTimeline>();
  for (const buff of player.buffUptimes ?? []) {
    buffs.set(buff.id, new StackTimeline(buff.states ?? [], fightEnd));
  }

  const damageModifiers: NormalizedDamageModifier[] = [];
  const damageModMap = parseMap(log.damageModMap);
  const personalModIds = new Set(log.personalDamageMods?.[player.profession ?? ''] ?? []);
  for (const mod of player.damageModifiers ?? []) {
    const entry = mod.damageModifiers?.[0];
    if (!entry) continue;
    const hitCount = entry.hitCount ?? 0;
    const totalHitCount = entry.totalHitCount ?? 0;
    const desc = damageModMap.get(mod.id);
    const name = desc?.name ?? `Modifier ${mod.id}`;
    damageModifiers.push({
      id: mod.id,
      name,
      hitCount,
      totalHitCount,
      damageGain: entry.damageGain ?? 0,
      hitRatio: totalHitCount > 0 ? hitCount / totalHitCount : 0,
      source: classifyDamageModifierSource(name, {
        buffs: buffDescs,
        personalIds: personalModIds,
        modId: mod.id,
        skillBased: desc?.skillBased === true,
      }),
    });
  }

  const damageBySkill = new Map<number, NormalizedSkillDamage>();
  for (const dist of player.totalDamageDist?.[0] ?? []) {
    const existing = damageBySkill.get(dist.id);
    const damage = dist.totalDamage ?? 0;
    const hits = dist.hits ?? 0;
    const connectedHits = dist.connectedHits ?? hits;
    if (existing) {
      existing.damage += damage;
      existing.hits += hits;
      existing.connectedHits += connectedHits;
    } else {
      damageBySkill.set(dist.id, {
        skillId: dist.id,
        name: skills.get(dist.id)?.name ?? `Skill ${dist.id}`,
        damage,
        hits,
        connectedHits,
        indirect: dist.indirectDamage === true,
      });
    }
  }

  const stats = player.statsAll?.[0];
  const defenses = player.defenses?.[0];
  const buffGeneration = mergeBuffGeneration(player.squadBuffs, player.groupBuffs);

  return {
    name: player.name ?? 'Unknown',
    account: player.account ?? '',
    group: player.group ?? 0,
    profession: player.profession ?? 'Unknown',
    firstAware: player.firstAware ?? 0,
    lastAware: player.lastAware ?? fightEnd,
    activeTimeMs: player.activeTimes?.[0] ?? fightEnd,
    dps: player.dpsAll?.[0]?.dps ?? 0,
    damage: player.dpsAll?.[0]?.damage ?? 0,
    casts,
    buffs,
    weaponSets: normalizeWeaponSets(player, fightEnd),
    damageModifiers,
    damageBySkill,
    buffGeneration,
    consumables: normalizeConsumables(player.consumables, buffDescs),
    deaths: defenses?.deadCount ?? 0,
    downs: defenses?.downCount ?? 0,
    dodges: defenses?.dodgeCount ?? 0,
    weaponSwaps: stats?.swapCount ?? 0,
    // Elite Insights reports these in seconds.
    reportedTimeWastedMs: Math.round((stats?.timeWasted ?? 0) * 1000),
    reportedTimeSavedMs: Math.round((stats?.timeSaved ?? 0) * 1000),
  };
}

/** Keeps the stronger of squad vs group generation for each buff. */
function mergeBuffGeneration(...sources: (EIPlayerBuffsGeneration[] | undefined)[]): Map<number, number> {
  const merged = new Map<number, number>();
  for (const list of sources) {
    for (const entry of list ?? []) {
      const generation = entry.buffData?.[0]?.generation ?? 0;
      if (generation <= 0) continue;
      const existing = merged.get(entry.id) ?? 0;
      if (generation > existing) merged.set(entry.id, generation);
    }
  }
  return merged;
}

export function normalizeLog(raw: EILog, source: LogSource): NormalizedLog {
  const durationMs = raw.durationMS ?? 0;
  const skills = parseMap(raw.skillMap);
  const buffs = parseMap(raw.buffMap);

  const phases: NormalizedPhase[] = (raw.phases ?? []).map((phase, index) => ({
    start: phase.start,
    end: phase.end,
    name: phase.name ?? (index === 0 ? 'Full Fight' : `Phase ${index}`),
    isFullFight: index === 0,
  }));
  const fullFight: NormalizedPhase = phases[0] ?? {
    start: 0,
    end: durationMs,
    name: 'Full Fight',
    isFullFight: true,
  };

  const players = (raw.players ?? [])
    .filter((player) => !player.friendlyNPC)
    .map((player) => normalizePlayer(player, raw, skills, buffs));

  return {
    source,
    fightName: raw.fightName ?? raw.name ?? 'Unknown encounter',
    durationMs,
    success: raw.success === true,
    isCM: raw.isCM === true,
    isLateStart: raw.isLateStart === true,
    gw2Build: raw.gW2Build ?? 0,
    eliteInsightsVersion: raw.eliteInsightsVersion ?? '',
    arcVersion: raw.arcVersion ?? '',
    recordedBy: raw.recordedBy ?? '',
    startedAt: raw.timeStartStd ?? '',
    fullFight,
    phases,
    players,
    skills,
    buffs,
    damageMods: parseMap(raw.damageModMap),
    personalBuffs: raw.personalBuffs ?? {},
    targetNames: (raw.targets ?? []).map((target) => target.name ?? 'Unknown').filter(Boolean),
    logErrors: raw.logErrors ?? [],
  };
}

/** Resolves a buff id by its in-game name, which is stabler than hardcoding ids. */
export function findBuffId(log: NormalizedLog, name: string): number | undefined {
  const wanted = name.toLowerCase();
  for (const [id, desc] of log.buffs) {
    if (desc.name?.toLowerCase() === wanted) return id;
  }
  return undefined;
}

export function findBuffIdMatching(log: NormalizedLog, pattern: RegExp): number | undefined {
  for (const [id, desc] of log.buffs) {
    if (desc.name && pattern.test(desc.name)) return id;
  }
  return undefined;
}

/**
 * Virtuoso's blade resource. Elite Insights labels it "Virtuoso Blade" (often a
 * synthetic id like -25). Older fixtures / docs sometimes call it "Blades".
 * Do not confuse with "Deadly Blades", which is a trait proc, not the stack.
 */
export function findBladeBuffId(log: NormalizedLog): number | undefined {
  const byName =
    findBuffId(log, 'Virtuoso Blade') ??
    findBuffId(log, 'Blades') ??
    findBuffIdMatching(log, /^virtuoso blade$/i);
  if (byName !== undefined) return byName;

  for (const id of log.personalBuffs.Virtuoso ?? []) {
    const name = log.buffs.get(id)?.name;
    if (name && /^(virtuoso blade|blades)$/i.test(name)) return id;
  }

  for (const [id, desc] of log.buffs) {
    if (!desc.stacking || !desc.name) continue;
    if (/deadly blades/i.test(desc.name)) continue;
    if (/\bblade\b/i.test(desc.name) && /virtuoso/i.test(desc.name)) return id;
  }
  return undefined;
}

export function buffTimeline(player: NormalizedPlayer, buffId: number | undefined, endTime: number): StackTimeline {
  if (buffId === undefined) return StackTimeline.empty(endTime);
  return player.buffs.get(buffId) ?? StackTimeline.empty(endTime);
}

/** Picks the player the report was recorded by, falling back to the top damage dealer. */
export function pickDefaultPlayer(log: NormalizedLog): NormalizedPlayer | undefined {
  if (log.players.length === 0) return undefined;
  const recorded = log.players.find((player) => player.name === log.recordedBy);
  if (recorded) return recorded;
  return [...log.players].sort((a, b) => b.dps - a.dps)[0];
}
