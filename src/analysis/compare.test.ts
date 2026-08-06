import { beforeAll, describe, expect, it } from 'vitest';
import { SkillIndex, type ProfessionSnapshot } from '../api/gw2.ts';
import mesmerSnapshot from '../data/gw2/mesmer.json';
import type { NormalizedCast, NormalizedLog, NormalizedPlayer } from '../model/normalize.ts';
import { normalizeLog, pickDefaultPlayer } from '../model/normalize.ts';
import { cooldownCheck } from './checks/cooldowns.ts';
import { downtimeCheck } from './checks/downtime.ts';
import { measureIdleTime } from './checks/downtime.ts';
import { fixtureSource, virtuosoLogFixture } from './__fixtures__/virtuosoLog.ts';
import { referenceLogCheck } from './compare.ts';

const skills = new SkillIndex(mesmerSnapshot as unknown as ProfessionSnapshot);

function basePlayer(name: string, fightEndMs: number, casts: NormalizedCast[]): NormalizedPlayer {
  return {
    name,
    account: 'Test.1234',
    group: 1,
    profession: 'Virtuoso',
    firstAware: 0,
    lastAware: fightEndMs,
    activeTimeMs: fightEndMs,
    dps: 20_000,
    damage: 20_000 * (fightEndMs / 1000),
    cleaveDps: 20_000,
    cleaveDamage: 20_000 * (fightEndMs / 1000),
    peakDps: 0,
    peakCleaveDps: 0,
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

function autoCasts(starts: number[]): NormalizedCast[] {
  return starts.map((time, index) => ({
    index,
    skillId: 10170,
    name: 'Mind Slash',
    time,
    duration: 500,
    endTime: time + 500,
    timeGained: 0,
    quickness: 0,
    isAutoAttack: true,
    isInstant: false,
    isWeaponSwap: false,
  }));
}

function logFor(player: NormalizedPlayer, fightEndMs: number, fightName: string): NormalizedLog {
  return {
    source: {
      kind: 'dpsreport',
      id: fightName,
      permalink: `https://dps.report/${fightName}`,
      jsonUrl: `https://dps.report/getJson?permalink=${fightName}`,
      serviceName: 'dps.report',
    },
    fightName,
    durationMs: fightEndMs,
    success: true,
    isCM: false,
    isLateStart: false,
    gw2Build: 0,
    eliteInsightsVersion: '',
    arcVersion: '',
    recordedBy: player.name,
    startedAt: '',
    fullFight: { start: 0, end: fightEndMs, name: 'Full Fight', isFullFight: true },
    phases: [{ start: 0, end: fightEndMs, name: 'Full Fight', isFullFight: true }],
    players: [player],
    skills: new Map(),
    buffs: new Map(),
    damageMods: new Map(),
    personalBuffs: {},
    targetNames: ['Golem'],
    logErrors: [],
  };
}

describe('downtime and cooldown cards show the reference', () => {
  const fightEndMs = 60_000;

  it('puts reference idle time on the downtime finding', () => {
    const player = basePlayer(
      'You',
      fightEndMs,
      autoCasts([0, 1000, 2000, 3000, 4000, 5000, 40_000, 50_000, 55_000]),
    );
    const referencePlayer = basePlayer(
      'Benchmark',
      fightEndMs,
      autoCasts(Array.from({ length: 50 }, (_, index) => index * 1100)),
    );
    const log = logFor(player, fightEndMs, 'your-log');
    const referenceLog = logFor(referencePlayer, fightEndMs, 'reference-log');

    expect(measureIdleTime(player, log.fullFight).share).toBeGreaterThan(
      measureIdleTime(referencePlayer, referenceLog.fullFight).share + 0.07,
    );

    const finding = downtimeCheck.run({
      log,
      player,
      window: log.fullFight,
      reference: { log: referenceLog, player: referencePlayer },
    })[0];

    expect(finding?.id).toBe('downtime/idle');
    expect(finding?.summary + (finding?.tip ?? '')).toMatch(/reference/i);
    expect(finding?.metrics?.some((metric) => metric.label === 'Reference idle time')).toBe(true);
    expect(finding?.metrics?.some((metric) => metric.label === 'Your idle time')).toBe(true);
    expect(finding?.metrics?.every((metric) => metric.barMax && metric.barMax > 0)).toBe(true);
  });

  it('puts reference missed casts on the cooldown finding', () => {
    const playerLog = normalizeLog(virtuosoLogFixture(), fixtureSource);
    const player = pickDefaultPlayer(playerLog);
    if (!player) throw new Error('fixture missing player');

    const referenceRaw = virtuosoLogFixture();
    const lancer = referenceRaw.players?.[0].rotation?.find((entry) => entry.id === 72946);
    lancer?.skills?.push(
      { castTime: 20_000, duration: 600, timeGained: 0, quickness: 1 },
      { castTime: 35_000, duration: 600, timeGained: 0, quickness: 1 },
      { castTime: 50_000, duration: 600, timeGained: 0, quickness: 1 },
    );
    const referenceLog = normalizeLog(referenceRaw, {
      ...fixtureSource,
      id: 'reference-fixture',
      permalink: 'https://dps.report/reference-fixture',
    });
    const referencePlayer = pickDefaultPlayer(referenceLog);
    if (!referencePlayer) throw new Error('reference missing player');

    const finding = cooldownCheck.run({
      log: playerLog,
      player,
      window: playerLog.fullFight,
      skills,
      reference: { log: referenceLog, player: referencePlayer },
    })[0];

    expect(finding?.id).toBe('cooldowns/held');
    expect(finding?.summary + (finding?.tip ?? '')).toMatch(/reference/i);
    expect(finding?.metrics?.some((metric) => metric.label === 'Reference missed casts/min')).toBe(true);
    expect(finding?.metrics?.some((metric) => metric.label === 'Your missed casts/min')).toBe(true);
  });
});

describe('reference log auto-chain comparison', () => {
  let player: NormalizedPlayer;
  let referencePlayer: NormalizedPlayer;
  let playerLog: NormalizedLog;
  let referenceLog: NormalizedLog;

  beforeAll(() => {
    playerLog = normalizeLog(virtuosoLogFixture(), fixtureSource);
    const found = pickDefaultPlayer(playerLog);
    if (!found) throw new Error('fixture missing player');
    player = found;
    referenceLog = normalizeLog(virtuosoLogFixture(), {
      ...fixtureSource,
      id: 'reference-fixture',
      permalink: 'https://dps.report/reference-fixture',
    });
    const refPlayer = pickDefaultPlayer(referenceLog);
    if (!refPlayer) throw new Error('reference missing player');
    referencePlayer = refPlayer;
  });

  it('still compares auto-attack chain completion on the reference check', () => {
    const finding = referenceLogCheck
      .run({
        log: playerLog,
        player,
        window: playerLog.fullFight,
        skills,
        reference: { log: referenceLog, player: referencePlayer },
      })
      .find((entry) => entry.id === 'reference-log/auto-chains');

    expect(finding).toBeDefined();
    expect(finding?.title).toMatch(/chain completion/i);
  });
});
