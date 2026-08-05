import { describe, expect, it } from 'vitest';
import {
  classifyDamageModifierSource,
  consumableKindFromBuff,
  formatDamageModifierName,
  normalizeConsumables,
  resolveEiIcon,
} from './normalize.ts';

describe('resolveEiIcon', () => {
  it('rewrites Wingman cache paths to render.guildwars2.com', () => {
    expect(
      resolveEiIcon(
        '/cache/https_render.guildwars2.com_file_0B09BA2F77DD6B686D7DD2F700975E4B0CAF4C1D_1201888.png',
      ),
    ).toBe('https://render.guildwars2.com/file/0B09BA2F77DD6B686D7DD2F700975E4B0CAF4C1D/1201888.png');
  });

  it('keeps absolute URLs', () => {
    expect(resolveEiIcon('https://render.guildwars2.com/file/abc/1.png')).toBe(
      'https://render.guildwars2.com/file/abc/1.png',
    );
  });
});

describe('consumableKindFromBuff', () => {
  it('maps EI classifications and HTML uniqueSlot values', () => {
    expect(consumableKindFromBuff({ classification: 'Nourishment' })).toBe('food');
    expect(consumableKindFromBuff({ classification: 'Enhancement' })).toBe('utility');
    expect(consumableKindFromBuff(undefined, 1)).toBe('food');
    expect(consumableKindFromBuff(undefined, 2)).toBe('utility');
    expect(consumableKindFromBuff({ classification: 'Other Consumable' }, 0)).toBe('other');
  });
});

describe('classifyDamageModifierSource', () => {
  const buffs = new Map([
    [33836, { name: 'Writ of Masterful Malice', classification: 'Enhancement' }],
    [57409, { name: 'Cilantro and Cured Meat Flatbread', classification: 'Nourishment' }],
  ]);

  it('names food, utility, relic, sigil, rune, trait and skill sources', () => {
    expect(classifyDamageModifierSource('Writ of Masterful Malice', { buffs })).toBe('utility');
    expect(classifyDamageModifierSource('Cilantro and Cured Meat Flatbread', { buffs })).toBe('food');
    expect(classifyDamageModifierSource('Relic of Fireworks')).toBe('relic');
    expect(classifyDamageModifierSource('Impact Sigil')).toBe('sigil');
    expect(classifyDamageModifierSource('Scholar Rune')).toBe('rune');
    expect(classifyDamageModifierSource('Moving Bonus')).toBe('food');
    expect(
      classifyDamageModifierSource('Mental Focus', { personalIds: new Set([23]), modId: 23 }),
    ).toBe('trait');
    expect(classifyDamageModifierSource('One Wolf Pack', { skillBased: true })).toBe('skill');
  });

  it('formats UI labels with the source first', () => {
    expect(formatDamageModifierName({ name: 'Writ of Masterful Malice', source: 'utility' })).toBe(
      'Utility · Writ of Masterful Malice',
    );
  });
});

describe('normalizeConsumables', () => {
  const buffs = new Map([
    [57409, { name: 'Cilantro and Cured Meat Flatbread', classification: 'Nourishment' }],
    [33836, { name: 'Writ of Masterful Malice', classification: 'Enhancement' }],
    [9283, { name: 'Reinforced Armor', classification: 'Other Consumable' }],
    [46587, { name: 'Malnourished', classification: 'Other Consumable' }],
  ]);

  it('keeps one food and one utility active at fight start', () => {
    expect(
      normalizeConsumables(
        [
          { id: 57409, time: -5, duration: 1_800_000, uniqueSlot: 1 },
          { id: 33836, time: -4, duration: 1_800_000, uniqueSlot: 2 },
          { id: 9283, time: -3, duration: 1_800_000, uniqueSlot: 0 },
          { id: 46587, time: 10_000, duration: 300_000, uniqueSlot: 0 },
        ],
        buffs,
      ),
    ).toEqual([
      expect.objectContaining({ kind: 'food', name: 'Cilantro and Cured Meat Flatbread' }),
      expect.objectContaining({ kind: 'utility', name: 'Writ of Masterful Malice' }),
      expect.objectContaining({ kind: 'other', name: 'Reinforced Armor' }),
    ]);
  });

  it('skips Malnourished and mid-fight-only refreshes', () => {
    expect(
      normalizeConsumables(
        [
          { id: 46587, time: -5, duration: 300_000, uniqueSlot: 0 },
          { id: 33836, time: 20_000, duration: 1_800_000, uniqueSlot: 2 },
        ],
        buffs,
      ),
    ).toEqual([]);
  });
});
