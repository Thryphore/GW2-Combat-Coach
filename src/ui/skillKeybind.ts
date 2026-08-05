/**
 * Maps GW2 API skill slots to the default keyboard binds used in combat.
 *
 * Weapon_1–5 → 1–5, Heal → 6, Utility → 7–9 (by bar order), Elite → 0,
 * Profession_1–5 → F1–F5.
 */
export function skillKeybind(slot?: string, utilityIndex?: number): string | undefined {
  if (!slot) return undefined;

  const weapon = /^Weapon_([1-5])$/.exec(slot);
  if (weapon) return weapon[1];

  if (slot === 'Heal') return '6';
  if (slot === 'Elite') return '0';

  if (slot === 'Utility') {
    if (utilityIndex === undefined || utilityIndex < 0 || utilityIndex > 2) return undefined;
    return String(7 + utilityIndex);
  }

  const profession = /^Profession_([1-5])$/.exec(slot);
  if (profession) return `F${profession[1]}`;

  return undefined;
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
