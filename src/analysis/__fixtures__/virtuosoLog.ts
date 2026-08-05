import type { EILog } from '../../api/eiTypes.ts';
import type { LogSource } from '../../api/logSource.ts';

/**
 * A hand-built log in the Elite Insights JSON schema, shaped like a Virtuoso
 * kill and seeded with one instance of every mistake the checks look for.
 *
 * Skill and trait ids are the real ones from the GW2 API so the analysis
 * resolves chains, recharges and combo data exactly as it would on a real log.
 * Buff ids for game effects that the API does not publish (Blades) are
 * illustrative; the checks resolve those by name from the log's own buffMap.
 *
 * To analyze a real log instead, run `node scripts/trim-log.mjs <permalink>`.
 */

const MIND_SLASH = 10170;
const MIND_GASH = 10171;
const MIND_SPIKE = 10172;
const PHANTASMAL_LANCER = 72946;
const SIGNET_OF_THE_ETHER = 21750;
const RAIN_OF_SWORDS = 45425;
const THOUSAND_CUTS = 24755;
const NULL_FIELD = 10203;
const BLADESONG_HARMONY = 62586;
const BLADESONG_DISTORTION = 68273;
const BLADERTURN_REQUIEM = 62597;
const BLADECALL = 69311;

const ALACRITY = 30328;
const QUICKNESS = 1187;
const FURY = 725;
const MIGHT = 740;
const BLADES = 66568;

const DURATION_MS = 60_000;

interface CastSpec {
  id: number;
  time: number;
  duration: number;
  timeGained?: number;
}

const CASTS: CastSpec[] = [
  // A clean chain.
  { id: MIND_SLASH, time: 0, duration: 500 },
  { id: MIND_GASH, time: 600, duration: 500 },
  { id: MIND_SPIKE, time: 1200, duration: 600 },

  // Two chains abandoned at step two and step one.
  { id: MIND_SLASH, time: 2000, duration: 500 },
  { id: MIND_GASH, time: 2600, duration: 500 },
  { id: MIND_SLASH, time: 3200, duration: 500 },
  { id: MIND_GASH, time: 3800, duration: 500 },
  { id: MIND_SLASH, time: 4400, duration: 500 },

  { id: PHANTASMAL_LANCER, time: 5000, duration: 600 },
  { id: SIGNET_OF_THE_ETHER, time: 6000, duration: 0 },

  // Far enough after the last auto that the chain lapsed on its own.
  { id: MIND_SLASH, time: 9500, duration: 500 },
  { id: MIND_GASH, time: 10_100, duration: 500 },
  { id: MIND_SPIKE, time: 10_700, duration: 600 },

  // Aborted mid-cast: the time was paid and nothing came out.
  { id: RAIN_OF_SWORDS, time: 12_000, duration: 1000, timeGained: -800 },
  // Cancelled after firing, which saves time.
  { id: THOUSAND_CUTS, time: 14_000, duration: 1500, timeGained: 900 },

  // An Ethereal field with no finisher inside its two second lifetime.
  { id: NULL_FIELD, time: 18_000, duration: 600 },

  // Blade generators while capped (stacks stay at 5 until the 20s spend).
  { id: BLADECALL, time: 10_000, duration: 500 },
  { id: BLADERTURN_REQUIEM, time: 11_000, duration: 0 },
  { id: BLADECALL, time: 15_000, duration: 500 },

  { id: BLADESONG_HARMONY, time: 20_000, duration: 0 },
  { id: BLADESONG_HARMONY, time: 25_000, duration: 0 },
  // F4 below five — intentional for defense; must not count as premature.
  { id: BLADESONG_DISTORTION, time: 27_000, duration: 0 },
  { id: BLADESONG_HARMONY, time: 30_000, duration: 0 },

  // Another generator while capped after 40s; F5 has recharged by then.
  { id: BLADECALL, time: 41_000, duration: 500 },
  { id: MIND_SLASH, time: 42_000, duration: 500 },

  // Long silence between 42.5s and 55s.
  { id: MIND_SLASH, time: 55_000, duration: 500 },
  { id: MIND_GASH, time: 55_600, duration: 500 },
  { id: MIND_SPIKE, time: 56_200, duration: 600 },
];

function rotation() {
  const grouped = new Map<number, { castTime: number; duration: number; timeGained: number; quickness: number }[]>();
  for (const cast of CASTS) {
    const list = grouped.get(cast.id) ?? [];
    list.push({
      castTime: cast.time,
      duration: cast.duration,
      timeGained: cast.timeGained ?? 0,
      quickness: 1,
    });
    grouped.set(cast.id, list);
  }
  return [...grouped.entries()].map(([id, skills]) => ({ id, skills }));
}

export function virtuosoLogFixture(): EILog {
  return {
    eliteInsightsVersion: '3.26.0.0',
    arcVersion: 'EVTC20260701',
    gW2Build: 190_000,
    triggerID: 15_438,
    fightName: 'Practice Golem',
    durationMS: DURATION_MS,
    success: true,
    isCM: false,
    recordedBy: 'Blade Dancer',
    timeStartStd: '2026-08-04 12:00:00 -06:00',
    phases: [{ start: 0, end: DURATION_MS, name: 'Full Fight' }],
    targets: [{ name: 'Massive Golem', totalHealth: 20_000_000 }],
    players: [
      {
        name: 'Blade Dancer',
        account: 'Blade.1234',
        group: 1,
        profession: 'Virtuoso',
        firstAware: 0,
        lastAware: DURATION_MS,
        activeTimes: [DURATION_MS],
        weaponSets: [
          { weapons: ['Sword', 'Focus'], start: 0, end: DURATION_MS },
          { weapons: ['Spear', '2Hand'], start: 0, end: DURATION_MS },
        ],
        dpsAll: [{ dps: 24_500, damage: 1_470_000 }],
        statsAll: [{ wasted: 1, timeWasted: 0.8, saved: 1, timeSaved: 0.3, swapCount: 1 }],
        defenses: [{ deadCount: 0, downCount: 0, dodgeCount: 4 }],
        rotation: rotation(),
        buffUptimes: [
          // Alacrity drops for ten seconds in the middle of the fight.
          { id: ALACRITY, states: [[0, 1], [15_000, 0], [25_000, 1]] },
          { id: QUICKNESS, states: [[0, 1]] },
          { id: FURY, states: [[0, 1]] },
          { id: MIGHT, states: [[0, 25]] },
          {
            id: BLADES,
            states: [
              [0, 0],
              [1000, 2],
              [5000, 5],
              [20_001, 0],
              [22_000, 3],
              [25_001, 0],
              [27_000, 2],
              [30_001, 0],
              [40_000, 5],
            ],
          },
        ],
        damageModifiers: [
          { id: 1, damageModifiers: [{ hitCount: 40, totalHitCount: 80, damageGain: 0.15, totalDamage: 400_000 }] },
          { id: 2, damageModifiers: [{ hitCount: 12, totalHitCount: 12, damageGain: 0.1, totalDamage: 120_000 }] },
        ],
        totalDamageDist: [
          [
            { id: MIND_SPIKE, totalDamage: 210_000, hits: 3, connectedHits: 3 },
            { id: BLADESONG_HARMONY, totalDamage: 480_000, hits: 3, connectedHits: 3 },
            { id: PHANTASMAL_LANCER, totalDamage: 180_000, hits: 1, connectedHits: 1 },
          ],
        ],
      },
    ],
    skillMap: {
      [`s${MIND_SLASH}`]: { name: 'Mind Slash', autoAttack: true },
      [`s${MIND_GASH}`]: { name: 'Mind Gash', autoAttack: true },
      [`s${MIND_SPIKE}`]: { name: 'Mind Spike', autoAttack: true },
      [`s${PHANTASMAL_LANCER}`]: { name: 'Phantasmal Lancer' },
      [`s${SIGNET_OF_THE_ETHER}`]: { name: 'Signet of the Ether', isInstantCast: true },
      [`s${RAIN_OF_SWORDS}`]: { name: 'Rain of Swords' },
      [`s${THOUSAND_CUTS}`]: { name: 'Thousand Cuts' },
      [`s${NULL_FIELD}`]: { name: 'Null Field' },
      [`s${BLADESONG_HARMONY}`]: { name: 'Bladesong Harmony', isInstantCast: true },
      [`s${BLADESONG_DISTORTION}`]: { name: 'Bladesong Distortion', isInstantCast: true },
      [`s${BLADERTURN_REQUIEM}`]: { name: 'Bladeturn Requiem', isInstantCast: true },
      [`s${BLADECALL}`]: { name: 'Bladecall' },
    },
    buffMap: {
      [`b${ALACRITY}`]: { name: 'Alacrity', stacking: false },
      [`b${QUICKNESS}`]: { name: 'Quickness', stacking: false },
      [`b${FURY}`]: { name: 'Fury', stacking: false },
      [`b${MIGHT}`]: { name: 'Might', stacking: true },
      [`b${BLADES}`]: { name: 'Blades', stacking: true },
    },
    damageModMap: {
      d1: { name: 'Mental Focus' },
      d2: { name: 'Infinite Forge' },
    },
    personalBuffs: { Virtuoso: [BLADES] },
    logErrors: [],
  };
}

export const fixtureSource: LogSource = {
  kind: 'dpsreport',
  id: 'fixture-20260804-120000_golem',
  permalink: 'https://dps.report/fixture-20260804-120000_golem',
  jsonUrl: 'https://dps.report/getJson?permalink=fixture',
  serviceName: 'dps.report',
};
