import { useState, type FormEvent } from 'react';
import type { SkillIndex } from '../../api/gw2.ts';
import { metaBattlePageFromInput, type RaidBuildCandidate } from '../../api/metabattle.ts';
import type { BuildSkillRef, BuildTraitRef, InferredBuild, ReferenceBuild } from '../../model/build.ts';
import type { ConsumableKind, NormalizedConsumable } from '../../model/normalize.ts';
import { useResolveKeybind } from '../settings/SettingsContext.tsx';
import { CollapsiblePanel } from './CollapsiblePanel.tsx';
import { ConsumableTipContent, Gw2NameChip, SkillTipContent, TraitTipContent } from './Gw2Tip.tsx';
import { HoverTooltip } from './HoverTooltip.tsx';

function SkillChip({
  skill,
  skills,
  utilities,
}: {
  skill: BuildSkillRef;
  skills?: SkillIndex;
  utilities: BuildSkillRef[];
}) {
  const resolveKeybind = useResolveKeybind();
  const info = skill.id !== undefined ? skills?.skill(skill.id) : skills?.skillByName(skill.name);
  const slot = skill.slot ?? info?.slot;
  let utilityIndex: number | undefined;
  if (slot === 'Utility') {
    const index = utilities.findIndex(
      (entry) => (skill.id !== undefined && entry.id === skill.id) || entry.name === skill.name,
    );
    utilityIndex = index >= 0 ? index : undefined;
  }
  const keybind = resolveKeybind(slot, utilityIndex);
  const chain = skill.id !== undefined ? skills?.chainPosition(skill.id) : undefined;

  const tip =
    info !== undefined ? (
      <SkillTipContent skill={info} keybind={keybind} chain={chain} />
    ) : (
      <SkillTipContent
        skill={{
          id: skill.id ?? 0,
          name: skill.name,
          slot: skill.slot,
          icon: skill.icon,
        }}
        keybind={keybind}
      />
    );

  return (
    <HoverTooltip content={tip}>
      <Gw2NameChip name={skill.name} icon={skill.icon ?? info?.icon} keybind={keybind} />
    </HoverTooltip>
  );
}

function SkillRow({
  label,
  skills,
  skillIndex,
  utilities,
}: {
  label: string;
  skills: BuildSkillRef[];
  skillIndex?: SkillIndex;
  utilities: BuildSkillRef[];
}) {
  if (skills.length === 0) return null;
  return (
    <div>
      <div className="text-xs tracking-wide text-ink-400 uppercase">{label}</div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {skills.map((skill) => (
          <SkillChip
            key={`${skill.id ?? skill.name}`}
            skill={skill}
            skills={skillIndex}
            utilities={utilities}
          />
        ))}
      </div>
    </div>
  );
}

function TraitChip({
  trait,
  skills,
  evidenceLabel,
}: {
  trait: BuildTraitRef;
  skills?: SkillIndex;
  evidenceLabel?: string;
}) {
  const info =
    trait.id !== undefined ? skills?.trait(trait.id) : skills?.traitByName(trait.name);
  const tip = info ? (
    <TraitTipContent
      trait={info}
      specialization={trait.specialization}
      evidence={evidenceLabel}
    />
  ) : (
    <TraitTipContent
      trait={{ id: trait.id ?? 0, name: trait.name, icon: trait.icon, tier: trait.tier }}
      specialization={trait.specialization}
      evidence={evidenceLabel}
    />
  );

  return (
    <HoverTooltip content={tip}>
      <Gw2NameChip name={trait.name} icon={trait.icon ?? info?.icon} />
    </HoverTooltip>
  );
}

const CONSUMABLE_KIND_LABEL: Record<Exclude<ConsumableKind, 'other'>, string> = {
  food: 'Food',
  utility: 'Utility',
};

function ConsumablesRow({ consumables }: { consumables: NormalizedConsumable[] }) {
  const rows = (['food', 'utility'] as const)
    .map((kind) => ({ kind, item: consumables.find((entry) => entry.kind === kind) }))
    .filter((row): row is { kind: 'food' | 'utility'; item: NormalizedConsumable } => !!row.item);

  if (rows.length === 0) return null;

  return (
    <div>
      <div className="text-xs tracking-wide text-ink-400 uppercase">Consumables</div>
      <ul className="mt-1.5 space-y-1.5">
        {rows.map(({ kind, item }) => (
          <li key={kind} className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-ink-300 uppercase">
              {CONSUMABLE_KIND_LABEL[kind]}
            </span>
            <HoverTooltip
              content={
                <ConsumableTipContent
                  name={item.name}
                  kind={item.kind}
                  icon={item.icon}
                  durationMs={item.durationMs}
                />
              }
            >
              <span className="inline-flex cursor-default items-center gap-1.5 rounded-lg bg-ink-800 py-1 pr-2 pl-1 text-xs text-ink-200">
                {item.icon && <img src={item.icon} alt="" className="h-5 w-5 rounded" loading="lazy" />}
                {item.name}
              </span>
            </HoverTooltip>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface Props {
  build?: InferredBuild;
  reference?: ReferenceBuild;
  consumables?: NormalizedConsumable[];
  alternatives?: RaidBuildCandidate[];
  skills?: SkillIndex;
  onSelectAlternative?: (page: string) => void;
}

export function BuildPanel({
  build,
  reference,
  consumables = [],
  alternatives = [],
  skills,
  onSelectAlternative,
}: Props) {
  if (!build && !reference) return null;

  const observedUtilities = build?.utilities ?? [];
  const referenceUtilities = reference?.utilities ?? [];

  return (
    <section className="grid grid-cols-2 items-start gap-4">
      {build && (
        <CollapsiblePanel
          className="min-w-0"
          title="Observed in your log"
          blurb={
            <p className="text-xs text-ink-400">
              {build.profession}
              {build.specializations.length > 0 && ` · ${build.specializations.join(', ')}`}
            </p>
          }
        >
          <div className="space-y-3">
            {build.weaponSets.length > 0 && (
              <div>
                <div className="text-xs tracking-wide text-ink-400 uppercase">Weapons</div>
                <div className="mt-1 text-sm text-ink-200">
                  {build.weaponSets.map((set) => set.join(' + ')).join('  /  ')}
                </div>
              </div>
            )}
            <SkillRow
              label="Weapon skills"
              skills={build.weaponSkills}
              skillIndex={skills}
              utilities={observedUtilities}
            />
            <SkillRow
              label="Profession skills"
              skills={build.professionSkills}
              skillIndex={skills}
              utilities={observedUtilities}
            />
            <SkillRow
              label="Heal / utility / elite"
              skills={[build.heal, ...build.utilities, build.elite].filter(Boolean) as BuildSkillRef[]}
              skillIndex={skills}
              utilities={observedUtilities}
            />
            <ConsumablesRow consumables={consumables} />
            {build.traits.length > 0 && (
              <div>
                <div className="text-xs tracking-wide text-ink-400 uppercase">Traits seen firing</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {build.traits.map((trait) => (
                    <TraitChip
                      key={trait.name}
                      trait={trait}
                      skills={skills}
                      evidenceLabel={trait.evidence.replace('-', ' ')}
                    />
                  ))}
                </div>
              </div>
            )}
            {build.notes.length > 0 && (
              <ul className="space-y-1 text-xs text-ink-400">
                {build.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </div>
        </CollapsiblePanel>
      )}

      {reference && (
        <CollapsiblePanel
          className="min-w-0"
          title="Auto-chosen MetaBattle raid build"
          blurb={
            <>
              <p className="text-xs text-ink-400">
                {reference.name}
                {reference.weapons.length > 0 && ` · ${reference.weapons.join(' / ')}`}
              </p>
              <p className="mt-1 text-xs text-ink-500">
                Picked from MetaBattle&apos;s raid builds for {reference.eliteSpec ?? build?.profession}.
              </p>
            </>
          }
        >
          <div className="space-y-4">
            {reference.url && (
              <a
                href={reference.url}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-sm text-brand-400 hover:underline"
              >
                Open on MetaBattle
              </a>
            )}

            <div className="space-y-3">
              <SkillRow
                label="Weapon skills"
                skills={reference.weaponSkills ?? []}
                skillIndex={skills}
                utilities={referenceUtilities}
              />
              <SkillRow
                label="Profession skills"
                skills={reference.professionSkills ?? []}
                skillIndex={skills}
                utilities={referenceUtilities}
              />
              <SkillRow
                label="Heal / utility / elite"
                skills={
                  [reference.heal, ...reference.utilities, reference.elite].filter(Boolean) as BuildSkillRef[]
                }
                skillIndex={skills}
                utilities={referenceUtilities}
              />
              {reference.specializations.map((spec) => (
                <div key={spec.name}>
                  <div className="text-xs tracking-wide text-ink-400 uppercase">{spec.name}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {spec.traits.map((trait) => (
                      <TraitChip key={trait.name} trait={trait} skills={skills} />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {onSelectAlternative && (
              <ReferenceBuildPicker alternatives={alternatives} onSelect={onSelectAlternative} />
            )}

            {reference.attribution && <p className="text-xs text-ink-400">{reference.attribution}</p>}
          </div>
        </CollapsiblePanel>
      )}
    </section>
  );
}

function ReferenceBuildPicker({
  alternatives,
  onSelect,
}: {
  alternatives: RaidBuildCandidate[];
  onSelect: (page: string) => void;
}) {
  const [linkInput, setLinkInput] = useState('');
  const [linkError, setLinkError] = useState<string | undefined>();

  const onSubmitLink = (event: FormEvent) => {
    event.preventDefault();
    const page = metaBattlePageFromInput(linkInput);
    if (!page) {
      setLinkError('Paste a MetaBattle build URL, like https://metabattle.com/wiki/Build:…');
      return;
    }
    setLinkError(undefined);
    onSelect(page);
  };

  return (
    <div className="space-y-3 border-t border-ink-800 pt-3">
      <div>
        <div className="text-xs tracking-wide text-ink-400 uppercase">Choose a different build</div>
        <p className="mt-1 text-xs text-ink-500">Paste a MetaBattle link, or pick another raid page.</p>
      </div>

      <form onSubmit={onSubmitLink} className="space-y-2">
        <label className="block text-xs tracking-wide text-ink-400 uppercase" htmlFor="metabattle-build-link">
          MetaBattle link
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="metabattle-build-link"
            type="text"
            value={linkInput}
            onChange={(event) => {
              setLinkInput(event.target.value);
              if (linkError) setLinkError(undefined);
            }}
            placeholder="https://metabattle.com/wiki/Build:…"
            className="min-w-0 flex-1 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-200 placeholder:text-ink-600 focus:border-brand-400 focus:outline-none"
          />
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400"
          >
            Use link
          </button>
        </div>
        {linkError && <p className="text-xs text-crit-500">{linkError}</p>}
      </form>

      {alternatives.length > 0 && (
        <div>
          <div className="text-xs tracking-wide text-ink-400 uppercase">Other raid builds</div>
          <ul className="mt-2 space-y-1.5">
            {alternatives.map((candidate) => (
              <li key={candidate.page} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-ink-200">{candidate.variant}</span>
                <button
                  type="button"
                  onClick={() => onSelect(candidate.page)}
                  className="text-xs font-medium text-brand-400 hover:underline"
                >
                  Use this
                </button>
                <a
                  href={`https://metabattle.com/wiki/${encodeURIComponent(candidate.page.replace(/ /g, '_'))}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-ink-500 hover:text-brand-400 hover:underline"
                >
                  MetaBattle
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
