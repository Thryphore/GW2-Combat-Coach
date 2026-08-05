import { describe, expect, it } from 'vitest';
import { SkillIndex, type ProfessionSnapshot } from '../api/gw2.ts';
import mesmerSnapshot from '../data/gw2/mesmer.json';
import { ChatCodeError, decodeBuildChatCode, referenceBuildFromChatCode } from './chatCode.ts';

const skills = new SkillIndex(mesmerSnapshot as unknown as ProfessionSnapshot);

// Taken from MetaBattle's "Virtuoso - Power Virtuoso" page, whose templates
// independently state Dueling top/bottom/top, Illusions mid/mid/top and
// Virtuoso mid/mid/mid.
const POWER_VIRTUOSO = '[&DQcBHRgaQiojDyMP3RrdGmkBaQFlAYUB5RrtEgAAAAAAAAAAAAAAAAAAAAADLwBaAAkBAA==]';
// From "Virtuoso - Condi DPS"; this one has no trailing weapon block.
const CONDI_VIRTUOSO = '[&DQcBHRgdQjsjDyMPgQGBAYMBgwGCAd0a5RrtEgAAAAAAAAAAAAAAAAAAAAA=]';

describe('decodeBuildChatCode', () => {
  it('reads the profession and specialization lines', () => {
    const decoded = decodeBuildChatCode(POWER_VIRTUOSO);

    expect(decoded.professionName).toBe('Mesmer');
    expect(decoded.specializations.map((spec) => spec.id)).toEqual([1, 24, 66]);
    // 0 is the top trait, 1 the middle, 2 the bottom.
    expect(decoded.specializations[0].choices).toEqual([0, 2, 0]);
    expect(decoded.specializations[1].choices).toEqual([1, 1, 0]);
    expect(decoded.specializations[2].choices).toEqual([1, 1, 1]);
  });

  it('handles codes without the trailing weapon block', () => {
    const decoded = decodeBuildChatCode(CONDI_VIRTUOSO);
    expect(decoded.professionName).toBe('Mesmer');
    expect(decoded.specializations.map((spec) => spec.id)).toEqual([1, 24, 66]);
  });

  it('rejects chat codes that are not build templates', () => {
    // An item chat link, type 0x02.
    expect(() => decodeBuildChatCode('[&AgEBAAAA]')).toThrow(ChatCodeError);
  });
});

describe('referenceBuildFromChatCode', () => {
  it('resolves skill palette ids into real skills', () => {
    const build = referenceBuildFromChatCode(POWER_VIRTUOSO, skills, { name: 'Power Virtuoso' });

    expect(build.heal?.name).toBe('Signet of the Ether');
    expect(build.utilities.map((skill) => skill.name)).toEqual([
      'Rain of Swords',
      'Mantra of Pain',
      'Blink',
    ]);
    expect(build.elite?.name).toBe('Thousand Cuts');
  });

  it('resolves trait positions into named traits', () => {
    const build = referenceBuildFromChatCode(POWER_VIRTUOSO, skills, { name: 'Power Virtuoso' });

    expect(build.specializations.map((spec) => spec.name)).toEqual(['Dueling', 'Illusions', 'Virtuoso']);
    expect(build.eliteSpec).toBe('Virtuoso');
    for (const spec of build.specializations) {
      expect(spec.traits).toHaveLength(3);
      for (const trait of spec.traits) expect(trait.name).toBeTruthy();
    }
  });
});
