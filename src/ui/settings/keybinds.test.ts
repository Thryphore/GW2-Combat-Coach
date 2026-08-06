import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYBINDS,
  formatKeyEvent,
  keybindsEqual,
  mergeKeybinds,
  toKeybindSlot,
} from './keybinds.ts';

describe('toKeybindSlot', () => {
  it('maps API slots onto remappable keys', () => {
    expect(toKeybindSlot('Weapon_4')).toBe('weapon4');
    expect(toKeybindSlot('Heal')).toBe('heal');
    expect(toKeybindSlot('Elite')).toBe('elite');
    expect(toKeybindSlot('Utility', 2)).toBe('utility3');
    expect(toKeybindSlot('Profession_2')).toBe('profession2');
    expect(toKeybindSlot('Utility')).toBeUndefined();
    expect(toKeybindSlot('Toolbelt')).toBeUndefined();
  });
});

describe('mergeKeybinds', () => {
  it('fills missing slots from defaults', () => {
    const merged = mergeKeybinds({ elite: 'E' });
    expect(merged.elite).toBe('E');
    expect(merged.weapon1).toBe('1');
    expect(keybindsEqual(merged, DEFAULT_KEYBINDS)).toBe(false);
    expect(keybindsEqual(mergeKeybinds({}), DEFAULT_KEYBINDS)).toBe(true);
  });
});

describe('formatKeyEvent', () => {
  it('normalizes common rebinds', () => {
    expect(formatKeyEvent({ key: 'e', code: 'KeyE' } as KeyboardEvent)).toBe('E');
    expect(formatKeyEvent({ key: 'F2', code: 'F2' } as KeyboardEvent)).toBe('F2');
    expect(formatKeyEvent({ key: '0', code: 'Digit0' } as KeyboardEvent)).toBe('0');
    expect(formatKeyEvent({ key: '`', code: 'Backquote' } as KeyboardEvent)).toBe('`');
    expect(formatKeyEvent({ key: 'Escape', code: 'Escape' } as KeyboardEvent)).toBeNull();
    expect(
      formatKeyEvent({ key: 'e', code: 'KeyE', ctrlKey: true } as KeyboardEvent),
    ).toBeNull();
  });
});
