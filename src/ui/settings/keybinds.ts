/** Combat skill-bar slots that can be remapped in settings. */
export const KEYBIND_SLOTS = [
  'weapon1',
  'weapon2',
  'weapon3',
  'weapon4',
  'weapon5',
  'heal',
  'utility1',
  'utility2',
  'utility3',
  'elite',
  'profession1',
  'profession2',
  'profession3',
  'profession4',
  'profession5',
] as const;

export type KeybindSlot = (typeof KEYBIND_SLOTS)[number];

export type Keybinds = Record<KeybindSlot, string>;

export const DEFAULT_KEYBINDS: Keybinds = {
  weapon1: '1',
  weapon2: '2',
  weapon3: '3',
  weapon4: '4',
  weapon5: '5',
  heal: '6',
  utility1: '7',
  utility2: '8',
  utility3: '9',
  elite: '0',
  profession1: 'F1',
  profession2: 'F2',
  profession3: 'F3',
  profession4: 'F4',
  profession5: 'F5',
};

export const KEYBIND_SLOT_LABELS: Record<KeybindSlot, string> = {
  weapon1: 'Weapon 1',
  weapon2: 'Weapon 2',
  weapon3: 'Weapon 3',
  weapon4: 'Weapon 4',
  weapon5: 'Weapon 5',
  heal: 'Heal',
  utility1: 'Utility 1',
  utility2: 'Utility 2',
  utility3: 'Utility 3',
  elite: 'Elite',
  profession1: 'Profession 1',
  profession2: 'Profession 2',
  profession3: 'Profession 3',
  profession4: 'Profession 4',
  profession5: 'Profession 5',
};

/** Map a GW2 API skill slot (+ optional utility ordinal) to a remappable keybind slot. */
export function toKeybindSlot(slot?: string, utilityIndex?: number): KeybindSlot | undefined {
  if (!slot) return undefined;

  const weapon = /^Weapon_([1-5])$/.exec(slot);
  if (weapon) return `weapon${weapon[1]}` as KeybindSlot;

  if (slot === 'Heal') return 'heal';
  if (slot === 'Elite') return 'elite';

  if (slot === 'Utility') {
    if (utilityIndex === undefined || utilityIndex < 0 || utilityIndex > 2) return undefined;
    return `utility${utilityIndex + 1}` as KeybindSlot;
  }

  const profession = /^Profession_([1-5])$/.exec(slot);
  if (profession) return `profession${profession[1]}` as KeybindSlot;

  return undefined;
}

/** Normalize a keyboard event into a short bind label (e.g. "E", "F2", "`"). */
export function formatKeyEvent(event: KeyboardEvent): string | null {
  if (event.key === 'Escape' || event.key === 'Tab' || event.key === 'Dead') return null;
  if (event.ctrlKey || event.altKey || event.metaKey) return null;

  if (/^F([1-9]|1[0-2])$/i.test(event.key)) return event.key.toUpperCase();

  if (event.key.length === 1) {
    const ch = event.key;
    if (ch === ' ') return 'Space';
    return ch.length === 1 && /[a-z]/.test(ch) ? ch.toUpperCase() : ch;
  }

  if (event.code.startsWith('Digit')) return event.code.slice(5);
  if (event.code.startsWith('Numpad') && event.code.length === 7) return `Num${event.code.slice(6)}`;

  const named: Record<string, string> = {
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    CapsLock: 'Caps',
    ShiftLeft: 'LShift',
    ShiftRight: 'RShift',
  };
  if (event.code in named) return named[event.code];

  if (event.key === 'Shift') return 'Shift';
  return null;
}

export function mergeKeybinds(partial?: Partial<Keybinds> | null): Keybinds {
  const next = { ...DEFAULT_KEYBINDS };
  if (!partial) return next;
  for (const slot of KEYBIND_SLOTS) {
    const value = partial[slot];
    if (typeof value === 'string' && value.trim()) next[slot] = value.trim();
  }
  return next;
}

export function keybindsEqual(a: Keybinds, b: Keybinds): boolean {
  return KEYBIND_SLOTS.every((slot) => a[slot] === b[slot]);
}
