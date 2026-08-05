import type { SkillIndex } from '../../api/gw2.ts';
import {
  inferBuild,
  type BuildSkillRef,
  type BuildTraitRef,
  type InferredBuild,
  type ReferenceBuild,
} from '../../model/build.ts';
import type { NormalizedLog, NormalizedPlayer } from '../../model/normalize.ts';
import { count } from '../format.ts';
import type { Check, Finding } from '../types.ts';

const INFERENCE_CAVEAT =
  'Logs never record traits directly. Slotted traits are inferred from the damage modifiers and personal buffs Elite Insights attributes to them, so a trait that simply never triggered during the fight looks missing.';

/**
 * Traits we can actually see in a log: ones Elite Insights exposes as a damage
 * modifier or personal buff on this fight.
 */
export function observableTraitNames(
  log: NormalizedLog,
  player: NormalizedPlayer,
  skills: SkillIndex | undefined,
): Set<string> {
  const names = new Set<string>();
  if (!skills) return names;

  for (const desc of log.damageMods.values()) {
    if (!desc.name) continue;
    if (skills.traitByName(desc.name)) names.add(desc.name);
  }

  for (const buffId of log.personalBuffs[player.profession] ?? []) {
    const buffName = log.buffs.get(buffId)?.name;
    if (!buffName) continue;
    if (skills.traitByName(buffName)) names.add(buffName);
  }

  return names;
}

function referenceBuildSkills(referenceBuild: ReferenceBuild): BuildSkillRef[] {
  return [referenceBuild.heal, ...referenceBuild.utilities, referenceBuild.elite].filter(
    (skill): skill is BuildSkillRef => !!skill,
  );
}

function skillNamesFromInferred(build: InferredBuild): Set<string> {
  return new Set(
    [build.heal?.name, build.elite?.name, ...build.utilities.map((skill) => skill.name)].filter(
      (name): name is string => !!name,
    ),
  );
}

/**
 * Only compare against reference traits that themselves registered in a log.
 * Prefer the reference log when present; otherwise keep MetaBattle traits that
 * are observable in this fight's EI maps.
 */
export function comparableReferenceTraits(args: {
  referenceBuild: ReferenceBuild;
  log: NormalizedLog;
  player: NormalizedPlayer;
  skills?: SkillIndex;
  referenceObserved?: InferredBuild;
}): BuildTraitRef[] {
  const referenceTraits = args.referenceBuild.specializations.flatMap((spec) => spec.traits);

  if (args.referenceObserved) {
    const seenInReference = new Set(args.referenceObserved.traits.map((trait) => trait.name));
    return referenceTraits.filter((trait) => seenInReference.has(trait.name));
  }

  const observable = observableTraitNames(args.log, args.player, args.skills);
  return referenceTraits.filter((trait) => observable.has(trait.name));
}

/**
 * MetaBattle skills to compare. With a reference log, only skills that log
 * actually cast; without one, keep the full MetaBattle skill bar.
 */
export function comparableReferenceSkills(args: {
  referenceBuild: ReferenceBuild;
  referenceObserved?: InferredBuild;
}): BuildSkillRef[] {
  const referenceSkills = referenceBuildSkills(args.referenceBuild);
  if (!args.referenceObserved) return referenceSkills;

  const castInReference = skillNamesFromInferred(args.referenceObserved);
  return referenceSkills.filter((skill) => castInReference.has(skill.name));
}

/**
 * Specializations to compare. Prefer specs that left evidence in the reference
 * log; otherwise only specs that have at least one observable trait here.
 */
export function comparableReferenceSpecializations(args: {
  referenceBuild: ReferenceBuild;
  log: NormalizedLog;
  player: NormalizedPlayer;
  skills?: SkillIndex;
  referenceObserved?: InferredBuild;
}): string[] {
  const referenceSpecs = args.referenceBuild.specializations.map((spec) => spec.name);

  if (args.referenceObserved) {
    const seen = new Set(args.referenceObserved.specializations);
    return referenceSpecs.filter((name) => seen.has(name));
  }

  const observable = observableTraitNames(args.log, args.player, args.skills);
  return referenceSpecs.filter((name) => {
    const spec = args.referenceBuild.specializations.find((entry) => entry.name === name);
    return (spec?.traits ?? []).some((trait) => observable.has(trait.name));
  });
}

/**
 * Weapons to compare. With a reference log, only weapons that log used.
 */
export function comparableReferenceWeapons(args: {
  referenceBuild: ReferenceBuild;
  referenceObserved?: InferredBuild;
}): string[] {
  if (!args.referenceObserved) return args.referenceBuild.weapons;
  const seen = new Set(args.referenceObserved.weaponSets.flat().map((weapon) => weapon.toLowerCase()));
  return args.referenceBuild.weapons.filter((weapon) => seen.has(weapon.toLowerCase()));
}

export const buildMatchCheck: Check = {
  id: 'build-match',
  name: 'Build comparison',
  description: 'Diffs the build observed in your log against an automatically chosen MetaBattle raid build.',

  applicable: ({ build, referenceBuild }) => {
    if (!build) return 'The build could not be inferred from this log.';
    if (!referenceBuild) return 'No MetaBattle raid reference build was available.';
    return undefined;
  },

  run: ({ build, referenceBuild, reference, log, player, skills }) => {
    if (!build || !referenceBuild) return [];

    const findings: Finding[] = [];
    const referenceObserved =
      reference && skills ? inferBuild(reference.log, reference.player, skills) : undefined;
    const comparedAgainst = reference ? 'reference log' : 'reference build';

    const observedTraits = new Set(build.traits.map((trait) => trait.name));
    const traitCandidates = comparableReferenceTraits({
      referenceBuild,
      log,
      player,
      skills,
      referenceObserved,
    });
    const unseenTraits = traitCandidates.filter((trait) => !observedTraits.has(trait.name));

    const observedSpecs = new Set(build.specializations);
    const comparableSpecs = comparableReferenceSpecializations({
      referenceBuild,
      log,
      player,
      skills,
      referenceObserved,
    });
    const missingSpecs = comparableSpecs.filter(
      (name) => observedSpecs.size > 0 && !observedSpecs.has(name),
    );

    if (missingSpecs.length > 0) {
      findings.push({
        id: 'build-match/specializations',
        checkId: 'build-match',
        severity: 'warning',
        title: `Running different specializations than ${referenceBuild.name}`,
        summary: `The ${comparedAgainst} points to ${comparableSpecs.join(', ')}. Nothing in your log points to ${missingSpecs.join(' or ')}, but it does show ${[...observedSpecs].join(', ') || 'no identifiable specialization'}.`,
        detail: 'Swapping a specialization changes the whole priority list, so treat the rotation advice above as approximate until the lines match.',
        caveat: INFERENCE_CAVEAT,
      });
    } else if (unseenTraits.length > 0) {
      findings.push({
        id: 'build-match/traits',
        checkId: 'build-match',
        severity: 'info',
        title: `${count(unseenTraits.length, 'reference trait')} never showed up in your log`,
        summary: `${unseenTraits.map((trait) => trait.name).join(', ')} registered in the ${comparedAgainst} but did not register any damage modifier or personal buff in yours.`,
        detail:
          'Either the trait is not slotted, or it is slotted and its condition never came up. Both are worth a look: a trait that never triggers is not doing anything for you either way.',
        fix: `Compare your trait lines against ${referenceBuild.name} and check whether the conditions on these traits fit how you actually play the fight.`,
        caveat: INFERENCE_CAVEAT,
      });
    } else if (traitCandidates.length > 0) {
      findings.push({
        id: 'build-match/traits',
        checkId: 'build-match',
        severity: 'good',
        title: 'Trait selection matches the reference build',
        summary: reference
          ? `Every ${referenceBuild.name} trait that registered in the reference log also registered in yours.`
          : `Every observable trait from ${referenceBuild.name} triggered at least once in your log.`,
      });
    }

    const observedSkills = skillNamesFromInferred(build);
    const skillCandidates = comparableReferenceSkills({ referenceBuild, referenceObserved });
    const unusedSkills = skillCandidates.filter((skill) => !observedSkills.has(skill.name));

    if (unusedSkills.length > 0) {
      findings.push({
        id: 'build-match/skills',
        checkId: 'build-match',
        severity: 'info',
        title: `${count(unusedSkills.length, 'reference skill')} ${
          unusedSkills.length === 1 ? 'was' : 'were'
        } never cast`,
        summary: `${unusedSkills.map((skill) => skill.name).join(', ')} ${
          unusedSkills.length === 1 ? 'was' : 'were'
        } used in the ${comparedAgainst} but not in your rotation.`,
        detail:
          'A skill you never press is either not slotted or being forgotten. If it is slotted, it is occupying a slot for free.',
        fix: 'Either work the skill into your priority or replace it with something you will actually use.',
        caveat: 'Utility skills that are slotted but never cast are invisible to a log.',
      });
    } else if (skillCandidates.length > 0 && referenceObserved) {
      findings.push({
        id: 'build-match/skills',
        checkId: 'build-match',
        severity: 'good',
        title: 'Skill usage matches the reference log',
        summary: `Every ${referenceBuild.name} skill that the reference cast also appeared in your rotation.`,
      });
    }

    const observedWeapons = new Set(build.weaponSets.flat().map((weapon) => weapon.toLowerCase()));
    const weaponCandidates = comparableReferenceWeapons({ referenceBuild, referenceObserved });
    const missingWeapons = weaponCandidates.filter(
      (weapon) => !observedWeapons.has(weapon.toLowerCase()),
    );
    if (missingWeapons.length > 0 && observedWeapons.size > 0) {
      findings.push({
        id: 'build-match/weapons',
        checkId: 'build-match',
        severity: 'info',
        title: 'Different weapons than the reference build',
        summary: `The ${comparedAgainst} used ${weaponCandidates.join(' / ')}; this log shows ${build.weaponSets.map((set) => set.join(' + ')).join(' and ') || 'no detected weapons'}.`,
        fix: 'Weapon choice changes the skill priority substantially, so make sure the rotation you are following matches the weapons you brought.',
      });
    }

    return findings;
  },
};
