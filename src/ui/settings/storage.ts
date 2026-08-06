import { DEFAULT_KEYBINDS, mergeKeybinds, type Keybinds } from './keybinds.ts';

const STORAGE_KEY = 'gw2-combat-coach:settings';

export interface AppSettings {
  keybinds: Keybinds;
  /** When false, keybind pills are hidden on skill chips (tooltips still show them). */
  showKeybinds: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  keybinds: DEFAULT_KEYBINDS,
  showKeybinds: true,
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS, keybinds: { ...DEFAULT_KEYBINDS } };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      keybinds: mergeKeybinds(parsed.keybinds),
      showKeybinds: typeof parsed.showKeybinds === 'boolean' ? parsed.showKeybinds : true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS, keybinds: { ...DEFAULT_KEYBINDS } };
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Quota / private mode — ignore; in-session settings still work.
  }
}
