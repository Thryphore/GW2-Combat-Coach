import type { ChainPosition, SkillInfo, TraitInfo } from '../../api/gw2.ts';
import type { ConsumableKind } from '../../model/normalize.ts';
import { formatGw2Text } from '../formatGw2Text.ts';
import { useSettings } from '../settings/SettingsContext.tsx';
import { skillSlotLabel } from '../skillKeybind.ts';

function TipRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs leading-snug">
      <span className="shrink-0 text-ink-400">{label}</span>
      <span className="text-right text-ink-200">{value}</span>
    </div>
  );
}

function KeyBadge({ bind }: { bind: string }) {
  return (
    <span className="inline-flex min-w-5 items-center justify-center rounded-md bg-brand-500/15 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-brand-400 ring-1 ring-inset ring-brand-500/35">
      {bind}
    </span>
  );
}

export function SkillTipContent({
  skill,
  keybind,
  chain,
  footnote,
}: {
  skill: SkillInfo;
  /** Override when Utility ordinal is known from the bar. */
  keybind?: string;
  chain?: ChainPosition;
  footnote?: string;
}) {
  const { resolveKeybind } = useSettings();
  const bind = keybind ?? resolveKeybind(skill.slot);
  const slotLabel = skillSlotLabel(skill.slot);
  const description = skill.description ? formatGw2Text(skill.description) : undefined;

  const meta: string[] = [];
  if (skill.weaponType) meta.push(skill.weaponType);
  if (slotLabel) meta.push(slotLabel);
  else if (skill.type) meta.push(skill.type);

  const hasStats =
    skill.rechargeSec !== undefined ||
    !!chain ||
    (skill.categories?.length ?? 0) > 0 ||
    !!skill.comboField ||
    !!skill.comboFinisher;

  return (
    <div className="min-w-48 space-y-2 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          {skill.icon && (
            <img
              src={skill.icon}
              alt=""
              className="mt-0.5 h-8 w-8 shrink-0 rounded-lg ring-1 ring-ink-700"
              loading="lazy"
            />
          )}
          <div className="min-w-0">
            <div className="truncate font-semibold text-white">{skill.name}</div>
            {meta.length > 0 && <div className="mt-0.5 text-[11px] text-ink-400">{meta.join(' · ')}</div>}
          </div>
        </div>
        {bind && <KeyBadge bind={bind} />}
      </div>

      {description && (
        <p className="whitespace-pre-line leading-relaxed text-ink-200">{description}</p>
      )}

      {hasStats && (
        <div className="space-y-1 border-t border-ink-700/80 pt-2">
          {skill.rechargeSec !== undefined && (
            <TipRow label="Recharge" value={`${skill.rechargeSec}s`} />
          )}
          {chain && <TipRow label="Chain" value={`${chain.step}/${chain.length}`} />}
          {skill.categories && skill.categories.length > 0 && (
            <TipRow label="Tags" value={skill.categories.join(', ')} />
          )}
          {skill.comboField && (
            <TipRow
              label="Combo Field"
              value={
                skill.fieldDurationSec
                  ? `${skill.comboField} (${skill.fieldDurationSec}s)`
                  : skill.comboField
              }
            />
          )}
          {skill.comboFinisher && (
            <TipRow
              label="Finisher"
              value={
                skill.finisherPercent
                  ? `${skill.comboFinisher} (${skill.finisherPercent}%)`
                  : skill.comboFinisher
              }
            />
          )}
        </div>
      )}

      {footnote && (
        <p className="border-t border-ink-700/80 pt-2 text-[11px] text-ink-400">{footnote}</p>
      )}
    </div>
  );
}

export function TraitTipContent({
  trait,
  specialization,
  evidence,
}: {
  trait: TraitInfo;
  specialization?: string;
  evidence?: string;
}) {
  const description = trait.description ? formatGw2Text(trait.description) : undefined;
  const meta = [trait.slot, trait.tier !== undefined ? `Tier ${trait.tier}` : undefined, specialization]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="min-w-48 space-y-2 text-xs">
      <div className="flex items-start gap-2">
        {trait.icon && (
          <img
            src={trait.icon}
            alt=""
            className="mt-0.5 h-8 w-8 shrink-0 rounded-lg ring-1 ring-ink-700"
            loading="lazy"
          />
        )}
        <div className="min-w-0">
          <div className="truncate font-semibold text-white">{trait.name}</div>
          {meta && <div className="mt-0.5 text-[11px] text-ink-400">{meta}</div>}
        </div>
      </div>
      {description && (
        <p className="whitespace-pre-line leading-relaxed text-ink-200">{description}</p>
      )}
      {evidence && (
        <p className="border-t border-ink-700/80 pt-2 text-[11px] text-ink-400">
          Detected via {evidence}
        </p>
      )}
    </div>
  );
}

const CONSUMABLE_LABEL: Record<Exclude<ConsumableKind, 'other'>, string> = {
  food: 'Food',
  utility: 'Utility',
};

export function ConsumableTipContent({
  name,
  kind,
  icon,
  durationMs,
}: {
  name: string;
  kind: ConsumableKind;
  icon?: string;
  durationMs: number;
}) {
  const kindLabel = kind === 'other' ? 'Consumable' : CONSUMABLE_LABEL[kind];
  const minutes = Math.round(durationMs / 60_000);

  return (
    <div className="min-w-40 space-y-2 text-xs">
      <div className="flex items-start gap-2">
        {icon && (
          <img
            src={icon}
            alt=""
            className="mt-0.5 h-8 w-8 shrink-0 rounded-lg ring-1 ring-ink-700"
            loading="lazy"
          />
        )}
        <div className="min-w-0">
          <div className="truncate font-semibold text-white">{name}</div>
          <div className="mt-0.5 text-[11px] text-ink-400">{kindLabel}</div>
        </div>
      </div>
      <div className="space-y-1 border-t border-ink-700/80 pt-2">
        {minutes > 0 && <TipRow label="Duration" value={`${minutes}m`} />}
        <TipRow label="Slot" value={kindLabel} />
      </div>
    </div>
  );
}

/** Small keybind pill shown on skill chips for quick scanning. */
export function KeybindChip({ bind }: { bind: string }) {
  const { settings } = useSettings();
  if (!settings.showKeybinds) return null;
  return (
    <span className="ml-0.5 inline-flex min-w-4 items-center justify-center rounded-md bg-brand-500/15 px-1 font-mono text-[10px] font-semibold text-brand-400 ring-1 ring-inset ring-brand-500/30">
      {bind}
    </span>
  );
}

/** Icon + name + optional keybind pill used in the build panel and inline prose. */
export function Gw2NameChip({
  name,
  icon,
  keybind,
  className,
}: {
  name: string;
  icon?: string;
  keybind?: string;
  className?: string;
}) {
  return (
    <span
      className={
        className ??
        'inline-flex cursor-default items-center gap-1.5 rounded-lg bg-ink-800 py-1 pr-2 pl-1 text-xs text-ink-200'
      }
    >
      {icon && <img src={icon} alt="" className="h-5 w-5 rounded" loading="lazy" />}
      {name}
      {keybind && <KeybindChip bind={keybind} />}
    </span>
  );
}
