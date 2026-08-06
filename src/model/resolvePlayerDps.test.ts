import { describe, expect, it } from 'vitest';
import { resolvePeakDps, resolvePlayerDps, shouldShowCleaveDps } from './normalize.ts';

describe('resolvePlayerDps', () => {
  it('prefers primary-target DPS over cleave', () => {
    expect(
      resolvePlayerDps({
        dpsAll: [{ dps: 30_000, damage: 1_800_000 }],
        dpsTargets: [[{ dps: 22_000, damage: 1_320_000 }]],
      }),
    ).toEqual({
      dps: 22_000,
      damage: 1_320_000,
      cleaveDps: 30_000,
      cleaveDamage: 1_800_000,
    });
  });

  it('falls back to All DPS when per-target stats are missing', () => {
    expect(resolvePlayerDps({ dpsAll: [{ dps: 18_000, damage: 900_000 }] })).toEqual({
      dps: 18_000,
      damage: 900_000,
      cleaveDps: 18_000,
      cleaveDamage: 900_000,
    });
  });

  it('swaps inverted target/All fields so target never exceeds All', () => {
    expect(
      resolvePlayerDps({
        dpsAll: [{ dps: 22_000, damage: 1_320_000 }],
        dpsTargets: [[{ dps: 30_000, damage: 1_800_000 }]],
      }),
    ).toEqual({
      dps: 22_000,
      damage: 1_320_000,
      cleaveDps: 30_000,
      cleaveDamage: 1_800_000,
    });
  });

  it('without phase targets, uses the highest-damage single target', () => {
    expect(
      resolvePlayerDps({
        dpsAll: [{ dps: 28_400, damage: 1_700_000 }],
        dpsTargets: [
          [{ dps: 5_500, damage: 330_000 }],
          [{ dps: 24_415, damage: 1_465_000 }],
        ],
      }),
    ).toEqual({
      dps: 24_415,
      damage: 1_465_000,
      cleaveDps: 28_400,
      cleaveDamage: 1_700_000,
    });
  });

  it('sums full-fight phase targets (Harvest Temple voids)', () => {
    // EI Target DPS is the sum across phases[0].targets, not max single void.
    expect(
      resolvePlayerDps(
        {
          dpsAll: [{ dps: 28_412, damage: 1_705_000 }],
          dpsTargets: [
            [{ dps: 5_512, damage: 330_720 }],
            [{ dps: 4_201, damage: 252_060 }],
            [{ dps: 3_890, damage: 233_400 }],
            [{ dps: 3_412, damage: 204_720 }],
            [{ dps: 3_800, damage: 228_000 }],
            [{ dps: 3_600, damage: 216_000 }],
            [{ dps: 800, damage: 48_000 }], // non-phase add — ignored
          ],
        },
        { targetIndices: [0, 1, 2, 3, 4, 5] },
      ),
    ).toEqual({
      dps: 24_415,
      damage: 1_464_900,
      cleaveDps: 28_412,
      cleaveDamage: 1_705_000,
    });
  });
});

describe('resolvePeakDps', () => {
  it('splits single-target and cleave peaks from cumulative 1s series', () => {
    expect(
      resolvePeakDps({
        // Cleave peak 50k; main-target peak 40k (52k - 12k).
        damage1S: [[10_000, 60_000]],
        dpsTargets: [[{ damage: 85_000 }], [{ damage: 10_000 }]],
        targetDamage1S: [
          [[12_000, 52_000, 85_000]],
          [[1_000, 2_000, 3_000]],
        ],
      }),
    ).toEqual({ peakDps: 40_000, peakCleaveDps: 50_000 });
  });

  it('reads peak damage from the same target as average DPS', () => {
    expect(
      resolvePeakDps({
        damage1S: [[10_000, 60_000]],
        dpsTargets: [[{ damage: 10_000 }], [{ damage: 85_000 }]],
        targetDamage1S: [
          [[1_000, 2_000, 3_000]],
          [[12_000, 52_000, 85_000]],
        ],
      }),
    ).toEqual({ peakDps: 40_000, peakCleaveDps: 50_000 });
  });

  it('peaks the summed 1s series across phase targets', () => {
    expect(
      resolvePeakDps(
        {
          damage1S: [[10_000, 80_000]],
          dpsTargets: [[{ damage: 40_000 }], [{ damage: 50_000 }]],
          targetDamage1S: [
            [[5_000, 20_000, 40_000]],
            [[5_000, 25_000, 50_000]],
          ],
        },
        { targetIndices: [0, 1] },
      ),
    ).toEqual({
      // t0: 10k, t1: 45k (+35k), t2: 90k (+45k) → peak 45k
      peakDps: 45_000,
      peakCleaveDps: 70_000,
    });
  });

  it('uses cleave for both when per-target data is missing', () => {
    expect(resolvePeakDps({ damage1S: [[8_000, 35_500, 46_500]] })).toEqual({
      peakDps: 27_500,
      peakCleaveDps: 27_500,
    });
  });

  it('returns 0 when graph data is missing', () => {
    expect(resolvePeakDps({})).toEqual({ peakDps: 0, peakCleaveDps: 0 });
  });
});

describe('shouldShowCleaveDps', () => {
  it('shows cleave only when it is more than 15% above single-target', () => {
    expect(shouldShowCleaveDps({ dps: 20_000, cleaveDps: 22_000 })).toBe(false);
    expect(shouldShowCleaveDps({ dps: 20_000, cleaveDps: 23_001 })).toBe(true);
    expect(shouldShowCleaveDps({ dps: 0, cleaveDps: 30_000 })).toBe(false);
  });
});
