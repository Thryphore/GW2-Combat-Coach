import { describe, expect, it } from 'vitest';
import { skillKeybind, skillSlotLabel } from './skillKeybind.ts';

describe('skillKeybind', () => {
  it('maps weapon, heal, elite, and profession slots', () => {
    expect(skillKeybind('Weapon_1')).toBe('1');
    expect(skillKeybind('Weapon_3')).toBe('3');
    expect(skillKeybind('Weapon_5')).toBe('5');
    expect(skillKeybind('Heal')).toBe('6');
    expect(skillKeybind('Elite')).toBe('0');
    expect(skillKeybind('Profession_1')).toBe('F1');
    expect(skillKeybind('Profession_5')).toBe('F5');
  });

  it('maps utility slots by bar order', () => {
    expect(skillKeybind('Utility', 0)).toBe('7');
    expect(skillKeybind('Utility', 1)).toBe('8');
    expect(skillKeybind('Utility', 2)).toBe('9');
    expect(skillKeybind('Utility')).toBeUndefined();
  });

  it('ignores unknown slots', () => {
    expect(skillKeybind('Toolbelt')).toBeUndefined();
    expect(skillKeybind(undefined)).toBeUndefined();
  });
});

describe('skillSlotLabel', () => {
  it('formats common slots', () => {
    expect(skillSlotLabel('Weapon_2')).toBe('Weapon 2');
    expect(skillSlotLabel('Profession_3')).toBe('Profession 3');
    expect(skillSlotLabel('Heal')).toBe('Heal');
  });
});
