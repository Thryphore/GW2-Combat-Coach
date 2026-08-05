import type { SkillIndex } from '../../api/gw2.ts';
import type { RaidBuildCandidate } from '../../api/metabattle.ts';
import type { BuildSkillRef, BuildTraitRef, InferredBuild, ReferenceBuild } from '../../model/build.ts';
import type { ConsumableKind, NormalizedConsumable } from '../../model/normalize.ts';
import { skillKeybind } from '../skillKeybind.ts';
import { ConsumableTipContent, Gw2NameChip, SkillTipContent, TraitTipContent } from './Gw2Tip.tsx';
import { HoverTooltip } from './HoverTooltip.tsx';

function resolveSkillKeybind(skill: BuildSkillRef, utilities: BuildSkillRef[]): string | undefined {
  if (skill.slot === 'Utility') {
    const index = utilities.findIndex(
      (entry) => (skill.id !== undefined && entry.id === skill.id) || entry.name === skill.name,
    );
    return skillKeybind(skill.slot, index >= 0 ? index : undefined);
  }
  return skillKeybind(skill.slot);
}

function SkillChip({
  skill,
  skills,
  utilities,
}: {
  skill: BuildSkillRef;
  skills?: SkillIndex;
  utilities: BuildSkillRef[];
}) {
  const info = skill.id !== undefined ? skills?.skill(skill.id) : skills?.skillByName(skill.name);
  const keybind = resolveSkillKeybind(
    { ...skill, slot: skill.slot ?? info?.slot },
    utilities,
  );
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
    <section className="grid gap-4 md:grid-cols-2">
      {build && (
        <div className="rounded-2xl border border-ink-700 bg-ink-850/70 p-5">
          <h2 className="text-sm font-semibold tracking-wide text-ink-400 uppercase">Observed in your log</h2>
          <p className="mt-1 text-xs text-ink-400">
            {build.profession}
            {build.specializations.length > 0 && ` · ${build.specializations.join(', ')}`}
          </p>

          <div className="mt-4 space-y-3">
            {build.weaponSets.length > 0 && (
              <div>
                <div className="text-xs tracking-wide text-ink-400 uppercase">Weapons</div>
                <div className="mt-1 text-sm text-ink-200">
                  {build.weaponSets.map((set) => set.join(' + ')).join('  /  ')}
                </div>
              </div>
            )}
            <SkillRow
              label="Skills"
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
          </div>

          {build.notes.length > 0 && (
            <ul className="mt-4 space-y-1 text-xs text-ink-400">
              {build.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {reference && (
        <div className="rounded-2xl border border-ink-700 bg-ink-850/70 p-5">
          <h2 className="text-sm font-semibold tracking-wide text-ink-400 uppercase">
            Auto-chosen MetaBattle raid build
          </h2>
          <p className="mt-1 text-xs text-ink-400">
            {reference.url ? (
              <a href={reference.url} target="_blank" rel="noreferrer" className="text-brand-400 hover:underline">
                {reference.name}
              </a>
            ) : (
              reference.name
            )}
            {reference.weapons.length > 0 && ` · ${reference.weapons.join(' / ')}`}
          </p>
          <p className="mt-1 text-xs text-ink-500">
            Picked from MetaBattle&apos;s raid builds for {reference.eliteSpec ?? build?.profession}. Open-world and
            PvP pages are ignored.
          </p>

          <div className="mt-4 space-y-3">
            <SkillRow
              label="Skills"
              skills={[reference.heal, ...reference.utilities, reference.elite].filter(Boolean) as BuildSkillRef[]}
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

          {alternatives.length > 0 && (
            <div className="mt-4 border-t border-ink-800 pt-3">
              <div className="text-xs tracking-wide text-ink-400 uppercase">Other raid builds</div>
              <p className="mt-1 text-xs text-ink-500">
                If the automatic pick looks wrong, switch to another raid page for this specialization.
              </p>
              <ul className="mt-2 space-y-1.5">
                {alternatives.map((candidate) => (
                  <li key={candidate.page} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-ink-200">{candidate.variant}</span>
                    {onSelectAlternative ? (
                      <button
                        type="button"
                        onClick={() => onSelectAlternative(candidate.page)}
                        className="text-xs font-medium text-brand-400 hover:underline"
                      >
                        Use this
                      </button>
                    ) : null}
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

          {reference.attribution && <p className="mt-4 text-xs text-ink-400">{reference.attribution}</p>}
        </div>
      )}
    </section>
  );
}
