import { describe, expect, it } from 'vitest';
import mesmerSnapshot from '../data/gw2/mesmer.json';
import { SkillIndex, type ProfessionSnapshot } from './gw2.ts';
import { MetaBattleError, metaBattlePageFromInput, parseMetaBattlePage } from './metabattle.ts';

const skills = new SkillIndex(mesmerSnapshot as unknown as ProfessionSnapshot);

// Trimmed from the real "Build:Virtuoso - Condition Virtuoso" page. Only the
// structured templates matter; the guide prose that follows them is discarded.
const WIKITEXT = `{{Build
| profession = mesmer
| specialization = virtuoso
| designed for = open world, open world general
| focus = condition damage
| rating = great
}}
{{TemplateCode|
code = [&DQcBHRgdQj8jDyMPgQGBAYMBgwHdGoIB5RrtEgAAAAAAAAAAAAAAAAAAAAA=]
}}
{{Skill bar
|profession = mesmer
|specialization = virtuoso
|weapon1 = Dagger
|weapon2 = Sword
|weapon3 = X
|weapon4 = Focus
|healing = Signet of the Ether
|utility1 = Rain of Swords
|utility2 = Signet of Midnight
|utility3 = Signet of Domination
|elite = Thousand Cuts
}}
== Overview ==
Some prose about how to play the build that this app deliberately does not use.`;

describe('parseMetaBattlePage', () => {
  it('reads the build template code and skill bar weapons', () => {
    const parsed = parseMetaBattlePage('Build:Virtuoso - Condition Virtuoso', WIKITEXT, skills);

    expect(parsed.build.name).toBe('Virtuoso - Condition Virtuoso');
    expect(parsed.build.source).toBe('metabattle');
    expect(parsed.url).toContain('metabattle.com/wiki/Build');
    // "X" marks an empty weapon slot.
    expect(parsed.build.weapons).toEqual(['Dagger', 'Sword', 'Focus']);
  });

  it('resolves skills and traits from the template code rather than the prose', () => {
    const parsed = parseMetaBattlePage('Build:Virtuoso - Condition Virtuoso', WIKITEXT, skills);

    expect(parsed.build.heal?.name).toBe('Signet of the Ether');
    // The code stores the in-game slot order, which need not match the order
    // the wiki page happens to list the same skills in.
    expect(parsed.build.utilities.map((skill) => skill.name).sort()).toEqual([
      'Rain of Swords',
      'Signet of Domination',
      'Signet of Midnight',
    ]);
    expect(parsed.build.elite?.name).toBe('Thousand Cuts');
    expect(parsed.build.specializations.map((spec) => spec.name)).toEqual(['Dueling', 'Illusions', 'Virtuoso']);
    expect(parsed.build.attribution).toContain('MetaBattle');
  });

  it('fails clearly when a page publishes no template code', () => {
    expect(() => parseMetaBattlePage('Build:Something', '{{Build|profession = mesmer}}', skills)).toThrow(
      MetaBattleError,
    );
  });
});

describe('metaBattlePageFromInput', () => {
  it('accepts a build page URL', () => {
    expect(metaBattlePageFromInput('https://metabattle.com/wiki/Build:Virtuoso_-_Power_DPS')).toBe(
      'Build:Virtuoso - Power DPS',
    );
  });

  it('accepts a raw page title', () => {
    expect(metaBattlePageFromInput('Build:Virtuoso - Power DPS')).toBe('Build:Virtuoso - Power DPS');
  });

  it('rejects anything else', () => {
    expect(metaBattlePageFromInput('https://snowcrows.com/builds/raids/mesmer')).toBeUndefined();
    expect(metaBattlePageFromInput('just some text')).toBeUndefined();
  });
});
