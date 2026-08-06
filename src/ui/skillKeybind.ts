import { DEFAULT_KEYBINDS, toKeybindSlot, type Keybinds } from './settings/keybinds.ts';

/**
 * Maps GW2 API skill slots to keyboard binds used in combat.
 *
 * Defaults: Weapon_1–5 → 1–5, Heal → 6, Utility → 7–9 (by bar order), Elite → 0,
 * Profession_1–5 → F1–F5. Pass custom `keybinds` to honor user remaps from settings.
 */
export function skillKeybind(
  slot?: string,
  utilityIndex?: number,
  keybinds: Keybinds = DEFAULT_KEYBINDS,
): string | undefined {
  const key = toKeybindSlot(slot, utilityIndex);
  if (!key) return undefined;
  return keybinds[key];
}

/** Human-readable slot label for tooltips, e.g. "Weapon 3" or "Profession". */
export function skillSlotLabel(slot?: string): string | undefined {
  if (!slot) return undefined;
  const weapon = /^Weapon_([1-5])$/.exec(slot);
  if (weapon) return `Weapon ${weapon[1]}`;
  if (slot === 'Heal') return 'Heal';
  if (slot === 'Utility') return 'Utility';
  if (slot === 'Elite') return 'Elite';
  const profession = /^Profession_([1-5])$/.exec(slot);
  if (profession) return `Profession ${profession[1]}`;
  if (slot.startsWith('Downed_')) return 'Downed';
  if (slot === 'Toolbelt') return 'Toolbelt';
  return slot.replace(/_/g, ' ');
}
