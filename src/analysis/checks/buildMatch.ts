import type { BuildTraitRef } from '../../model/build.ts';
import { count } from '../format.ts';
import type { Check, Finding } from '../types.ts';

const INFERENCE_CAVEAT =
  'Logs never record traits directly. Slotted traits are inferred from the damage modifiers and personal buffs Elite Insights attributes to them, so a trait that simply never triggered during the fight looks missing.';

export const buildMatchCheck: Check = {
  id: 'build-match',
  name: 'Build comparison',
  description: 'Diffs the build observed in your log against the reference build you selected.',

  applicable: ({ build, referenceBuild }) => {
    if (!build) return 'The build could not be inferred from this log.';
    if (!referenceBuild) return 'No reference build was selected.';
    return undefined;
  },

  run: ({ build, referenceBuild }) => {
    if (!build || !referenceBuild) return [];

    const findings: Finding[] = [];

    const observedTraits = new Set(build.traits.map((trait) => trait.name));
    const referenceTraits: BuildTraitRef[] = referenceBuild.specializations.flatMap((spec) => spec.traits);
    const unseen = referenceTraits.filter((trait) => !observedTraits.has(trait.name));

    const observedSpecs = new Set(build.specializations);
    const referenceSpecs = referenceBuild.specializations.map((spec) => spec.name);
    const missingSpecs = referenceSpecs.filter(
      (name) => observedSpecs.size > 0 && !observedSpecs.has(name),
    );

    if (missingSpecs.length > 0) {
      findings.push({
        id: 'build-match/specializations',
        checkId: 'build-match',
        severity: 'warning',
        title: `Running different specializations than ${referenceBuild.name}`,
        summary: `The reference build uses ${referenceSpecs.join(', ')}. Nothing in your log points to ${missingSpecs.join(' or ')}, but it does show ${[...observedSpecs].join(', ') || 'no identifiable specialization'}.`,
        detail: 'Swapping a specialization changes the whole priority list, so treat the rotation advice above as approximate until the lines match.',
        caveat: INFERENCE_CAVEAT,
      });
    } else if (unseen.length > 0) {
      findings.push({
        id: 'build-match/traits',
        checkId: 'build-match',
        severity: 'info',
        title: `${count(unseen.length, 'reference trait')} never showed up in your log`,
        summary: `${unseen.map((trait) => trait.name).join(', ')} did not register any damage modifier or personal buff.`,
        detail:
          'Either the trait is not slotted, or it is slotted and its condition never came up. Both are worth a look: a trait that never triggers is not doing anything for you either way.',
        fix: `Compare your trait lines against ${referenceBuild.name} and check whether the conditions on these traits fit how you actually play the fight.`,
        caveat: INFERENCE_CAVEAT,
      });
    } else if (referenceTraits.length > 0) {
      findings.push({
        id: 'build-match/traits',
        checkId: 'build-match',
        severity: 'good',
        title: 'Trait selection matches the reference build',
        summary: `Every trait in ${referenceBuild.name} triggered at least once in your log.`,
      });
    }

    const observedSkills = new Set(
      [build.heal?.name, build.elite?.name, ...build.utilities.map((skill) => skill.name)].filter(
        (name): name is string => !!name,
      ),
    );
    const referenceSkills = [
      referenceBuild.heal,
      ...referenceBuild.utilities,
      referenceBuild.elite,
    ].filter((skill): skill is NonNullable<typeof skill> => !!skill);
    const unusedSkills = referenceSkills.filter((skill) => !observedSkills.has(skill.name));

    if (unusedSkills.length > 0) {
      findings.push({
        id: 'build-match/skills',
        checkId: 'build-match',
        severity: 'info',
        title: `${count(unusedSkills.length, 'reference skill')} was never cast`,
        summary: `${unusedSkills.map((skill) => skill.name).join(', ')} appears in ${referenceBuild.name} but not in your rotation.`,
        detail:
          'A skill you never press is either not slotted or being forgotten. If it is slotted, it is occupying a slot for free.',
        fix: 'Either work the skill into your priority or replace it with something you will actually use.',
        caveat: 'Utility skills that are slotted but never cast are invisible to a log.',
      });
    }

    const observedWeapons = new Set(build.weaponSets.flat().map((weapon) => weapon.toLowerCase()));
    const missingWeapons = referenceBuild.weapons.filter(
      (weapon) => !observedWeapons.has(weapon.toLowerCase()),
    );
    if (missingWeapons.length > 0 && observedWeapons.size > 0) {
      findings.push({
        id: 'build-match/weapons',
        checkId: 'build-match',
        severity: 'info',
        title: 'Different weapons than the reference build',
        summary: `${referenceBuild.name} runs ${referenceBuild.weapons.join(' / ')}; this log shows ${build.weaponSets.map((set) => set.join(' + ')).join(' and ') || 'no detected weapons'}.`,
        fix: 'Weapon choice changes the skill priority substantially, so make sure the rotation you are following matches the weapons you brought.',
      });
    }

    return findings;
  },
};
