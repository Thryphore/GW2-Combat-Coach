import type { BuildSkillRef, InferredBuild, ReferenceBuild } from '../../model/build.ts';

function SkillChip({ skill }: { skill: BuildSkillRef }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-ink-800 py-1 pr-2 pl-1 text-xs text-ink-200">
      {skill.icon && <img src={skill.icon} alt="" className="h-5 w-5 rounded" loading="lazy" />}
      {skill.name}
    </span>
  );
}

function SkillRow({ label, skills }: { label: string; skills: BuildSkillRef[] }) {
  if (skills.length === 0) return null;
  return (
    <div>
      <div className="text-xs tracking-wide text-ink-400 uppercase">{label}</div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {skills.map((skill) => (
          <SkillChip key={`${skill.id ?? skill.name}`} skill={skill} />
        ))}
      </div>
    </div>
  );
}

interface Props {
  build?: InferredBuild;
  reference?: ReferenceBuild;
}

export function BuildPanel({ build, reference }: Props) {
  if (!build && !reference) return null;

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
            <SkillRow label="Skills" skills={[build.heal, ...build.utilities, build.elite].filter(Boolean) as BuildSkillRef[]} />
            {build.traits.length > 0 && (
              <div>
                <div className="text-xs tracking-wide text-ink-400 uppercase">Traits seen firing</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {build.traits.map((trait) => (
                    <span
                      key={trait.name}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-ink-800 py-1 pr-2 pl-1 text-xs text-ink-200"
                      title={`Detected via ${trait.evidence.replace('-', ' ')}`}
                    >
                      {trait.icon && <img src={trait.icon} alt="" className="h-5 w-5 rounded" loading="lazy" />}
                      {trait.name}
                    </span>
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
          <h2 className="text-sm font-semibold tracking-wide text-ink-400 uppercase">Reference build</h2>
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

          <div className="mt-4 space-y-3">
            <SkillRow
              label="Skills"
              skills={[reference.heal, ...reference.utilities, reference.elite].filter(Boolean) as BuildSkillRef[]}
            />
            {reference.specializations.map((spec) => (
              <div key={spec.name}>
                <div className="text-xs tracking-wide text-ink-400 uppercase">{spec.name}</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {spec.traits.map((trait) => (
                    <span
                      key={trait.name}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-ink-800 py-1 pr-2 pl-1 text-xs text-ink-200"
                    >
                      {trait.icon && <img src={trait.icon} alt="" className="h-5 w-5 rounded" loading="lazy" />}
                      {trait.name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {reference.attribution && <p className="mt-4 text-xs text-ink-400">{reference.attribution}</p>}
        </div>
      )}
    </section>
  );
}
