import { findBuffId } from '../../../model/normalize.ts';
import type { NormalizedCast } from '../../../model/normalize.ts';
import { count, timestamp } from '../../format.ts';
import type { Check, Finding } from '../../types.ts';

const SIGNET_OF_THE_ETHER = 'Signet of the Ether';
/** Skills that Mind the Gap's Clarity is meant to empower. */
const CLARITY_PAYOFFS = /^(Mental Collapse|Phantasmal .+)$/i;

export const phantasmCheck: Check = {
  id: 'virtuoso/phantasms',
  name: 'Phantasms and Clarity',
  description:
    'Checks that phantasm skills are kept rolling, that Signet of the Ether is used to reset them, and that Clarity is consumed.',
  professions: ['Virtuoso'],

  applicable: ({ skills }) => (skills ? undefined : 'No GW2 skill data is available for this profession yet.'),

  run: ({ log, player, window, skills }) => {
    if (!skills) return [];

    const findings: Finding[] = [];

    const phantasmCasts = player.casts.filter((cast) => {
      const skill = skills.skill(cast.skillId);
      if (!skill) return false;
      // The API's Phantasm category is incomplete: Phantasmal Lancer, for one,
      // is uncategorized, so fall back to the naming convention.
      return skill.categories?.includes('Phantasm') === true || /^Phantasmal /.test(skill.name);
    });

    const signet = skills.skillByName(SIGNET_OF_THE_ETHER);
    const signetCasts = signet ? player.casts.filter((cast) => cast.skillId === signet.id) : [];

    if (signetCasts.length > 0 && phantasmCasts.length > 0) {
      const wasted = signetCasts.filter((signetCast) => onCooldownAt(phantasmCasts, signetCast, skills) === 0);
      if (wasted.length > 0) {
        findings.push({
          id: 'virtuoso/phantasms/signet',
          checkId: 'virtuoso/phantasms',
          severity: wasted.length === signetCasts.length ? 'warning' : 'info',
          title: `${count(wasted.length, 'Signet of the Ether cast')} reset nothing`,
          summary: `Signet of the Ether recharges your phantasm skills, but on ${wasted.length} of ${signetCasts.length} casts every phantasm was already available.`,
          fix: 'Cast your phantasm skills first, then use the signet to get another round of them. Using it while they are up spends the active for healing alone.',
          caveat:
            'Cooldown state is estimated from cast times and base recharge, so a phantasm reset by something else may be misjudged.',
          evidence: wasted.slice(0, 5).map((cast) => ({
            time: cast.time,
            label: `Signet of the Ether at ${timestamp(cast.time)} with no phantasms on cooldown`,
          })),
          impact: 3,
        });
      } else {
        findings.push({
          id: 'virtuoso/phantasms/signet',
          checkId: 'virtuoso/phantasms',
          severity: 'good',
          title: 'Signet of the Ether was used to reset phantasms',
          summary: `All ${signetCasts.length} casts landed while at least one phantasm skill was recharging.`,
        });
      }
    }

    const clarityId = findBuffId(log, 'Clarity');
    const clarity = clarityId === undefined ? undefined : player.buffs.get(clarityId);
    if (clarity && clarity.uptimeMs(window) > 0) {
      const windows = clarity.activeWindows(window);
      const unusedWindows = windows.filter(
        (w) => !player.casts.some((cast) => cast.time >= w.start && cast.time <= w.end && CLARITY_PAYOFFS.test(cast.name)),
      );

      if (unusedWindows.length > 0 && windows.length > 0) {
        const ratio = unusedWindows.length / windows.length;
        findings.push({
          id: 'virtuoso/phantasms/clarity',
          checkId: 'virtuoso/phantasms',
          severity: ratio > 0.5 ? 'warning' : 'info',
          title: `Clarity expired unused ${count(unusedWindows.length, 'time')}`,
          summary: `Mind the Gap gave you Clarity ${windows.length} times and ${unusedWindows.length} of those windows closed without an empowered skill.`,
          detail:
            'Clarity upgrades your next qualifying skill, so letting it time out is a straight loss of the trait\'s value.',
          fix: 'When Clarity comes up, spend it on the empowered cast before it falls off rather than continuing the normal priority.',
          evidence: unusedWindows.slice(0, 5).map((w) => ({
            time: w.start,
            label: `Clarity from ${timestamp(w.start)} to ${timestamp(w.end)} went unspent`,
          })),
          impact: Math.min(6, ratio * 8),
        });
      }
    }

    if (phantasmCasts.length === 0) {
      findings.push({
        id: 'virtuoso/phantasms/none',
        checkId: 'virtuoso/phantasms',
        severity: 'info',
        title: 'No phantasm skills were cast',
        summary:
          'Phantasms are a large share of Virtuoso damage and your main Blade generation outside of dagger. Running none is unusual outside of very short fights.',
      });
    }

    return findings;
  },
};

/** Counts phantasm skills that were still recharging at the moment of `at`. */
function onCooldownAt(
  phantasmCasts: NormalizedCast[],
  at: NormalizedCast,
  skills: NonNullable<Parameters<NonNullable<Check['run']>>[0]['skills']>,
): number {
  const lastCastBySkill = new Map<number, NormalizedCast>();
  for (const cast of phantasmCasts) {
    if (cast.time > at.time) break;
    lastCastBySkill.set(cast.skillId, cast);
  }

  let recharging = 0;
  for (const [skillId, cast] of lastCastBySkill) {
    const recharge = skills.skill(skillId)?.rechargeSec;
    if (!recharge) continue;
    if (cast.time + recharge * 1000 > at.time) recharging += 1;
  }
  return recharging;
}
