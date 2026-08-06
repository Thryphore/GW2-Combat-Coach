import {
  damageModifierSourceLabel,
  findBuffId,
  formatDamageModifierName,
  type DamageModifierSource,
  type NormalizedPlayer,
} from '../model/normalize.ts';
import { boonsForRole } from './boonRole.ts';
import { measureAutoAttackChains } from './checks/autoAttackChain.ts';
import { measureCancelledCasts } from './checks/wastedCasts.ts';
import { compactNumber, count, duration, percent } from './format.ts';
import type { Check, Finding, Metric, Severity } from './types.ts';

/** Ignore skills that differ by less than this many casts per minute. */
const MIN_RATE_DELTA = 0.75;

/** Aborted-cast waste-share gap treated as in line. */
const WASTE_SHARE_SIMILAR = 0.005;
/** Aborted-cast waste-share gap that becomes a warning. */
const WASTE_SHARE_WARNING = 0.015;

/** Chain completion points below the reference treated as in line. */
const CHAIN_RATE_SIMILAR = 0.05;
/** Chain completion points below the reference that become a warning. */
const CHAIN_RATE_WARNING = 0.15;

interface CastRate {
  name: string;
  perMinute: number;
}

function castRates(player: NormalizedPlayer): Map<string, CastRate> {
  const minutes = Math.max(0.1, player.activeTimeMs / 60000);
  const rates = new Map<string, CastRate>();
  for (const cast of player.casts) {
    if (cast.isWeaponSwap) continue;
    const entry = rates.get(cast.name) ?? { name: cast.name, perMinute: 0 };
    entry.perMinute += 1 / minutes;
    rates.set(cast.name, entry);
  }
  return rates;
}

/**
 * Diffs the analyzed log against a reference log. Idle time and casts left on
 * cooldown are compared on those checks' own cards; this check covers DPS, cast
 * rates, aborted casts, auto chains, boons and gear/consumable/trait bonuses.
 */
export const referenceLogCheck: Check = {
  id: 'reference-log',
  name: 'Reference log comparison',
  description:
    'Compares DPS, cast rates, aborted casts, auto chains, boons and food/utility/relic/trait bonuses against a second log. Idle time and cooldown holds are shown on those findings when a reference is present.',

  applicable: ({ reference }) => (reference ? undefined : 'No reference log was provided.'),

  run: ({ log, player, window, skills, reference }) => {
    if (!reference) return [];

    const findings: Finding[] = [];
    const theirs = reference.player;
    const theirWindow = reference.log.fullFight;

    if (player.profession !== theirs.profession) {
      findings.push({
        id: 'reference-log/profession',
        checkId: 'reference-log',
        severity: 'info',
        title: `Comparing ${player.profession} against ${theirs.profession}`,
        summary:
          'The two logs are different specializations, so skill-by-skill differences below are not meaningful. Idle time, aborted casts, boon uptime and DPS still are.',
      });
    }

    const dpsRatio = theirs.dps > 0 ? player.dps / theirs.dps : 1;
    findings.push({
      id: 'reference-log/dps',
      checkId: 'reference-log',
      severity: dpsRatio < 0.8 ? 'warning' : dpsRatio < 0.95 ? 'info' : 'good',
      title: `${compactNumber(player.dps)} DPS, ${percent(dpsRatio)} of the reference`,
      summary:
        dpsRatio >= 0.95
          ? 'DPS is in line with the reference.'
          : dpsRatio >= 0.8
            ? 'DPS trails the reference a bit.'
            : 'DPS is well behind the reference.',
      tip: `${player.name} on ${log.fightName} versus ${theirs.name} on ${reference.log.fightName}, which did ${compactNumber(theirs.dps)} DPS.`,
      caveat:
        'Encounter length, boss mechanics, target hitbox and group composition all move DPS independently of how well you played.',
      metrics: (() => {
        const barMax = Math.max(player.dps, theirs.dps, 1);
        return [
          {
            label: 'Your DPS',
            display: compactNumber(player.dps),
            value: player.dps,
            target: theirs.dps,
            barMax,
          },
          {
            label: 'Reference DPS',
            display: compactNumber(theirs.dps),
            value: theirs.dps,
            target: theirs.dps,
            barMax,
          },
        ];
      })(),
    });

    // --- Aborted casts (time wasted before skill fires) ---
    const myWaste = measureCancelledCasts(player, window);
    const theirWaste = measureCancelledCasts(theirs, theirWindow);
    if (myWaste.abortedCount > 0 || theirWaste.abortedCount > 0) {
      findings.push(
        compareAgainstReference({
          id: 'reference-log/aborted-casts',
          delta: myWaste.wasteShare - theirWaste.wasteShare,
          similar: WASTE_SHARE_SIMILAR,
          warning: WASTE_SHARE_WARNING,
          labels: {
            better: `${duration(myWaste.wastedMs)} aborted, cleaner than the reference`,
            similar: `${duration(myWaste.wastedMs)} aborted, in line with the reference`,
            info: `${duration(myWaste.wastedMs)} aborted, more than the reference`,
            warning: `${duration(myWaste.wastedMs)} aborted, well above the reference`,
          },
          summaries: {
            better: `You lost ${percent(myWaste.wasteShare, 1)} of the fight to casts interrupted before firing against ${percent(theirWaste.wasteShare, 1)} in the reference.`,
            similar: `You lost ${percent(myWaste.wasteShare, 1)} of the fight to aborted casts against ${percent(theirWaste.wasteShare, 1)} in the reference. That level of interruption looks normal here.`,
            info: `Aborted casts cost you ${percent(myWaste.wasteShare, 1)} of the fight versus ${percent(theirWaste.wasteShare, 1)} in the reference${myWaste.worst[0] ? `. Worst skill: ${myWaste.worst[0].name}` : ''}.`,
            warning: `You threw away ${duration(myWaste.wastedMs)} on interrupted casts (${percent(myWaste.wasteShare, 1)}) while the reference only lost ${duration(theirWaste.wastedMs)} (${percent(theirWaste.wasteShare, 1)})${myWaste.worst[0] ? `. Focus on ${myWaste.worst[0].name}` : ''}.`,
          },
          fix: {
            info: 'Commit to casts you start, or do not press them when you know you will have to move.',
            warning:
              'If the reference kept these skills finishing, stop cancelling them mid-animation — dodge or move between casts instead.',
          },
          detail:
            'Only casts aborted before they fired count here. Deliberate aftercast cancels are a good thing and are not compared as waste.',
          metrics: (() => {
            const barMax = Math.max(myWaste.wasteShare, theirWaste.wasteShare, 0.01) * 100;
            return [
              {
                label: 'Your aborted time',
                display: `${duration(myWaste.wastedMs)} (${percent(myWaste.wasteShare, 1)})`,
                value: myWaste.wasteShare * 100,
                target: theirWaste.wasteShare * 100,
                barMax,
                higherIsBetter: false,
              },
              {
                label: 'Reference aborted time',
                display: `${duration(theirWaste.wastedMs)} (${percent(theirWaste.wasteShare, 1)})`,
                value: theirWaste.wasteShare * 100,
                target: theirWaste.wasteShare * 100,
                barMax,
                higherIsBetter: false,
              },
            ];
          })(),
          impactScale: { info: 200, warning: 300, cap: { info: 6, warning: 12 } },
        }),
      );
    }

    // --- Auto-attack chain completion ---
    if (skills) {
      const myChains = measureAutoAttackChains(player, skills);
      const theirChains = measureAutoAttackChains(theirs, skills);
      if (myChains.attempts >= 5 && theirChains.attempts >= 5) {
        // Higher completion is better, so delta is reference - yours.
        const delta = theirChains.completionRate - myChains.completionRate;
        findings.push(
          compareAgainstReference({
            id: 'reference-log/auto-chains',
            delta,
            similar: CHAIN_RATE_SIMILAR,
            warning: CHAIN_RATE_WARNING,
            labels: {
              better: `${percent(myChains.completionRate)} chain completion, ahead of the reference`,
              similar: `${percent(myChains.completionRate)} chain completion, in line with the reference`,
              info: `${percent(myChains.completionRate)} chain completion, below the reference`,
              warning: `${percent(myChains.completionRate)} chain completion, well below the reference`,
            },
            summaries: {
              better: `You finished ${myChains.completed} of ${myChains.attempts} auto chains against the reference's ${percent(theirChains.completionRate)}.`,
              similar: `You finished ${percent(myChains.completionRate)} of auto chains against ${percent(theirChains.completionRate)} in the reference. That looks normal for this fight.`,
              info: `You completed ${percent(myChains.completionRate)} of chains versus ${percent(theirChains.completionRate)} in the reference. The final auto hit is the hard-hitting one.`,
              warning: `Chain completion sat at ${percent(myChains.completionRate)} against ${percent(theirChains.completionRate)} in the reference — you are restarting chains before the final hit much more often.`,
            },
            fix: {
              info: 'When padding with autos, let the chain reach its last hit before casting the next skill, the way the reference did.',
              warning: 'When padding with autos, let the chain reach its last hit before casting the next skill, the way the reference did.',
            },
            metrics: (() => {
              const barMax = Math.max(myChains.completionRate, theirChains.completionRate, 0.01) * 100;
              return [
                {
                  label: 'Your chain completion',
                  display: percent(myChains.completionRate),
                  value: myChains.completionRate * 100,
                  target: theirChains.completionRate * 100,
                  barMax,
                },
                {
                  label: 'Reference chain completion',
                  display: percent(theirChains.completionRate),
                  value: theirChains.completionRate * 100,
                  target: theirChains.completionRate * 100,
                  barMax,
                },
              ];
            })(),
            impactScale: { info: 20, warning: 40, cap: { info: 5, warning: 10 } },
          }),
        );
      }
    }

    // --- Cast rates ---
    const mine = castRates(player);
    const ref = castRates(theirs);
    const under: { name: string; mine: number; theirs: number }[] = [];
    for (const [name, rate] of ref) {
      const own = mine.get(name)?.perMinute ?? 0;
      if (rate.perMinute - own >= MIN_RATE_DELTA) {
        under.push({ name, mine: own, theirs: rate.perMinute });
      }
    }
    under.sort((a, b) => b.theirs - b.mine - (a.theirs - a.mine));

    if (under.length > 0) {
      findings.push({
        id: 'reference-log/casts',
        checkId: 'reference-log',
        severity: under.length > 4 ? 'warning' : 'info',
        title: `${count(under.length, 'skill')} cast less often than the reference`,
        summary: `The largest difference is ${under[0].name}: ${under[0].mine.toFixed(1)} casts per minute against ${under[0].theirs.toFixed(1)}.`,
        detail:
          'Rates are per minute of active time, so a longer or shorter fight does not skew the comparison. Skills the reference never used are not listed.',
        fix: 'Work through this list from the top. A large gap on a damage skill usually means it is not in your priority at all.',
        evidence: under.slice(0, 8).map((entry) => ({
          time: 0,
          label: `${entry.name}: ${entry.mine.toFixed(1)} vs ${entry.theirs.toFixed(1)} casts per minute`,
        })),
        impact: Math.min(10, under.length * 1.5),
      });
    } else if (ref.size > 0 && player.profession === theirs.profession) {
      findings.push({
        id: 'reference-log/casts',
        checkId: 'reference-log',
        severity: 'good',
        title: 'Cast rates in line with the reference',
        summary: `None of the reference skills were cast materially less often on a per-minute basis.`,
      });
    }

    for (const boonName of boonsForRole(log, player, undefined)) {
      const myBuffId = findBuffId(log, boonName);
      const theirBuffId = findBuffId(reference.log, boonName);
      if (myBuffId === undefined || theirBuffId === undefined) continue;
      const myTimeline = player.buffs.get(myBuffId);
      const theirTimeline = theirs.buffs.get(theirBuffId);
      if (!myTimeline || !theirTimeline) continue;

      const myRatio = myTimeline.uptimeRatio();
      const theirRatio = theirTimeline.uptimeRatio();
      if (theirRatio - myRatio < 0.1) continue;

      findings.push({
        id: `reference-log/boon-${boonName.toLowerCase()}`,
        checkId: 'reference-log',
        severity: theirRatio - myRatio > 0.25 ? 'warning' : 'info',
        title: `${boonName} uptime trails the reference by ${percent(theirRatio - myRatio)}`,
        summary: `${boonName} is behind the reference.`,
        tip: `You had ${percent(myRatio)} against their ${percent(theirRatio)}.`,
        metrics: (() => {
          const barMax = Math.max(myRatio, theirRatio, 0.01) * 100;
          return [
            {
              label: `Your ${boonName}`,
              display: percent(myRatio),
              value: myRatio * 100,
              target: theirRatio * 100,
              barMax,
            },
            {
              label: `Reference ${boonName}`,
              display: percent(theirRatio),
              value: theirRatio * 100,
              target: theirRatio * 100,
              barMax,
            },
          ];
        })(),
        impact: Math.min(8, (theirRatio - myRatio) * 20),
      });
    }

    const myMods = new Map(player.damageModifiers.map((mod) => [mod.name, mod]));
    const modGaps = theirs.damageModifiers
      .map((mod) => ({
        name: mod.name,
        source: (mod.source ?? myMods.get(mod.name)?.source ?? 'other') as DamageModifierSource,
        mine: myMods.get(mod.name)?.hitRatio ?? 0,
        theirs: mod.hitRatio,
      }))
      .filter((entry) => entry.theirs - entry.mine > 0.15 && entry.theirs > 0.2)
      .sort((a, b) => b.theirs - b.mine - (a.theirs - a.mine));

    if (modGaps.length > 0) {
      const top = modGaps[0];
      findings.push({
        id: 'reference-log/damage-modifiers',
        checkId: 'reference-log',
        severity: 'info',
        title: titleForBonusGaps(modGaps),
        summary: `${formatDamageModifierName(top)} covered ${percent(top.mine)} of your hits against ${percent(top.theirs)} in the reference log.`,
        detail:
          'These are conditional bonuses from food, utility consumables, relics, sigils, runes, traits or skills. Lower hit coverage means you met the condition less often — usually a rotation or positioning difference.',
        evidence: modGaps.slice(0, 6).map((entry) => ({
          time: 0,
          label: `${formatDamageModifierName(entry)}: ${percent(entry.mine)} vs ${percent(entry.theirs)} of hits`,
        })),
        impact: Math.min(6, modGaps.length),
      });
    }

    return findings;
  },
};

function titleForBonusGaps(
  gaps: Array<{ name: string; source: DamageModifierSource }>,
): string {
  if (gaps.length === 1) {
    return `${formatDamageModifierName(gaps[0])} covered fewer of your hits`;
  }

  const labels = [...new Set(gaps.map((gap) => damageModifierSourceLabel(gap.source)))];
  if (labels.length === 1) {
    const kind = labels[0].toLowerCase();
    return `${count(gaps.length, `${kind} bonus`)} covered fewer of your hits`;
  }

  const list =
    labels.length === 2
      ? `${labels[0].toLowerCase()} and ${labels[1].toLowerCase()}`
      : `${labels
          .slice(0, -1)
          .map((label) => label.toLowerCase())
          .join(', ')} and ${labels[labels.length - 1].toLowerCase()}`;
  return `${list} bonuses covered fewer of your hits`;
}

interface CompareArgs {
  id: string;
  /** Positive means the player is worse on a "lower is better" metric (or behind on a higher-is-better metric already inverted). */
  delta: number;
  similar: number;
  warning: number;
  labels: { better: string; similar: string; info: string; warning: string };
  /** Long-form explanation; shown behind the summary info icon. */
  summaries: { better: string; similar: string; info: string; warning: string };
  /** Short takeaway under the title. Falls back to a compact default when omitted. */
  shortSummaries?: { better: string; similar: string; info: string; warning: string };
  fix?: { info?: string; warning?: string };
  detail?: string;
  caveat?: string;
  metrics: Metric[];
  evidence?: Finding['evidence'];
  impactScale: { info: number; warning: number; cap: { info: number; warning: number } };
}

/** Shared severity ladder for "is this worse than the reference?" findings. */
function compareAgainstReference(args: CompareArgs): Finding {
  let severity: Severity;
  let title: string;
  let tip: string;
  let summary: string;
  let fix: string | undefined;
  let impact: number | undefined;

  const shorts = args.shortSummaries ?? {
    better: 'Ahead of the reference.',
    similar: 'Looks normal versus the reference.',
    info: 'A bit behind the reference.',
    warning: 'Well behind the reference.',
  };

  if (args.delta <= args.similar) {
    severity = 'good';
    const better = args.delta <= -args.similar;
    title = better ? args.labels.better : args.labels.similar;
    tip = better ? args.summaries.better : args.summaries.similar;
    summary = better ? shorts.better : shorts.similar;
  } else if (args.delta > args.warning) {
    severity = 'warning';
    title = args.labels.warning;
    tip = args.summaries.warning;
    summary = shorts.warning;
    fix = args.fix?.warning;
    impact = Math.min(args.impactScale.cap.warning, args.delta * args.impactScale.warning);
  } else {
    severity = 'info';
    title = args.labels.info;
    tip = args.summaries.info;
    summary = shorts.info;
    fix = args.fix?.info;
    impact = Math.min(args.impactScale.cap.info, args.delta * args.impactScale.info);
  }

  return {
    id: args.id,
    checkId: 'reference-log',
    severity,
    title,
    summary,
    tip,
    detail: args.detail,
    fix,
    caveat: args.caveat,
    metrics: args.metrics,
    evidence: args.evidence,
    impact,
  };
}
