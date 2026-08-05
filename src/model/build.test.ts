import { describe, expect, it } from 'vitest';
import { SkillIndex, type ProfessionSnapshot } from '../api/gw2.ts';
import mesmerSnapshot from '../data/gw2/mesmer.json';
import { seedSkillsFromLog, weaponSkillsFromWeapons } from './build.ts';
import type { NormalizedLog } from './normalize.ts';

const skills = new SkillIndex(mesmerSnapshot as unknown as ProfessionSnapshot);

describe('weaponSkillsFromWeapons', () => {
  it('resolves sword + focus into slots 1–5 with keybindable refs', () => {
    const refs = weaponSkillsFromWeapons(['Sword', 'Focus'], skills);
    expect(refs.map((skill) => skill.slot)).toEqual([
      'Weapon_1',
      'Weapon_2',
      'Weapon_3',
      'Weapon_4',
      'Weapon_5',
    ]);
    expect(refs[0]?.name).toBe('Mind Slash');
    // Focus overwrites sword's native 4/5.
    expect(refs[3]?.name).toBe('Temporal Curtain');
    expect(refs[4]?.name).toBe('Phantasmal Warden');
  });
});

describe('seedSkillsFromLog', () => {
  it('adds EI-only skills so name linking can chip them', () => {
    const index = SkillIndex.empty('Mesmer');
    const log = {
      skills: new Map([
        [999001, { name: 'Relic Proc', icon: 'https://render.guildwars2.com/file/abc/1.png' }],
      ]),
    } as unknown as NormalizedLog;

    seedSkillsFromLog(index, log);
    expect(index.skill(999001)?.name).toBe('Relic Proc');
    expect(index.skillByName('Relic Proc')?.icon).toContain('render.guildwars2.com');
  });
});
