import type {
  EIBuffDesc,
  EIDamageModDesc,
  EILog,
  EIPlayer,
  EISkillDesc,
} from '../api/eiTypes.ts';
import type { LogSource } from '../api/logSource.ts';
import { StackTimeline, type Interval } from './timeline.ts';

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

export interface NormalizedDamageModifier {
  id: number;
  name: string;
  hitCount: number;
  totalHitCount: number;
  damageGain: number;
  /** Share of eligible hits that benefited, 0-1. */
  hitRatio: number;
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

function normalizePlayer(player: EIPlayer, log: EILog, skills: Map<number, EISkillDesc>): NormalizedPlayer {
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
  for (const mod of player.damageModifiers ?? []) {
    const entry = mod.damageModifiers?.[0];
    if (!entry) continue;
    const hitCount = entry.hitCount ?? 0;
    const totalHitCount = entry.totalHitCount ?? 0;
    damageModifiers.push({
      id: mod.id,
      name: damageModMap.get(mod.id)?.name ?? `Modifier ${mod.id}`,
      hitCount,
      totalHitCount,
      damageGain: entry.damageGain ?? 0,
      hitRatio: totalHitCount > 0 ? hitCount / totalHitCount : 0,
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
    deaths: defenses?.deadCount ?? 0,
    downs: defenses?.downCount ?? 0,
    dodges: defenses?.dodgeCount ?? 0,
    weaponSwaps: stats?.swapCount ?? 0,
    // Elite Insights reports these in seconds.
    reportedTimeWastedMs: Math.round((stats?.timeWasted ?? 0) * 1000),
    reportedTimeSavedMs: Math.round((stats?.timeSaved ?? 0) * 1000),
  };
}

export function normalizeLog(raw: EILog, source: LogSource): NormalizedLog {
  const durationMs = raw.durationMS ?? 0;
  const skills = parseMap(raw.skillMap);

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
    .map((player) => normalizePlayer(player, raw, skills));

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
    buffs: parseMap(raw.buffMap),
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
