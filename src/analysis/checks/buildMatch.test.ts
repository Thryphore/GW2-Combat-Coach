import { describe, expect, it } from 'vitest';
import { SkillIndex, type ProfessionSnapshot } from '../../api/gw2.ts';
import mesmerSnapshot from '../../data/gw2/mesmer.json';
import type { InferredBuild, ReferenceBuild } from '../../model/build.ts';
import type { NormalizedLog, NormalizedPlayer } from '../../model/normalize.ts';
import { fixtureSource, virtuosoLogFixture } from '../__fixtures__/virtuosoLog.ts';
import { normalizeLog, pickDefaultPlayer } from '../../model/normalize.ts';
import {
  buildMatchCheck,
  comparableReferenceSkills,
  comparableReferenceSpecializations,
  comparableReferenceTraits,
  comparableReferenceWeapons,
  observableTraitNames,
} from './buildMatch.ts';

const skills = new SkillIndex(mesmerSnapshot as unknown as ProfessionSnapshot);

function trait(name: string, specialization = 'Virtuoso') {
  return { name, specialization, evidence: 'chat-code' as const };
}

function referenceBuild(options: {
  traits?: string[];
  heal?: string;
  utilities?: string[];
  elite?: string;
  weapons?: string[];
  specializations?: Array<{ name: string; traits: string[] }>;
}): ReferenceBuild {
  const specs = options.specializations ?? [
    { name: 'Virtuoso', traits: options.traits ?? [] },
  ];
  return {
    name: 'Power Virtuoso',
    source: 'metabattle',
    profession: 'Mesmer',
    eliteSpec: 'Virtuoso',
    weapons: options.weapons ?? ['Sword', 'Sword', 'Spear'],
    heal: options.heal ? { name: options.heal } : undefined,
    utilities: (options.utilities ?? []).map((name) => ({ name })),
    elite: options.elite ? { name: options.elite } : undefined,
    specializations: specs.map((spec) => ({
      name: spec.name,
      traits: spec.traits.map((name) => trait(name, spec.name)),
    })),
  };
}

function observedBuild(options: {
  traits?: string[];
  /** Pass null to omit the heal skill; omit the field to use the fixture default. */
  heal?: string | null;
  utilities?: string[];
  elite?: string | null;
  weaponSets?: string[][];
  specializations?: string[];
}): InferredBuild {
  return {
    profession: 'Virtuoso',
    weaponSets: options.weaponSets ?? [
      ['Sword', 'Focus'],
      ['Spear'],
    ],
    heal:
      options.heal === null
        ? undefined
        : options.heal
          ? { name: options.heal }
          : { name: 'Signet of the Ether' },
    utilities: (options.utilities ?? ['Rain of Swords', 'Null Field']).map((name) => ({ name })),
    elite:
      options.elite === null
        ? undefined
        : options.elite
          ? { name: options.elite }
          : { name: 'Thousand Cuts' },
    traits: (options.traits ?? []).map((name) => ({
      name,
      specialization: 'Virtuoso',
      evidence: 'damage-modifier' as const,
    })),
    specializations: options.specializations ?? ['Virtuoso'],
    notes: [],
  };
}

describe('comparableReferenceTraits', () => {
  const log = normalizeLog(virtuosoLogFixture(), fixtureSource);
  const player = pickDefaultPlayer(log)!;

  it('keeps only MetaBattle traits that are observable in this log', () => {
    const comparable = comparableReferenceTraits({
      referenceBuild: referenceBuild({
        traits: ['Mental Focus', 'Infinite Forge', 'Quiet Intensity', 'Made of Magic'],
      }),
      log,
      player,
      skills,
    });

    expect(comparable.map((entry) => entry.name).sort()).toEqual(['Infinite Forge', 'Mental Focus']);
  });

  it('when a reference log is present, keeps only traits that registered there', () => {
    const comparable = comparableReferenceTraits({
      referenceBuild: referenceBuild({
        traits: ['Mental Focus', 'Infinite Forge', 'Quiet Intensity'],
      }),
      log,
      player,
      skills,
      referenceObserved: observedBuild({ traits: ['Mental Focus'] }),
    });

    expect(comparable.map((entry) => entry.name)).toEqual(['Mental Focus']);
  });
});

describe('comparableReferenceSkills', () => {
  it('keeps the full MetaBattle skill bar when there is no reference log', () => {
    const comparable = comparableReferenceSkills({
      referenceBuild: referenceBuild({
        heal: 'Signet of the Ether',
        utilities: ['Rain of Swords', 'Mirror Images', 'Null Field'],
        elite: 'Thousand Cuts',
      }),
    });
    expect(comparable.map((skill) => skill.name)).toEqual([
      'Signet of the Ether',
      'Rain of Swords',
      'Mirror Images',
      'Null Field',
      'Thousand Cuts',
    ]);
  });

  it('keeps only skills the reference log actually cast', () => {
    const comparable = comparableReferenceSkills({
      referenceBuild: referenceBuild({
        heal: 'Signet of the Ether',
        utilities: ['Rain of Swords', 'Mirror Images', 'Null Field'],
        elite: 'Thousand Cuts',
      }),
      referenceObserved: observedBuild({
        heal: 'Signet of the Ether',
        utilities: ['Rain of Swords', 'Null Field'],
        elite: 'Thousand Cuts',
      }),
    });
    expect(comparable.map((skill) => skill.name)).toEqual([
      'Signet of the Ether',
      'Rain of Swords',
      'Null Field',
      'Thousand Cuts',
    ]);
  });
});

describe('comparableReferenceSpecializations', () => {
  const log = normalizeLog(virtuosoLogFixture(), fixtureSource);
  const player = pickDefaultPlayer(log)!;

  it('without a reference log, keeps only specs with observable traits', () => {
    const comparable = comparableReferenceSpecializations({
      referenceBuild: referenceBuild({
        specializations: [
          { name: 'Domination', traits: ['Compromising Memories'] },
          { name: 'Dueling', traits: ["Fencer's Finesse"] },
          { name: 'Virtuoso', traits: ['Mental Focus', 'Infinite Forge', 'Quiet Intensity'] },
        ],
      }),
      log,
      player,
      skills,
    });
    expect(comparable).toEqual(['Virtuoso']);
  });
});

describe('comparableReferenceWeapons', () => {
  it('filters MetaBattle weapons to those used in the reference log', () => {
    expect(
      comparableReferenceWeapons({
        referenceBuild: referenceBuild({ weapons: ['Sword', 'Focus', 'Spear', 'Staff'] }),
        referenceObserved: observedBuild({
          weaponSets: [
            ['Sword', 'Focus'],
            ['Spear'],
          ],
        }),
      }),
    ).toEqual(['Sword', 'Focus', 'Spear']);
  });
});

describe('buildMatchCheck', () => {
  const log = normalizeLog(virtuosoLogFixture(), fixtureSource);
  const player = pickDefaultPlayer(log)!;

  it('does not flag MetaBattle traits that never show up in logs', () => {
    const findings = buildMatchCheck.run({
      log,
      player,
      window: log.fullFight,
      skills,
      build: observedBuild({ traits: ['Mental Focus', 'Infinite Forge'] }),
      referenceBuild: referenceBuild({
        traits: [
          'Mental Focus',
          'Infinite Forge',
          'Quiet Intensity',
          'Made of Magic',
          'Psychic Riposte',
          'Sharper Images',
          "Fencer's Finesse",
        ],
      }),
    });

    expect(findings.find((finding) => finding.id === 'build-match/traits')?.severity).toBe('good');
  });

  it('flags a trait only when the reference log registered it and yours did not', () => {
    const referencePlayer: NormalizedPlayer = {
      ...player,
      name: 'Reference Virtuoso',
    };
    const referenceLog: NormalizedLog = {
      ...log,
      players: [referencePlayer],
      recordedBy: referencePlayer.name,
    };

    const findings = buildMatchCheck.run({
      log,
      player,
      window: log.fullFight,
      skills,
      build: observedBuild({ traits: ['Mental Focus'] }),
      referenceBuild: referenceBuild({
        traits: ['Mental Focus', 'Infinite Forge', 'Quiet Intensity'],
      }),
      reference: { log: referenceLog, player: referencePlayer },
    });

    const traitFinding = findings.find((finding) => finding.id === 'build-match/traits');
    expect(traitFinding?.severity).toBe('info');
    expect(traitFinding?.title).toBe('1 reference trait never showed up in your log');
    expect(traitFinding?.summary).toContain('Infinite Forge');
    expect(traitFinding?.summary).not.toContain('Quiet Intensity');
  });

  it('does not flag MetaBattle skills the reference log also never cast', () => {
    const referencePlayer: NormalizedPlayer = {
      ...player,
      name: 'Reference Virtuoso',
      // Drop the heal casts so Signet of the Ether is unused in the reference too.
      casts: player.casts.filter((cast) => cast.name !== 'Signet of the Ether'),
    };
    const referenceLog: NormalizedLog = {
      ...log,
      players: [referencePlayer],
      recordedBy: referencePlayer.name,
    };

    const findings = buildMatchCheck.run({
      log,
      player,
      window: log.fullFight,
      skills,
      build: observedBuild({
        traits: ['Mental Focus', 'Infinite Forge'],
        heal: null,
        utilities: ['Rain of Swords', 'Null Field'],
        elite: 'Thousand Cuts',
      }),
      referenceBuild: referenceBuild({
        traits: ['Mental Focus', 'Infinite Forge'],
        heal: 'Signet of the Ether',
        utilities: ['Rain of Swords', 'Mirror Images', 'Null Field'],
        elite: 'Thousand Cuts',
      }),
      reference: { log: referenceLog, player: referencePlayer },
    });

    const skillFinding = findings.find((finding) => finding.id === 'build-match/skills');
    // Mirror Images is on MetaBattle but not cast by reference → ignored.
    // Signet of the Ether is on MetaBattle but also not cast by reference → ignored.
    expect(skillFinding?.severity).toBe('good');
    expect(skillFinding?.summary).not.toContain('Mirror Images');
    expect(skillFinding?.summary).not.toContain('Signet of the Ether');
  });

  it('flags a skill the reference cast that you never did', () => {
    const referencePlayer: NormalizedPlayer = {
      ...player,
      name: 'Reference Virtuoso',
    };
    const referenceLog: NormalizedLog = {
      ...log,
      players: [referencePlayer],
      recordedBy: referencePlayer.name,
    };

    const findings = buildMatchCheck.run({
      log,
      player,
      window: log.fullFight,
      skills,
      build: observedBuild({
        traits: ['Mental Focus', 'Infinite Forge'],
        utilities: ['Rain of Swords'],
        elite: 'Thousand Cuts',
      }),
      referenceBuild: referenceBuild({
        traits: ['Mental Focus', 'Infinite Forge'],
        heal: 'Signet of the Ether',
        utilities: ['Rain of Swords', 'Null Field'],
        elite: 'Thousand Cuts',
      }),
      reference: { log: referenceLog, player: referencePlayer },
    });

    const skillFinding = findings.find((finding) => finding.id === 'build-match/skills');
    expect(skillFinding?.severity).toBe('info');
    expect(skillFinding?.title).toMatch(/reference skill/);
    expect(skillFinding?.title).toMatch(/were never cast|was never cast/);
    expect(skillFinding?.summary).toContain('Null Field');
  });
});

describe('observableTraitNames', () => {
  it('returns trait names present as damage mods in the log', () => {
    const log = normalizeLog(virtuosoLogFixture(), fixtureSource);
    const player = pickDefaultPlayer(log)!;
    expect([...observableTraitNames(log, player, skills)].sort()).toEqual([
      'Infinite Forge',
      'Mental Focus',
    ]);
  });
});
