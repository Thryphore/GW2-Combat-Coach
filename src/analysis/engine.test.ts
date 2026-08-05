import { beforeAll, describe, expect, it } from 'vitest';
import { SkillIndex, type ProfessionSnapshot } from '../api/gw2.ts';
import mesmerSnapshot from '../data/gw2/mesmer.json';
import { inferBuild } from '../model/build.ts';
import { normalizeLog, pickDefaultPlayer, type NormalizedLog, type NormalizedPlayer } from '../model/normalize.ts';
import { runAnalysis } from './engine.ts';
import type { AnalysisResult } from './types.ts';
import { fixtureSource, virtuosoLogFixture } from './__fixtures__/virtuosoLog.ts';

const skills = new SkillIndex(mesmerSnapshot as unknown as ProfessionSnapshot);

let log: NormalizedLog;
let player: NormalizedPlayer;
let result: AnalysisResult;

beforeAll(() => {
  log = normalizeLog(virtuosoLogFixture(), fixtureSource);
  const found = pickDefaultPlayer(log);
  if (!found) throw new Error('fixture has no players');
  player = found;
  result = runAnalysis({
    log,
    player,
    window: log.fullFight,
    skills,
    build: inferBuild(log, player, skills),
  });
});

function finding(id: string) {
  return result.findings.find((entry) => entry.id === id);
}

describe('normalizeLog', () => {
  it('flattens the rotation into a single ordered cast list', () => {
    expect(player.casts).toHaveLength(28);
    for (let i = 1; i < player.casts.length; i += 1) {
      expect(player.casts[i].time).toBeGreaterThanOrEqual(player.casts[i - 1].time);
    }
    expect(player.casts[0].name).toBe('Mind Slash');
    expect(player.casts[0].isAutoAttack).toBe(true);
  });

  it('reads weapon sets and headline stats', () => {
    expect(player.profession).toBe('Virtuoso');
    expect(player.weaponSets[0].weapons).toEqual(['Sword', 'Focus']);
    // The "2Hand" placeholder is not a weapon.
    expect(player.weaponSets[1].weapons).toEqual(['Spear']);
    expect(player.dps).toBe(24_500);
  });

  it('names damage modifiers from the damage modifier map', () => {
    expect(player.damageModifiers.map((mod) => mod.name)).toEqual(['Mental Focus', 'Infinite Forge']);
    expect(player.damageModifiers[0].hitRatio).toBeCloseTo(0.5);
  });
});

describe('auto-attack chain check', () => {
  it('flags chains that restarted before their final step', () => {
    const dropped = finding('auto-attack-chain/dropped');
    expect(dropped).toBeDefined();
    // The two restarts at 3.2s and 4.4s; the 9.5s restart is past the chain timeout.
    expect(dropped?.evidence).toHaveLength(2);
    expect(dropped?.severity).toBe('warning');
  });
});

describe('cancelled cast checks', () => {
  it('separates aborted casts from deliberate animation cancels', () => {
    const aborted = finding('wasted-casts/aborted');
    expect(aborted?.summary).toContain('Rain of Swords');

    const saved = finding('wasted-casts/saved');
    expect(saved?.severity).toBe('good');
  });
});

describe('downtime check', () => {
  it('finds the long silence in the middle of the fight', () => {
    const idle = finding('downtime/idle');
    expect(idle).toBeDefined();
    expect(idle?.severity).toBe('critical');
    // 42.5s to 55s.
    expect(idle?.evidence?.[0].time).toBe(42_500);
  });
});

describe('boon uptime check', () => {
  it('skips alacrity and quickness on a DPS log, and keeps personal offensive boons', () => {
    expect(finding('boon-uptime/alacrity')).toBeUndefined();
    expect(finding('boon-uptime/quickness')).toBeUndefined();
    expect(finding('boon-uptime/fury')?.severity).toBe('good');
    expect(finding('boon-uptime/might')?.severity).toBe('good');
  });
});

describe('combo check', () => {
  it('reports the ethereal field that no finisher followed', () => {
    const unused = finding('combos/unused-fields');
    expect(unused).toBeDefined();
    expect(unused?.title).toContain('1 combo field');
    expect(unused?.caveat).toContain('where you or your fields were standing');
  });
});

describe('cooldown check', () => {
  it('counts casts that the recharge would have allowed', () => {
    const held = finding('cooldowns/held');
    expect(held).toBeDefined();
    expect(held?.evidence?.some((item) => item.label.includes('Phantasmal Lancer'))).toBe(true);
  });
});

describe('virtuoso blade economy', () => {
  it('flags non-F4 F skills spent below five Blades and counts full-stack F casts', () => {
    const premature = finding('virtuoso/blades/premature');
    expect(premature).toBeDefined();
    expect(premature?.severity).toBe('critical');
    // Two early Harmonies; F4 Distortion below five is excluded from the warning.
    expect(premature?.summary).toContain('2 of 4');
    expect(premature?.metrics?.[0].display).toBe('2 / 5');
    // Five blades minus three, plus five minus two.
    expect(premature?.metrics?.[1].value).toBe(5);
    expect(premature?.evidence?.some((item) => item.label.includes('Distortion'))).toBe(false);
  });

  it('flags blade-generating skills while capped and notes when F5 was ready', () => {
    const wasted = finding('virtuoso/blades/wasted-gen');
    expect(wasted).toBeDefined();
    expect(wasted?.severity).toBe('info');
    expect(wasted?.metrics?.[0].value).toBe(3);
    expect(wasted?.insights?.[0].metrics?.[0].display).toBe('2 / 3');
  });
});

describe('virtuoso phantasms', () => {
  it('credits Signet of the Ether used while a phantasm was recharging', () => {
    expect(finding('virtuoso/phantasms/signet')?.severity).toBe('good');
  });
});

describe('build inference', () => {
  it('reconstructs skills and traits from what the log observed', () => {
    const build = inferBuild(log, player, skills);
    expect(build.heal?.name).toBe('Signet of the Ether');
    expect(build.utilities.map((skill) => skill.name)).toEqual(['Rain of Swords', 'Null Field']);
    expect(build.elite?.name).toBe('Thousand Cuts');
    expect(build.traits.map((trait) => trait.name)).toEqual(['Infinite Forge', 'Mental Focus']);
    expect(build.specializations).toContain('Virtuoso');
  });
});

describe('runAnalysis', () => {
  it('scores the fight and orders findings by severity', () => {
    expect(result.score).toBeLessThan(70);
    expect(result.score).toBeGreaterThan(0);

    const severities = result.findings.map((entry) => entry.severity);
    const order = ['critical', 'warning', 'info', 'good'];
    const indices = severities.map((severity) => order.indexOf(severity));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it('explains why inapplicable checks did not run', () => {
    const skipped = Object.fromEntries(result.checksSkipped.map(({ check, reason }) => [check.id, reason]));
    expect(skipped['reference-log']).toBe('No reference log was provided.');
    expect(skipped['build-match']).toBe('No MetaBattle raid reference build was available.');
  });
});
