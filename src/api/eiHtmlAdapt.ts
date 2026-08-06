/**
 * Adapts Elite Insights' HTML-report JSON (what GW2 Wingman serves via getJson)
 * into the standard EI JSON subset this app's normalize() already consumes.
 *
 * HTML cast tuples are [startSec, skillId, actualDurationMs, status, acceleration].
 * Status matches EI AnimationStatus / RotationStatus:
 *   0 UNKNOWN, 1 REDUCED, 2 CANCEL/Interrupted, 3 FULL, 4 INSTANT
 *
 * Interrupted casts reconstruct timeGained exactly (-actualDuration). Reduced
 * (aftercast cancel) casts omit SavedDuration in the HTML schema, so we estimate
 * from full casts of the same skill when possible, then scale the positives to
 * match gameplayStats.timeSaved (EI's authoritative aggregate).
 */

import type {
  EIBuffClassification,
  EIBuffDesc,
  EIBuffUptime,
  EIConsumable,
  EIDamageModDesc,
  EIDamageModifierData,
  EIDamageDist,
  EIDps,
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

/** HTML DPSStatDataItem: [damage, powerDamage, conditionDamage, breakbarDamage]. */
function dpsFromHtmlRow(row: unknown[], activeTimeMs: number): EIDps {
  const damage = asNumber(row[0]);
  const powerDamage = asNumber(row[1]);
  const condiDamage = asNumber(row[2]);
  const dps = activeTimeMs > 0 ? Math.round((damage * 1000) / activeTimeMs) : 0;
  return {
    dps,
    damage,
    powerDamage,
    condiDamage,
    powerDps: activeTimeMs > 0 ? Math.round((powerDamage * 1000) / activeTimeMs) : 0,
    condiDps: activeTimeMs > 0 ? Math.round((condiDamage * 1000) / activeTimeMs) : 0,
  };
}

/**
 * Build EI-shaped `dpsTargets[target][phase]` from HTML `dpsStatsTargets`.
 * EI templates use `[player][target]`; if the outer length does not match the
 * player count but each inner list does, treat it as `[target][player]`.
 */
function adaptHtmlDpsTargets(
  raw: unknown,
  playerIndex: number,
  playerCount: number,
  activeTimeMs: number,
  allDamage: number,
): EIDps[][] | undefined {
  const root = asArray(raw);
  if (root.length === 0 || playerCount <= 0) return undefined;

  const fromPlayerMajor = (): EIDps[][] | undefined => {
    const perTarget = asArray(root[playerIndex]).filter(Array.isArray) as unknown[][];
    if (perTarget.length === 0) return undefined;
    return perTarget.map((row) => [dpsFromHtmlRow(row, activeTimeMs)]);
  };

  const fromTargetMajor = (): EIDps[][] | undefined => {
    const out: EIDps[][] = [];
    for (const targetPlayers of root) {
      if (!Array.isArray(targetPlayers)) continue;
      const row = targetPlayers[playerIndex];
      if (!Array.isArray(row)) continue;
      out.push([dpsFromHtmlRow(row, activeTimeMs)]);
    }
    return out.length > 0 ? out : undefined;
  };

  const firstInnerLen = Array.isArray(root[0]) ? root[0].length : 0;
  // Outer length == players → standard EI HTML layout.
  if (root.length === playerCount) return fromPlayerMajor();
  // Inner length == players → transposed [target][player].
  if (firstInnerLen === playerCount) return fromTargetMajor();

  // Ambiguous shape: keep whichever keeps Target damage ≤ All damage.
  const preferred = fromPlayerMajor();
  const preferredBoss = preferred?.[0]?.[0]?.damage ?? 0;
  if (preferred && (allDamage <= 0 || preferredBoss <= allDamage * 1.001)) return preferred;
  const transposed = fromTargetMajor();
  const transposedBoss = transposed?.[0]?.[0]?.damage ?? 0;
  if (transposed && (allDamage <= 0 || transposedBoss <= allDamage * 1.001)) return transposed;
  return preferred ?? transposed;
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

interface InterimCast {
  skillId: number;
  castTime: number;
  duration: number;
  status: number;
  acceleration: number;
}

function parseInterimCasts(phaseCasts: unknown): InterimCast[] {
  const out: InterimCast[] = [];
  for (const entry of asArray(phaseCasts)) {
    if (!Array.isArray(entry) || entry.length < 4) continue;
    out.push({
      skillId: asNumber(entry[1]),
      castTime: secToMs(asNumber(entry[0])),
      duration: asNumber(entry[2]),
      status: asNumber(entry[3]),
      acceleration: asNumber(entry[4], 0),
    });
  }
  return out;
}

/** Bucket acceleration so quickness FULL casts do not inflate non-quickness saves. */
function accelerationBucket(acceleration: number): 'quick' | 'slow' | 'normal' {
  if (acceleration >= 0.5) return 'quick';
  if (acceleration <= -0.5) return 'slow';
  return 'normal';
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** Expected animation length for a REDUCED cast, from FULL casts of the same skill. */
function expectedDurationFromFullCasts(
  fullCasts: InterimCast[],
  skillId: number,
  acceleration: number,
): number | undefined {
  const sameSkill = fullCasts.filter((cast) => cast.skillId === skillId && cast.duration > 0);
  if (sameSkill.length === 0) return undefined;
  const bucket = accelerationBucket(acceleration);
  const matched = sameSkill.filter((cast) => accelerationBucket(cast.acceleration) === bucket);
  const pool = matched.length > 0 ? matched : sameSkill;
  return median(pool.map((cast) => cast.duration));
}

/**
 * HTML reports omit per-cast SavedDuration. Weight REDUCED casts by estimated
 * save, then force the total to match EI's aggregate timeSaved.
 */
function reconcileReducedTimeGained(
  casts: Array<{ timeGained: number }>,
  timeSavedSec: number,
): void {
  const reduced = casts.filter((cast) => cast.timeGained > 0);
  if (reduced.length === 0) return;

  const targetMs = Math.max(0, Math.round(timeSavedSec * 1000));
  if (targetMs <= 0) {
    for (const cast of reduced) cast.timeGained = 0;
    return;
  }

  const weightSum = reduced.reduce((total, cast) => total + Math.max(cast.timeGained, 0), 0);
  const weights =
    weightSum > 0 ? reduced.map((cast) => Math.max(cast.timeGained, 0)) : reduced.map(() => 1);
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  const floors = weights.map((weight) => Math.floor((weight / totalWeight) * targetMs));
  let remainder = targetMs - floors.reduce((total, value) => total + value, 0);
  for (let index = 0; index < reduced.length; index += 1) {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    reduced[index].timeGained = floors[index] + extra;
  }
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

function adaptRotation(phaseCasts: unknown, timeSavedSec = 0): EIRotation[] {
  const interim = parseInterimCasts(phaseCasts);
  const fullCasts = interim.filter((cast) => cast.status === RotationStatus.FULL);
  const bySkill = new Map<number, NonNullable<EIRotation['skills']>>();
  const adaptedCasts: NonNullable<EIRotation['skills']> = [];

  for (const cast of interim) {
    const instant = cast.status === RotationStatus.INSTANT;
    let timeGained = timeGainedFromStatus(cast.status, cast.duration);
    if (cast.status === RotationStatus.REDUCED) {
      const expected = expectedDurationFromFullCasts(fullCasts, cast.skillId, cast.acceleration);
      if (expected !== undefined && expected > cast.duration) {
        timeGained = expected - cast.duration;
      }
    }
    const skills = bySkill.get(cast.skillId) ?? [];
    const adapted = {
      castTime: cast.castTime,
      duration: instant ? 0 : cast.duration,
      timeGained,
      quickness: cast.acceleration,
    };
    skills.push(adapted);
    adaptedCasts.push(adapted);
    bySkill.set(cast.skillId, skills);
  }

  reconcileReducedTimeGained(adaptedCasts, timeSavedSec);
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

  const dpsStats = phase0 ? (phase0.dpsStats ?? phase0.DpsStats) : undefined;
  const dpsStatsTargets = phase0 ? (phase0.dpsStatsTargets ?? phase0.DpsStatsTargets) : undefined;
  const gameplayRow = phase0 ? asArray(phase0.gameplayStats ?? phase0.GameplayStats)[playerIndex] : undefined;
  const defRow = phase0 ? asArray(phase0.defStats ?? phase0.DefStats)[playerIndex] : undefined;
  const activeTime = phase0
    ? asArray(phase0.playerActiveTimes ?? phase0.PlayerActiveTimes)[playerIndex]
    : undefined;

  const activeTimeMs = asNumber(activeTime, durationMs);
  const dpsRow = asArray(dpsStats)[playerIndex];
  // dpsStats = All (boss + adds); dpsStatsTargets = per-target (boss).
  const dpsAll = Array.isArray(dpsRow) ? dpsFromHtmlRow(dpsRow, activeTimeMs) : undefined;
  const dpsTargets = adaptHtmlDpsTargets(
    dpsStatsTargets,
    playerIndex,
    asArray(dpsStats).length,
    activeTimeMs,
    dpsAll?.damage ?? 0,
  );

  const firstAwareRaw = asNumber(rawPlayer.firstAware, 0);
  const lastAwareRaw = asNumber(rawPlayer.lastAware, durationMs / 1000);
  // HTML uses seconds for aware times (values like -0.011 / 214.043).
  const firstAware = Math.abs(firstAwareRaw) < 1_000_000 ? secToMs(firstAwareRaw) : firstAwareRaw;
  const lastAware = Math.abs(lastAwareRaw) < 1_000_000 ? secToMs(lastAwareRaw) : lastAwareRaw;

  const rotationPhase = asArray(details.rotation)[0];
  const boonGraphPhase = asArray(details.boonGraph)[0];
  const timeSavedSec = Array.isArray(gameplayRow) ? asNumber(gameplayRow[2]) : 0;

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
    dpsAll: dpsAll ? [dpsAll] : [],
    dpsTargets: dpsTargets && dpsTargets.length > 0 ? dpsTargets : undefined,
    statsAll: [
      {
        timeWasted: Array.isArray(gameplayRow) ? asNumber(gameplayRow[0]) : 0,
        wasted: Array.isArray(gameplayRow) ? asNumber(gameplayRow[1]) : 0,
        timeSaved: timeSavedSec,
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
    rotation: adaptRotation(rotationPhase, timeSavedSec),
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
    icon: optionalString(raw.icon) || optionalString(raw.fightIcon) || undefined,
    fightIcon: optionalString(raw.fightIcon) || optionalString(raw.icon) || undefined,
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
  reconcileReducedTimeGained,
  expectedDurationFromFullCasts,
  adaptHtmlDpsTargets,
};
