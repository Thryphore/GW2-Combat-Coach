import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  formatKeyEvent,
  KEYBIND_SLOT_LABELS,
  type KeybindSlot,
  type Keybinds,
} from './keybinds.ts';
import { useSettings } from './SettingsContext.tsx';

interface Props {
  open: boolean;
  onClose: () => void;
}

const WEAPON_SLOTS: KeybindSlot[] = ['weapon1', 'weapon2', 'weapon3', 'weapon4', 'weapon5'];
const UTILITY_SLOTS: KeybindSlot[] = ['heal', 'utility1', 'utility2', 'utility3', 'elite'];
const PROFESSION_SLOTS: KeybindSlot[] = [
  'profession1',
  'profession2',
  'profession3',
  'profession4',
  'profession5',
];

function duplicateSlots(keybinds: Keybinds, slot: KeybindSlot): KeybindSlot[] {
  const bind = keybinds[slot];
  return (Object.keys(keybinds) as KeybindSlot[]).filter(
    (other) => other !== slot && keybinds[other] === bind,
  );
}

function SkillSlotButton({
  slot,
  bind,
  size,
  listening,
  duplicate,
  onSelect,
}: {
  slot: KeybindSlot;
  bind: string;
  size: 'sm' | 'md';
  listening: boolean;
  duplicate: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={`${KEYBIND_SLOT_LABELS[slot]} — click, then press a key`}
      aria-label={`${KEYBIND_SLOT_LABELS[slot]}, currently ${bind}. Click to rebind.`}
      aria-pressed={listening}
      className={[
        'relative flex aspect-square w-full items-center justify-center rounded-md border font-mono font-semibold transition',
        size === 'sm' ? 'text-[10px]' : 'text-xs sm:text-sm',
        listening
          ? 'border-brand-400 bg-brand-500/20 text-white ring-2 ring-brand-400/60'
          : duplicate
            ? 'border-warn-500/70 bg-ink-900 text-warn-500 hover:border-warn-500'
            : 'border-ink-600 bg-gradient-to-b from-ink-800 to-ink-900 text-amber-300 hover:border-ink-400 hover:text-amber-200',
      ].join(' ')}
    >
      {listening ? '…' : bind}
    </button>
  );
}

function SkillBar({
  keybinds,
  listening,
  onSelect,
}: {
  keybinds: Keybinds;
  listening: KeybindSlot | null;
  onSelect: (slot: KeybindSlot) => void;
}) {
  const slotProps = (slot: KeybindSlot, size: 'sm' | 'md') => ({
    slot,
    bind: keybinds[slot],
    size,
    listening: listening === slot,
    duplicate: duplicateSlots(keybinds, slot).length > 0,
    onSelect: () => onSelect(slot),
  });

  return (
    <div className="flex w-full items-end gap-3 sm:gap-4">
      {/* Left: F-skills above weapon 1–5 */}
      <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
        <div className="grid w-[72%] grid-cols-5 gap-1">
          {PROFESSION_SLOTS.map((slot) => (
            <SkillSlotButton key={slot} {...slotProps(slot, 'sm')} />
          ))}
        </div>
        <div className="grid w-full grid-cols-5 gap-1.5">
          {WEAPON_SLOTS.map((slot) => (
            <SkillSlotButton key={slot} {...slotProps(slot, 'md')} />
          ))}
        </div>
      </div>

      {/* Right: heal / utilities / elite on the same row */}
      <div className="grid min-w-0 flex-1 grid-cols-5 gap-1.5">
        {UTILITY_SLOTS.map((slot) => (
          <SkillSlotButton key={slot} {...slotProps(slot, 'md')} />
        ))}
      </div>
    </div>
  );
}

export function SettingsModal({ open, onClose }: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const {
    settings,
    setKeybind,
    resetKeybinds,
    setShowKeybinds,
    keybindsAreDefault,
  } = useSettings();
  const [listening, setListening] = useState<KeybindSlot | null>(null);

  useEffect(() => {
    if (!open) setListening(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (listening) {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Escape') {
          setListening(null);
          return;
        }
        const bind = formatKeyEvent(event);
        if (!bind) return;
        setKeybind(listening, bind);
        setListening(null);
        return;
      }

      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, listening, setKeybind, onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  const listeningLabel = listening ? KEYBIND_SLOT_LABELS[listening] : null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/70 px-4 py-10 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          if (listening) setListening(null);
          else onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-xl rounded-2xl border border-ink-700 bg-ink-850 p-5 shadow-2xl shadow-black/40 outline-none sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-white">
              Settings
            </h2>
            <p className="mt-1 text-sm text-ink-400">
              Customize how skill keybinds are shown across the coach.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-ink-400 hover:bg-ink-800 hover:text-white"
            aria-label="Close settings"
          >
            Esc
          </button>
        </div>

        <section className="mt-6">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold tracking-wide text-ink-400 uppercase">
              Skill keybinds
            </h3>
            <button
              type="button"
              onClick={resetKeybinds}
              disabled={keybindsAreDefault}
              className="text-xs font-medium text-brand-400 hover:underline disabled:cursor-default disabled:text-ink-600 disabled:no-underline"
            >
              Reset defaults
            </button>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-ink-400">
            Click a slot, then press the key you use in game. Remaps update every skill badge and
            tooltip (handy if elite is on E, or weapon skills are rebound).
          </p>

          <div className="mt-4 rounded-xl border border-ink-700 bg-ink-900/60 px-3 py-5 sm:px-5">
            <SkillBar
              keybinds={settings.keybinds}
              listening={listening}
              onSelect={(slot) => setListening((current) => (current === slot ? null : slot))}
            />
            <p className="mt-4 text-center text-xs text-ink-400">
              {listeningLabel
                ? `Press a key for ${listeningLabel} (Esc to cancel)`
                : 'Weapon skills · Heal / utilities / elite · F-skills above'}
            </p>
          </div>
        </section>

        <section className="mt-6 border-t border-ink-800 pt-5">
          <h3 className="text-sm font-semibold tracking-wide text-ink-400 uppercase">Display</h3>
          <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-ink-700 bg-ink-900/40 px-4 py-3 hover:border-ink-600">
            <input
              type="checkbox"
              checked={settings.showKeybinds}
              onChange={(event) => setShowKeybinds(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-ink-600 bg-ink-900 text-brand-500 focus:ring-brand-400"
            />
            <span>
              <span className="block text-sm font-medium text-ink-200">Show keybind badges</span>
              <span className="mt-0.5 block text-xs text-ink-400">
                Amber key pills next to skill names. Tooltips still include the bind when this is off.
              </span>
            </span>
          </label>
        </section>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
