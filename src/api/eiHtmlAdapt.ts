/**
 * Adapts Elite Insights' HTML-report JSON (what GW2 Wingman serves via getJson)
 * into the standard EI JSON subset this app's normalize() already consumes.
 *
 * HTML cast tuples are [startSec, skillId, actualDurationMs, status, acceleration].
 * Status matches EI AnimationStatus / RotationStatus:
 *   0 UNKNOWN, 1 REDUCED, 2 CANCEL/Interrupted, 3 FULL, 4 INSTANT
 *
 * Interrupted casts reconstruct timeGained exactly (-actualDuration). Reduced
 * (aftercast cancel) casts only get a positive sentinel — the HTML schema omits
 * SavedDuration — while aggregate timeSaved still comes from gameplayStats.
 */

import type {
  EIBuffClassification,
  EIBuffDesc,
  EIBuffUptime,
  EIConsumable,
  EIDamageModDesc,
  EIDamageModifierData,
  EIDamageDist,
  EILog,
  EIPhase,
  EIPlayer,
  EIRotation,
  EISkillDesc,
  EIWeaponSet,
} from './eiTypes.ts';

const RotationStatus = {
  UNKNOWN: 0,
  REDUCED: 1,
  CANCEL: 2,
  FULL: 3,
  INSTANT: 4,
} as const;

/** Positive sentinel for REDUCED casts; exact saved ms is not in the HTML tuple. */
const REDUCED_TIME_GAINED_SENTINEL = 1;

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function secToMs(seconds: number): number {
  return Math.round(seconds * 1000);
}

/** True when the payload looks like EI's HTML-report schema rather than full JSON. */
export function isEiHtmlReport(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  if ('logName' in raw || 'persBuffs' in raw || 'evtcRecordingDuration' in raw) return true;
  const players = asArray(raw.players);
  const first = players[0];
  return isRecord(first) && isRecord(first.details) && Array.isArray(first.details.rotation);
}

function timeGainedFromStatus(status: number, actualDuration: number): number {
  if (status === RotationStatus.CANCEL) return -Math.abs(actualDuration);
  if (status === RotationStatus.REDUCED) return REDUCED_TIME_GAINED_SENTINEL;
  return 0;
}

function adaptSkillMap(raw: unknown): Record<string, EISkillDesc> {
  const out: Record<string, EISkillDesc> = {};
  if (!isRecord(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    out[key] = {
      name: optionalString(value.name),
      autoAttack: value.aa === true || value.autoAttack === true,
      isSwap: value.isSwap === true,
      isNotAccurate: value.notAccurate === true || value.isNotAccurate === true,
      isInstantCast: value.isInstantCast === true || value.instantCast === true,
      traitProc: value.traitProc === true,
      gearProc: value.gearProc === true,
      icon: optionalString(value.icon),
    };
  }
  return out;
}

function classificationFromUniqueSlot(slot: number | undefined): EIBuffClassification | undefined {
  if (slot === 1) return 'Nourishment';
  if (slot === 2) return 'Enhancement';
  if (slot === 0) return 'Other Consumable';
  return undefined;
}

function adaptBuffMap(raw: unknown): Record<string, EIBuffDesc> {
  const out: Record<string, EIBuffDesc> = {};
  if (!isRecord(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    out[key] = {
      name: optionalString(value.name),
      icon: optionalString(value.icon),
      stacking: value.stacking === true,
      consumable: value.consumable === true,
      classification: optionalString(value.classification),
    };
  }
  return out;
}

/** HTML food entries use seconds; convert to the EI JSON consumable shape. */
function adaptConsumables(food: unknown): EIConsumable[] {
  const out: EIConsumable[] = [];
  for (const entry of asArray(food)) {
    if (!isRecord(entry)) continue;
    const id = asNumber(entry.id, NaN);
    if (!Number.isFinite(id)) continue;
    const uniqueSlot = typeof entry.uniqueSlot === 'number' ? entry.uniqueSlot : undefined;
    out.push({
      id,
      time: secToMs(asNumber(entry.time)),
      duration: secToMs(asNumber(entry.duration)),
      stack: asNumber(entry.stack, 1),
      uniqueSlot,
    });
  }
  return out;
}

/** Stamp Nourishment/Enhancement onto buffMap from HTML uniqueSlot values. */
function applyConsumableClassifications(
  buffMap: Record<string, EIBuffDesc>,
  players: EIPlayer[],
): void {
  for (const player of players) {
    for (const consumable of player.consumables ?? []) {
      const key = `b${consumable.id}`;
      const desc = buffMap[key];
      if (!desc) continue;
      const classification = classificationFromUniqueSlot(consumable.uniqueSlot);
      if (!classification) continue;
      desc.classification = classification;
      desc.consumable = true;
    }
  }
}

function adaptDamageModMap(raw: unknown): Record<string, EIDamageModDesc> {
  const out: Record<string, EIDamageModDesc> = {};
  if (!isRecord(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    out[key] = {
      name: optionalString(value.name),
      icon: optionalString(value.icon),
      description: optionalString(value.tooltip),
      nonMultiplier: value.nonMultiplier === true,
      skillBased: value.skillBased === true,
      approximate: value.approximate === true,
    };
  }
  return out;
}

function adaptPersonalBuffs(raw: unknown): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  if (!isRecord(raw)) return out;
  for (const [profession, value] of Object.entries(raw)) {
    const ids = asArray(value)
      .map((entry) => asNumber(entry, NaN))
      .filter((id) => Number.isFinite(id));
    if (ids.length) out[profession] = ids;
  }
  return out;
}

function adaptRotation(phaseCasts: unknown): EIRotation[] {
  const bySkill = new Map<number, NonNullable<EIRotation['skills']>>();
  for (const entry of asArray(phaseCasts)) {
    if (!Array.isArray(entry) || entry.length < 4) continue;
    const startSec = asNumber(entry[0]);
    const skillId = asNumber(entry[1]);
    const actualDuration = asNumber(entry[2]);
    const status = asNumber(entry[3]);
    const acceleration = asNumber(entry[4], 0);
    const instant = status === RotationStatus.INSTANT;
    const skills = bySkill.get(skillId) ?? [];
    skills.push({
      castTime: secToMs(startSec),
      duration: instant ? 0 : actualDuration,
      timeGained: timeGainedFromStatus(status, actualDuration),
      quickness: acceleration,
    });
    bySkill.set(skillId, skills);
  }
  return [...bySkill.entries()].map(([id, skills]) => ({ id, skills }));
}

function adaptBuffUptimes(boonGraph: unknown): EIBuffUptime[] {
  const out: EIBuffUptime[] = [];
  for (const entry of asArray(boonGraph)) {
    if (!isRecord(entry)) continue;
    const id = asNumber(entry.id, NaN);
    if (!Number.isFinite(id)) continue;
    const states = asArray(entry.states)
      .map((pair) => {
        if (!Array.isArray(pair) || pair.length < 2) return null;
        return [secToMs(asNumber(pair[0])), asNumber(pair[1])];
      })
      .filter((pair): pair is number[] => pair !== null);
    out.push({ id, states });
  }
  return out;
}

function adaptWeaponSets(raw: unknown, fightEndMs: number): EIWeaponSet[] {
  if (!isRecord(raw)) return [];
  const start = asNumber(raw.start, 0);
  const end = asNumber(raw.end, fightEndMs);
  // HTML uses ms for weapon-set bounds (values like -11 / 214437).
  const startMs = Math.abs(start) < 10_000 && Math.abs(end) < 10_000 ? secToMs(start) : start;
  const endMs = Math.abs(start) < 10_000 && Math.abs(end) < 10_000 ? secToMs(end) : end;

  const sets: EIWeaponSet[] = [];
  for (const key of ['l1Set', 'l2Set', 'a1Set', 'a2Set'] as const) {
    const weapons = asArray(raw[key])
      .map((weapon) => asString(weapon))
      .filter((weapon) => weapon && weapon !== 'Unknown' && weapon !== '2Hand');
    if (weapons.length) sets.push({ weapons, start: startMs, end: endMs });
  }
  return sets;
}

function modIdsForPlayer(html: Json, profession: string): {
  common: number[];
  item: number[];
  pers: number[];
} {
  const common = asArray(html.dmgModifiersCommon).map((id) => asNumber(id));
  const item = asArray(html.dmgModifiersItem).map((id) => asNumber(id));
  const persRaw = isRecord(html.dmgModifiersPers) ? html.dmgModifiersPers[profession] : undefined;
  const pers = asArray(persRaw).map((id) => asNumber(id));
  return { common, item, pers };
}

function adaptDamageModifiers(
  phase: Json,
  playerIndex: number,
  modIds: { common: number[]; item: number[]; pers: number[] },
): EIDamageModifierData[] {
  const buckets: Array<{ ids: number[]; key: string }> = [
    { ids: modIds.common, key: 'dmgModifiersCommon' },
    { ids: modIds.item, key: 'dmgModifiersItem' },
    { ids: modIds.pers, key: 'dmgModifiersPers' },
  ];

  const out: EIDamageModifierData[] = [];
  for (const bucket of buckets) {
    const playerMods = asArray(phase[bucket.key])[playerIndex];
    if (!isRecord(playerMods)) continue;
    const data = asArray(playerMods.data);
    for (let i = 0; i < bucket.ids.length; i++) {
      const row = data[i];
      if (!Array.isArray(row)) continue;
      out.push({
        id: bucket.ids[i],
        damageModifiers: [
          {
            hitCount: asNumber(row[0]),
            totalHitCount: asNumber(row[1]),
            damageGain: asNumber(row[2]),
            totalDamage: asNumber(row[3]),
          },
        ],
      });
    }
  }
  return out;
}

function adaptDamageDist(details: Json): EIDamageDist[] {
  const distributions = asArray(details.dmgDistributions);
  const phase0 = distributions[0];
  if (!isRecord(phase0)) return [];
  const out: EIDamageDist[] = [];
  for (const row of asArray(phase0.distribution)) {
    if (!Array.isArray(row) || row.length < 15) continue;
    out.push({
      id: asNumber(row[1]),
      totalDamage: asNumber(row[2]),
      min: asNumber(row[3]),
      max: asNumber(row[4]),
      connectedHits: asNumber(row[6]),
      crit: asNumber(row[7]),
      flank: asNumber(row[8]),
      glance: asNumber(row[9]),
      hits: asNumber(row[14]),
      indirectDamage: row[0] === true,
    });
  }
  return out;
}

function parseDurationMs(html: Json, phases: unknown[]): number {
  const phase0 = phases[0];
  if (isRecord(phase0) && typeof phase0.duration === 'number') return phase0.duration;

  const recording = asString(html.evtcRecordingDuration);
  // e.g. "03m 34s 448ms"
  const match = recording.match(/(?:(\d+)m)?\s*(?:(\d+)s)?\s*(?:(\d+)ms)?/i);
  if (match && (match[1] || match[2] || match[3])) {
    return (
      asNumber(match[1] ? Number(match[1]) : 0) * 60_000 +
      asNumber(match[2] ? Number(match[2]) : 0) * 1000 +
      asNumber(match[3] ? Number(match[3]) : 0)
    );
  }
  return 0;
}

function adaptPhases(rawPhases: unknown[], durationMs: number): EIPhase[] {
  return rawPhases.map((phase, index) => {
    if (!isRecord(phase)) {
      return { start: 0, end: durationMs, name: index === 0 ? 'Full Fight' : `Phase ${index}` };
    }
    return {
      start: secToMs(asNumber(phase.start)),
      end: secToMs(asNumber(phase.end, durationMs / 1000)),
      name: asString(phase.name, index === 0 ? 'Full Fight' : `Phase ${index}`),
      targets: asArray(phase.targets)
        .map((id) => asNumber(id, NaN))
        .filter((id) => Number.isFinite(id)),
      subPhases: asArray(phase.subPhases)
        .map((id) => asNumber(id, NaN))
        .filter((id) => Number.isFinite(id)),
      breakbarPhase: phase.breakbarPhase === true,
    };
  });
}

function isChallengeMode(phase0: Json | undefined): boolean {
  if (!phase0) return false;
  const mode = asString(phase0.mode).toLowerCase();
  return mode.includes('challenge');
}

function isLateStart(phase0: Json | undefined): boolean {
  if (!phase0) return false;
  return asString(phase0.startStatus).toLowerCase().includes('late');
}

function adaptPlayer(
  rawPlayer: Json,
  playerIndex: number,
  html: Json,
  phase0: Json | undefined,
  durationMs: number,
): EIPlayer {
  const details = isRecord(rawPlayer.details) ? rawPlayer.details : {};
  const profession = asString(rawPlayer.profession, 'Unknown');

  const dpsRow = phase0 ? asArray(phase0.dpsStats)[playerIndex] : undefined;
  const gameplayRow = phase0 ? asArray(phase0.gameplayStats)[playerIndex] : undefined;
  const defRow = phase0 ? asArray(phase0.defStats)[playerIndex] : undefined;
  const activeTime = phase0 ? asArray(phase0.playerActiveTimes)[playerIndex] : undefined;

  const damage = Array.isArray(dpsRow) ? asNumber(dpsRow[0]) : 0;
  const activeTimeMs = asNumber(activeTime, durationMs);
  const dps = activeTimeMs > 0 ? Math.round((damage * 1000) / activeTimeMs) : 0;

  const firstAwareRaw = asNumber(rawPlayer.firstAware, 0);
  const lastAwareRaw = asNumber(rawPlayer.lastAware, durationMs / 1000);
  // HTML uses seconds for aware times (values like -0.011 / 214.043).
  const firstAware = Math.abs(firstAwareRaw) < 1_000_000 ? secToMs(firstAwareRaw) : firstAwareRaw;
  const lastAware = Math.abs(lastAwareRaw) < 1_000_000 ? secToMs(lastAwareRaw) : lastAwareRaw;

  const rotationPhase = asArray(details.rotation)[0];
  const boonGraphPhase = asArray(details.boonGraph)[0];

  return {
    name: asString(rawPlayer.name, 'Unknown'),
    account: asString(rawPlayer.acc, asString(rawPlayer.account)),
    group: asNumber(rawPlayer.group),
    profession,
    notInSquad: rawPlayer.notInSquad === true,
    firstAware,
    lastAware,
    weaponSets: adaptWeaponSets(rawPlayer.weaponSets, durationMs),
    activeTimes: [activeTimeMs],
    dpsAll: [
      {
        dps,
        damage,
        powerDamage: Array.isArray(dpsRow) ? asNumber(dpsRow[1]) : 0,
        condiDamage: Array.isArray(dpsRow) ? asNumber(dpsRow[2]) : 0,
      },
    ],
    statsAll: [
      {
        timeWasted: Array.isArray(gameplayRow) ? asNumber(gameplayRow[0]) : 0,
        wasted: Array.isArray(gameplayRow) ? asNumber(gameplayRow[1]) : 0,
        timeSaved: Array.isArray(gameplayRow) ? asNumber(gameplayRow[2]) : 0,
        saved: Array.isArray(gameplayRow) ? asNumber(gameplayRow[3]) : 0,
        swapCount: Array.isArray(gameplayRow) ? asNumber(gameplayRow[4]) : 0,
        skillCastUptime: Array.isArray(gameplayRow) ? asNumber(gameplayRow[7]) : 0,
        skillCastUptimeNoAA: Array.isArray(gameplayRow) ? asNumber(gameplayRow[8]) : 0,
      },
    ],
    defenses: [
      {
        damageTaken: Array.isArray(defRow) ? asNumber(defRow[0]) : 0,
        dodgeCount: Array.isArray(defRow) ? asNumber(defRow[7]) : 0,
        downCount: Array.isArray(defRow) ? asNumber(defRow[12]) : 0,
        deadCount: Array.isArray(defRow) ? asNumber(defRow[14]) : 0,
      },
    ],
    rotation: adaptRotation(rotationPhase),
    buffUptimes: adaptBuffUptimes(boonGraphPhase),
    damageModifiers: phase0
      ? adaptDamageModifiers(phase0, playerIndex, modIdsForPlayer(html, profession))
      : [],
    consumables: adaptConsumables(details.food),
    totalDamageDist: [adaptDamageDist(details)],
  };
}

/**
 * Convert an EI HTML-report JSON document into the standard EILog shape used
 * by normalizeLog().
 */
export function adaptEiHtmlReport(raw: unknown): EILog {
  if (!isRecord(raw)) {
    throw new Error('HTML report payload was not a JSON object.');
  }

  const rawPhases = asArray(raw.phases);
  const durationMs = parseDurationMs(raw, rawPhases);
  const phase0 = isRecord(rawPhases[0]) ? rawPhases[0] : undefined;
  const players = asArray(raw.players)
    .filter(isRecord)
    .map((player, index) => adaptPlayer(player, index, raw, phase0, durationMs));

  const targets = asArray(raw.targets)
    .filter(isRecord)
    .map((target) => ({
      name: asString(target.name, 'Unknown'),
      totalHealth: typeof target.health === 'number' ? target.health : undefined,
      firstAware:
        Math.abs(asNumber(target.firstAware)) < 1_000_000
          ? secToMs(asNumber(target.firstAware))
          : asNumber(target.firstAware),
      lastAware:
        Math.abs(asNumber(target.lastAware)) < 1_000_000
          ? secToMs(asNumber(target.lastAware))
          : asNumber(target.lastAware),
    }));

  const buffMap = adaptBuffMap(raw.buffMap);
  applyConsumableClassifications(buffMap, players);

  return {
    eliteInsightsVersion: asString(raw.parser),
    triggerID: typeof raw.triggerID === 'number' ? raw.triggerID : undefined,
    fightName: asString(raw.logName, 'Unknown encounter'),
    name: asString(raw.logName, 'Unknown encounter'),
    arcVersion: asString(raw.arcVersion),
    gW2Build: asNumber(raw.gw2Build, asNumber(raw.gW2Build)),
    recordedBy: asString(raw.recordedBy),
    recordedAccountBy: asString(raw.recordedAccountBy),
    timeStartStd: asString(raw.logStart),
    timeEndStd: asString(raw.logEnd),
    duration: asString(raw.evtcRecordingDuration),
    durationMS: durationMs,
    success: phase0?.success === true,
    isCM: isChallengeMode(phase0),
    isLateStart: isLateStart(phase0),
    targetless: raw.targetless === true,
    players,
    targets,
    phases: adaptPhases(rawPhases, durationMs),
    uploadLinks: asArray(raw.uploadLinks)
      .map((link) => asString(link))
      .filter(Boolean),
    logErrors: asArray(raw.logErrors)
      .map((error) => asString(error))
      .filter(Boolean),
    skillMap: adaptSkillMap(raw.skillMap),
    buffMap,
    damageModMap: adaptDamageModMap(raw.damageModMap),
    personalBuffs: adaptPersonalBuffs(raw.persBuffs ?? raw.personalBuffs),
    personalDamageMods: adaptPersonalBuffs(raw.dmgModifiersPers ?? raw.personalDamageMods),
  };
}

/** Exported for unit tests. */
export const __test__ = {
  timeGainedFromStatus,
  RotationStatus,
  REDUCED_TIME_GAINED_SENTINEL,
  secToMs,
  adaptRotation,
  adaptBuffUptimes,
};
