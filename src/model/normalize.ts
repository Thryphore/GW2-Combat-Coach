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
  /** Positive: aftercast cancel after activation. Negative: aborted before activation. */
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
  /**
   * Target / boss DPS: sum of full-fight phase `dpsTargets` (matches EI Target DPS).
   * Falls back to All when per-target stats are missing.
   */
  dps: number;
  /** Target / boss damage matching `dps`. */
  damage: number;
  /** All-targets DPS from Elite Insights `dpsAll` (boss + adds). */
  cleaveDps: number;
  /** All-targets damage matching `cleaveDps`. */
  cleaveDamage: number;
  /** Highest 1-second damage across full-fight phase targets (falls back to cleave peak). */
  peakDps: number;
  /** Highest 1-second cleave / all-targets damage. */
  peakCleaveDps: number;
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
  /** Encounter icon from the report, when Elite Insights includes one. */
  fightIcon?: string;
  /** Elite Insights / Wingman boss species id when the report includes one. */
  triggerId?: number;
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

/** Show cleave beside single-target DPS when cleave is at least this much higher. */
export const CLEAVE_DPS_DISPLAY_RATIO = 1.15;

/** True when cleave is meaningfully above single-target DPS. */
export function shouldShowCleaveDps(player: Pick<NormalizedPlayer, 'dps' | 'cleaveDps'>): boolean {
  return player.dps > 0 && player.cleaveDps > player.dps * CLEAVE_DPS_DISPLAY_RATIO;
}

/**
 * Fallback when the full-fight phase has no `targets` list: pick the single
 * NPC that took the most damage from this player (not always index 0).
 */
export function primaryTargetIndex(
  dpsTargets?: { dps?: number; damage?: number }[][],
): number {
  if (!dpsTargets?.length) return 0;
  let bestIndex = 0;
  let bestScore = -1;
  for (let index = 0; index < dpsTargets.length; index += 1) {
    const entry = dpsTargets[index]?.[0];
    const score = entry?.damage ?? entry?.dps ?? 0;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestIndex;
}

/** Full-fight phase target indices from Elite Insights (e.g. all void dragons on HT). */
export function fightTargetIndices(log: { phases?: { targets?: number[] }[] }): number[] {
  const targets = log.phases?.[0]?.targets;
  if (!targets?.length) return [];
  return targets.filter((index) => Number.isInteger(index) && index >= 0);
}

function resolveTargetIndices(
  dpsTargets: { dps?: number; damage?: number }[][] | undefined,
  targetIndices?: number[],
): number[] {
  if (targetIndices?.length) {
    return targetIndices.filter(
      (index) => Number.isInteger(index) && index >= 0 && index < (dpsTargets?.length ?? 0),
    );
  }
  if (!dpsTargets?.length) return [];
  return [primaryTargetIndex(dpsTargets)];
}

function sumTargetStats(
  dpsTargets: { dps?: number; damage?: number }[][] | undefined,
  indices: number[],
): { dps: number; damage: number } {
  let dps = 0;
  let damage = 0;
  for (const index of indices) {
    const entry = dpsTargets?.[index]?.[0];
    if (!entry) continue;
    dps += entry.dps ?? 0;
    damage += entry.damage ?? 0;
  }
  return { dps, damage };
}

/**
 * Target / boss DPS sums `dpsTargets` for the full-fight phase target list
 * (EI "Target" column). All DPS from `dpsAll`. Target cannot exceed All —
 * if it does, the fields were swapped.
 */
export function resolvePlayerDps(
  player: {
    dpsAll?: { dps?: number; damage?: number }[];
    dpsTargets?: { dps?: number; damage?: number }[][];
  },
  options?: { targetIndices?: number[] },
): { dps: number; damage: number; cleaveDps: number; cleaveDamage: number } {
  let cleaveDps = player.dpsAll?.[0]?.dps ?? 0;
  let cleaveDamage = player.dpsAll?.[0]?.damage ?? 0;
  const indices = resolveTargetIndices(player.dpsTargets, options?.targetIndices);
  const summed = sumTargetStats(player.dpsTargets, indices);
  let dps = indices.length ? summed.dps : cleaveDps;
  let damage = indices.length ? summed.damage : cleaveDamage;
  if (!indices.length || (dps <= 0 && damage <= 0)) {
    dps = cleaveDps;
    damage = cleaveDamage;
  }

  // Target ≤ All always. A higher "target" means source fields were inverted.
  if (cleaveDps > 0 && dps > cleaveDps) {
    [dps, cleaveDps] = [cleaveDps, dps];
    [damage, cleaveDamage] = [cleaveDamage, damage];
  }

  return { dps, damage, cleaveDps, cleaveDamage };
}

/**
 * Elite Insights `damage1S` / `targetDamage1S` are cumulative damage at each
 * second. Peak 1s damage is the largest step between consecutive points.
 */
function peakFromCumulativeSeries(series: number[] | undefined): number {
  if (!series?.length) return 0;
  let peak = 0;
  let previous = 0;
  for (const point of series) {
    if (!Number.isFinite(point)) continue;
    const delta = point - previous;
    if (delta > peak) peak = delta;
    previous = point;
  }
  return peak;
}

/** Peak 1s damage of the summed cumulative series across several targets. */
function peakFromSummedTargetSeries(
  targetDamage1S: number[][][] | undefined,
  indices: number[],
): number {
  const seriesList = indices
    .map((index) => targetDamage1S?.[index]?.[0])
    .filter((series): series is number[] => !!series?.length);
  if (!seriesList.length) return 0;
  if (seriesList.length === 1) return peakFromCumulativeSeries(seriesList[0]);

  const length = Math.max(...seriesList.map((series) => series.length));
  let peak = 0;
  let previous = 0;
  for (let t = 0; t < length; t += 1) {
    let sum = 0;
    for (const series of seriesList) {
      const point = t < series.length ? series[t]! : series[series.length - 1]!;
      if (Number.isFinite(point)) sum += point;
    }
    const delta = sum - previous;
    if (delta > peak) peak = delta;
    previous = sum;
  }
  return peak;
}

/**
 * Highest 1-second damage windows across full-fight phase targets, plus cleave
 * from `damage1S`. Falls back to cleave when per-target data is missing.
 */
export function resolvePeakDps(
  player: {
    damage1S?: number[][];
    targetDamage1S?: number[][][];
    dpsTargets?: { dps?: number; damage?: number }[][];
  },
  options?: { targetIndices?: number[] },
): { peakDps: number; peakCleaveDps: number } {
  const peakCleaveDps = peakFromCumulativeSeries(player.damage1S?.[0]);
  const indices = resolveTargetIndices(player.dpsTargets, options?.targetIndices);
  const targetPeak = peakFromSummedTargetSeries(player.targetDamage1S, indices);
  return {
    peakDps: targetPeak > 0 ? targetPeak : peakCleaveDps,
    peakCleaveDps,
  };
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
  const targetIndices = fightTargetIndices(log);
  const { dps, damage, cleaveDps, cleaveDamage } = resolvePlayerDps(player, { targetIndices });
  const { peakDps, peakCleaveDps } = resolvePeakDps(player, { targetIndices });

  return {
    name: player.name ?? 'Unknown',
    account: player.account ?? '',
    group: player.group ?? 0,
    profession: player.profession ?? 'Unknown',
    firstAware: player.firstAware ?? 0,
    lastAware: player.lastAware ?? fightEnd,
    activeTimeMs: player.activeTimes?.[0] ?? fightEnd,
    dps,
    damage,
    cleaveDps,
    cleaveDamage,
    peakDps,
    peakCleaveDps,
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
    fightIcon: resolveEiIcon(raw.icon ?? raw.fightIcon),
    triggerId: typeof raw.triggerID === 'number' && raw.triggerID > 0 ? raw.triggerID : undefined,
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
