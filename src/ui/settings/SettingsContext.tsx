import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { skillKeybind } from '../skillKeybind.ts';
import {
  DEFAULT_KEYBINDS,
  keybindsEqual,
  type KeybindSlot,
  type Keybinds,
} from './keybinds.ts';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type AppSettings } from './storage.ts';

interface SettingsContextValue {
  settings: AppSettings;
  setKeybind: (slot: KeybindSlot, bind: string) => void;
  resetKeybinds: () => void;
  setShowKeybinds: (show: boolean) => void;
  keybindsAreDefault: boolean;
  /** Resolve a skill slot to the user's current keybind. */
  resolveKeybind: (slot?: string, utilityIndex?: number) => string | undefined;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  setKeybind: () => {},
  resetKeybinds: () => {},
  setShowKeybinds: () => {},
  keybindsAreDefault: true,
  resolveKeybind: (slot, utilityIndex) => skillKeybind(slot, utilityIndex),
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  const commit = useCallback((updater: (prev: AppSettings) => AppSettings) => {
    setSettings((prev) => {
      const next = updater(prev);
      saveSettings(next);
      return next;
    });
  }, []);

  const setKeybind = useCallback(
    (slot: KeybindSlot, bind: string) => {
      commit((prev) => ({
        ...prev,
        keybinds: { ...prev.keybinds, [slot]: bind },
      }));
    },
    [commit],
  );

  const resetKeybinds = useCallback(() => {
    commit((prev) => ({ ...prev, keybinds: { ...DEFAULT_KEYBINDS } }));
  }, [commit]);

  const setShowKeybinds = useCallback(
    (show: boolean) => {
      commit((prev) => ({ ...prev, showKeybinds: show }));
    },
    [commit],
  );

  const resolveKeybind = useCallback(
    (slot?: string, utilityIndex?: number) => skillKeybind(slot, utilityIndex, settings.keybinds),
    [settings.keybinds],
  );

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      setKeybind,
      resetKeybinds,
      setShowKeybinds,
      keybindsAreDefault: keybindsEqual(settings.keybinds, DEFAULT_KEYBINDS),
      resolveKeybind,
    }),
    [settings, setKeybind, resetKeybinds, setShowKeybinds, resolveKeybind],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}

export function useResolveKeybind(): SettingsContextValue['resolveKeybind'] {
  return useSettings().resolveKeybind;
}

export type { Keybinds, KeybindSlot };
