import { describe, expect, it } from 'vitest';
import { wingmanHtmlReport } from './__fixtures__/wingmanHtmlReport.ts';
import {
  __test__,
  adaptEiHtmlReport,
  isEiHtmlReport,
} from './eiHtmlAdapt.ts';
import { parseLogInput } from './logSource.ts';
import { findBladeBuffId, normalizeLog, pickDefaultPlayer } from '../model/normalize.ts';

describe('isEiHtmlReport', () => {
  it('detects Wingman / HTML-report payloads', () => {
    expect(isEiHtmlReport(wingmanHtmlReport)).toBe(true);
  });

  it('rejects standard EI JSON shape', () => {
    expect(
      isEiHtmlReport({
        durationMS: 1000,
        players: [{ name: 'A', rotation: [{ id: 1, skills: [] }] }],
      }),
    ).toBe(false);
  });
});

describe('adaptEiHtmlReport', () => {
  const adapted = adaptEiHtmlReport(wingmanHtmlReport);

  it('maps fight metadata and duration', () => {
    expect(adapted.fightName).toBe('Test Golem');
    expect(adapted.durationMS).toBe(120_000);
    expect(adapted.success).toBe(true);
    expect(adapted.recordedBy).toBe('Test Virtuoso');
    expect(adapted.phases?.[0]).toMatchObject({ start: 0, end: 120_000, name: 'Full Fight' });
  });

  it('maps rotation status to timeGained', () => {
    const castsBySkill = new Map(
      (adapted.players?.[0].rotation ?? []).map((entry) => [entry.id, entry.skills ?? []]),
    );

    const fullAuto = castsBySkill.get(1001)?.[0];
    expect(fullAuto).toMatchObject({ castTime: 0, duration: 600, timeGained: 0, quickness: 0 });

    const reduced = castsBySkill.get(1002)?.[0];
    expect(reduced?.timeGained).toBe(__test__.REDUCED_TIME_GAINED_SENTINEL);
    expect(reduced?.castTime).toBe(700);
    expect(reduced?.quickness).toBe(1);

    const cancelled = castsBySkill.get(1003)?.[0];
    expect(cancelled).toMatchObject({ castTime: 2000, duration: 450, timeGained: -450 });

    const swap = castsBySkill.get(-2)?.[0];
    expect(swap).toMatchObject({ castTime: 3000, duration: 0, timeGained: 0 });
  });

  it('converts buff graph states from seconds to milliseconds', () => {
    const quickness = adapted.players?.[0].buffUptimes?.find((buff) => buff.id === 1187);
    expect(quickness?.states).toEqual([
      [0, 1],
      [30_500, 0],
      [45_000, 1],
      [120_000, 1],
    ]);

    const might = adapted.players?.[0].buffUptimes?.find((buff) => buff.id === 740);
    expect(might?.states?.[1]).toEqual([10_250, 15]);
  });

  it('maps skill flags, personal buffs, weapons and damage mods', () => {
    expect(adapted.skillMap?.s1001).toMatchObject({ name: 'Mind Slash', autoAttack: true });
    expect(adapted.skillMap?.['s-2']).toMatchObject({ name: 'Weapon Swap', isSwap: true });
    expect(adapted.personalBuffs?.Virtuoso).toEqual([-25]);
    expect(adapted.players?.[0].weaponSets).toEqual([
      { weapons: ['Sword', 'Focus'], start: 0, end: 120_000 },
      { weapons: ['Spear'], start: 0, end: 120_000 },
    ]);
    expect(adapted.players?.[0].damageModifiers).toEqual(
      expect.arrayContaining([
        {
          id: 10,
          damageModifiers: [{ hitCount: 40, totalHitCount: 80, damageGain: 1000, totalDamage: 1_200_000 }],
        },
        {
          id: 23,
          damageModifiers: [{ hitCount: 12, totalHitCount: 12, damageGain: 500, totalDamage: 1_200_000 }],
        },
      ]),
    );
  });

  it('classifies food vs utility consumables from HTML uniqueSlot', () => {
    expect(adapted.buffMap?.b57409?.classification).toBe('Nourishment');
    expect(adapted.buffMap?.b33836?.classification).toBe('Enhancement');
    expect(adapted.players?.[0].consumables).toEqual([
      { id: 57409, time: -5, duration: 1_800_000, stack: 1, uniqueSlot: 1 },
      { id: 33836, time: -4, duration: 1_800_000, stack: 1, uniqueSlot: 2 },
    ]);
  });

  it('produces a NormalizedLog the rest of the pipeline can read', () => {
    const source = parseLogInput('https://gw2wingman.nevermindcreations.de/log/fixture-20240311-173750_golem');
    const log = normalizeLog(adapted, source);
    const player = pickDefaultPlayer(log);
    expect(player?.name).toBe('Test Virtuoso');
    expect(player?.casts.length).toBe(5);
    expect(player?.casts.some((cast) => cast.timeGained < 0)).toBe(true);
    expect(player?.casts.some((cast) => cast.timeGained > 0)).toBe(true);
    expect(player?.buffs.get(1187)?.stacksAt(0)).toBe(1);
    expect(player?.buffs.get(740)?.stacksAt(10_250)).toBe(15);
    // EI names the mechanic "Virtuoso Blade" (synthetic id -25), not "Blades".
    expect(findBladeBuffId(log)).toBe(-25);
    expect(player?.buffs.get(-25)?.stacksAt(0)).toBe(5);
    expect(player?.reportedTimeWastedMs).toBe(1500);
    expect(player?.reportedTimeSavedMs).toBe(800);
    expect(player?.consumables).toEqual([
      expect.objectContaining({
        id: 57409,
        name: 'Cilantro and Cured Meat Flatbread',
        kind: 'food',
      }),
      expect.objectContaining({
        id: 33836,
        name: 'Writ of Masterful Malice',
        kind: 'utility',
      }),
    ]);
    expect(player?.damageModifiers.find((mod) => mod.name === 'Writ of Masterful Malice')).toMatchObject({
      source: 'utility',
    });
    expect(player?.damageModifiers.find((mod) => mod.name === 'Mental Focus')).toMatchObject({
      source: 'trait',
    });
  });
});

describe('timeGainedFromStatus', () => {
  it('matches EI AnimationStatus semantics', () => {
    expect(__test__.timeGainedFromStatus(__test__.RotationStatus.FULL, 900)).toBe(0);
    expect(__test__.timeGainedFromStatus(__test__.RotationStatus.INSTANT, 0)).toBe(0);
    expect(__test__.timeGainedFromStatus(__test__.RotationStatus.CANCEL, 450)).toBe(-450);
    expect(__test__.timeGainedFromStatus(__test__.RotationStatus.REDUCED, 900)).toBe(
      __test__.REDUCED_TIME_GAINED_SENTINEL,
    );
  });
});
