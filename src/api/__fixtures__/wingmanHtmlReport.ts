/**
 * Trimmed Elite Insights HTML-report fixture shaped like Wingman getJson.
 * Cast tuples: [startSec, skillId, actualDurationMs, status, acceleration]
 * Status: 1 REDUCED, 2 CANCEL, 3 FULL, 4 INSTANT
 */
export const wingmanHtmlReport = {
  logName: 'Test Golem',
  parser: 'Elite Insights 3.26.0.0',
  arcVersion: 'EVTC20240301',
  gw2Build: 159271,
  recordedBy: 'Test Virtuoso',
  recordedAccountBy: 'Tester.1234',
  logStart: '2024-03-11 17:37:50 -04:00',
  logEnd: '2024-03-11 17:39:50 -04:00',
  evtcRecordingDuration: '02m 00s 000ms',
  triggerID: 1,
  icon: 'https://i.imgur.com/TCSo8TI.png',
  skillMap: {
    s1001: { id: 1001, name: 'Mind Slash', aa: true, isSwap: false, notAccurate: false },
    s1002: { id: 1002, name: 'Blade Song', aa: false, isSwap: false, notAccurate: false },
    s1003: { id: 1003, name: 'Phantasmal Swordsman', aa: false, isSwap: false, notAccurate: false },
    's-2': { id: -2, name: 'Weapon Swap', aa: false, isSwap: true, notAccurate: false },
  },
  buffMap: {
    b1187: { id: 1187, name: 'Quickness', stacking: false, consumable: false },
    b740: { id: 740, name: 'Might', stacking: true, consumable: false },
    // EI uses a synthetic id and the name "Virtuoso Blade" for the stack resource.
    'b-25': { id: -25, name: 'Virtuoso Blade', stacking: true, consumable: false },
    b57409: {
      id: 57409,
      name: 'Cilantro and Cured Meat Flatbread',
      stacking: false,
      consumable: true,
      icon: '/cache/https_render.guildwars2.com_file_13906DE02D374DBB6A013C5EF76F26FBAFD5A39A_2191050.png',
    },
    b33836: {
      id: 33836,
      name: 'Writ of Masterful Malice',
      stacking: false,
      consumable: true,
      icon: '/cache/https_render.guildwars2.com_file_0B09BA2F77DD6B686D7DD2F700975E4B0CAF4C1D_1201888.png',
    },
  },
  damageModMap: {
    d10: { id: 10, name: 'Moving Bonus', nonMultiplier: false, skillBased: false, approximate: false },
    d23: { id: 23, name: 'Mental Focus', nonMultiplier: false, skillBased: false, approximate: false },
    d211: {
      id: 211,
      name: 'Writ of Masterful Malice',
      nonMultiplier: false,
      skillBased: false,
      approximate: false,
    },
  },
  dmgModifiersCommon: [10],
  dmgModifiersItem: [211],
  dmgModifiersPers: { Virtuoso: [23] },
  persBuffs: { Virtuoso: [-25] },
  phases: [
    {
      name: 'Full Fight',
      start: 0,
      end: 120,
      duration: 120_000,
      success: true,
      mode: 'Normal Mode',
      startStatus: null,
      // Cleave / all-targets damage.
      dpsStats: [[1_200_000, 1_000_000, 200_000, 0]],
      // Per-player, per-target boss damage (single-target).
      dpsStatsTargets: [[[900_000, 750_000, 150_000, 0]]],
      gameplayStats: [[1.5, 2, 0.8, 3, 1, 0, 0, 90, 80]],
      defStats: [[50_000, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, '0% Downed', 0, '100% Alive']],
      playerActiveTimes: [120_000],
      dmgModifiersCommon: [{ data: [[40, 80, 1000, 1_200_000]] }],
      dmgModifiersItem: [{ data: [[90, 100, 800, 1_200_000]] }],
      dmgModifiersPers: [{ data: [[12, 12, 500, 1_200_000]] }],
      targets: [0],
      subPhases: [],
      breakbarPhase: false,
    },
  ],
  targets: [{ name: 'Standard Golem', health: 10_000_000, firstAware: 0, lastAware: 120 }],
  players: [
    {
      name: 'Test Virtuoso',
      acc: 'Tester.1234',
      group: 1,
      profession: 'Virtuoso',
      isPoV: true,
      firstAware: 0,
      lastAware: 120,
      weaponSets: {
        l1Set: ['Sword', 'Focus'],
        l2Set: ['Spear'],
        a1Set: [],
        a2Set: [],
        start: 0,
        end: 120_000,
      },
      details: {
        rotation: [
          [
            // FULL auto
            [0.0, 1001, 600, 3, 0],
            // REDUCED (aftercast cancel) — sentinel timeGained
            [0.7, 1002, 900, 1, 1],
            // CANCEL / interrupted — timeGained = -duration
            [2.0, 1003, 450, 2, 0],
            // INSTANT weapon swap
            [3.0, -2, 0, 4, 0],
            // another FULL
            [3.5, 1001, 600, 3, 0.5],
          ],
        ],
        boonGraph: [
          [
            {
              id: 1187,
              color: '',
              states: [
                [0, 1],
                [30.5, 0],
                [45, 1],
                [120, 1],
              ],
            },
            {
              id: 740,
              color: '',
              states: [
                [0, 10],
                [10.25, 15],
                [120, 12],
              ],
            },
            {
              id: -25,
              color: '',
              states: [
                [0, 5],
                [2.0, 0],
                [5, 3],
              ],
            },
          ],
        ],
        dmgDistributions: [
          {
            contributedDamage: 1_200_000,
            totalDamage: 1_200_000,
            totalCasting: 100_000,
            distribution: [
              [false, 1001, 400_000, 100, 5000, 10, 20, 5, 2, 0, 0, 0, 0, 50_000, 22, 0, 0, 0, 0, 0, 0, 0, 0],
              [false, 1002, 800_000, 200, 9000, 5, 10, 3, 1, 0, 0, 0, 0, 80_000, 12, 0, 0, 0, 0, 0, 0, 0, 0],
            ],
          },
        ],
        food: [
          { id: 57409, time: -0.005, duration: 1800, stack: 1, uniqueSlot: 1, dimished: false },
          { id: 33836, time: -0.004, duration: 1800, stack: 1, uniqueSlot: 2, dimished: false },
        ],
      },
    },
  ],
};
