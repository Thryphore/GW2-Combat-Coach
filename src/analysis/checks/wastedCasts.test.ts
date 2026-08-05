import { describe, expect, it } from 'vitest';
import type { NormalizedCast, NormalizedPlayer } from '../../model/normalize.ts';
import { measureCancelledCasts } from './wastedCasts.ts';

const ILLUSIONARY_RIPOSTE = 10280;
const RAIN_OF_SWORDS = 45425;

function cast(partial: Partial<NormalizedCast> & Pick<NormalizedCast, 'skillId' | 'name' | 'timeGained'>): NormalizedCast {
  return {
    index: 0,
    time: 0,
    duration: 1000,
    endTime: 1000,
    quickness: 0,
    isAutoAttack: false,
    isInstant: false,
    isWeaponSwap: false,
    ...partial,
  };
}

function playerWith(casts: NormalizedCast[]): NormalizedPlayer {
  return {
    name: 'Test',
    account: 'Test.1234',
    group: 1,
    profession: 'Virtuoso',
    firstAware: 0,
    lastAware: 60_000,
    activeTimeMs: 60_000,
    dps: 0,
    damage: 0,
    casts,
    buffs: new Map(),
    buffGeneration: new Map(),
    consumables: [],
    weaponSets: [],
    damageModifiers: [],
    damageBySkill: new Map(),
    deaths: 0,
    downs: 0,
    dodges: 0,
    weaponSwaps: 0,
    reportedTimeWastedMs: 0,
    reportedTimeSavedMs: 0,
  };
}

describe('measureCancelledCasts', () => {
  it('does not treat Illusionary Riposte early cancels as wasted casts', () => {
    const measured = measureCancelledCasts(
      playerWith([
        cast({
          skillId: ILLUSIONARY_RIPOSTE,
          name: 'Illusionary Riposte',
          time: 5_000,
          timeGained: -800,
        }),
        cast({
          skillId: ILLUSIONARY_RIPOSTE,
          name: 'Illusionary Riposte',
          time: 20_000,
          timeGained: -600,
        }),
        cast({
          skillId: ILLUSIONARY_RIPOSTE,
          name: 'Illusionary Riposte',
          time: 40_000,
          timeGained: -700,
        }),
      ]),
      { start: 0, end: 60_000 },
    );

    expect(measured.abortedCount).toBe(0);
    expect(measured.wastedMs).toBe(0);
    expect(measured.worst).toEqual([]);
  });

  it('still counts real aborted casts on other skills', () => {
    const measured = measureCancelledCasts(
      playerWith([
        cast({
          skillId: ILLUSIONARY_RIPOSTE,
          name: 'Illusionary Riposte',
          time: 5_000,
          timeGained: -800,
        }),
        cast({
          skillId: RAIN_OF_SWORDS,
          name: 'Rain of Swords',
          time: 12_000,
          timeGained: -900,
        }),
      ]),
      { start: 0, end: 60_000 },
    );

    expect(measured.abortedCount).toBe(1);
    expect(measured.wastedMs).toBe(900);
    expect(measured.worst[0]?.name).toBe('Rain of Swords');
  });
});
