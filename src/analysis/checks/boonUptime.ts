import { findBuffId } from '../../model/normalize.ts';
import { count, duration, percent, timestamp } from '../format.ts';
import type { Check, Finding, Severity } from '../types.ts';

interface BoonConfig {
  name: string;
  /** Uptime ratio below which the boon is worth flagging. */
  warnBelow: number;
  criticalBelow: number;
  /** Stacking boons are graded on average stacks instead of uptime. */
  stacks?: { target: number; warnBelow: number };
  note: string;
}

const BOONS: BoonConfig[] = [
  {
    name: 'Alacrity',
    warnBelow: 0.9,
    criticalBelow: 0.7,
    note: 'Alacrity makes your skills recharge 25% faster, so every second without it is a slower rotation.',
  },
  {
    name: 'Quickness',
    warnBelow: 0.9,
    criticalBelow: 0.7,
    note: 'Quickness speeds up your cast animations by 50%, so gaps directly cost you casts.',
  },
  {
    name: 'Fury',
    warnBelow: 0.85,
    criticalBelow: 0.6,
    note: 'Fury is 25% critical chance. Builds that assume permanent Fury lose a lot of damage without it.',
  },
  {
    name: 'Might',
    warnBelow: 0.95,
    criticalBelow: 0.8,
    stacks: { target: 25, warnBelow: 20 },
    note: 'Might is your main scaling boon in group content.',
  },
];

const MIN_GAP_MS = 2000;

export const boonUptimeCheck: Check = {
  id: 'boon-uptime',
  name: 'Boon uptime',
  description:
    'Measures how much of the fight you had each offensive boon, and pinpoints when they dropped.',

  run: ({ log, player, window }) => {
    const findings: Finding[] = [];

    for (const boon of BOONS) {
      const buffId = findBuffId(log, boon.name);
      if (buffId === undefined) continue;
      const timeline = player.buffs.get(buffId);
      if (!timeline) continue;

      const ratio = timeline.uptimeRatio(window);
      // A boon that never appeared is usually not part of the composition at all.
      if (ratio <= 0) continue;

      const gaps = timeline.gaps(MIN_GAP_MS, window);
      const lostMs = gaps.reduce((total, gap) => total + (gap.end - gap.start), 0);

      if (boon.stacks) {
        const average = timeline.averageStacks(window);
        if (average >= boon.stacks.warnBelow) {
          findings.push({
            id: `boon-uptime/${boon.name.toLowerCase()}`,
            checkId: 'boon-uptime',
            severity: 'good',
            title: `${boon.name} averaged ${average.toFixed(1)} stacks`,
            summary: `Close enough to the ${boon.stacks.target} stack cap that there is nothing to fix here.`,
            metrics: [
              {
                label: `Average ${boon.name}`,
                display: average.toFixed(1),
                value: average,
                target: boon.stacks.target,
              },
            ],
          });
          continue;
        }

        findings.push({
          id: `boon-uptime/${boon.name.toLowerCase()}`,
          checkId: 'boon-uptime',
          severity: average < boon.stacks.target * 0.6 ? 'warning' : 'info',
          title: `${boon.name} averaged only ${average.toFixed(1)} stacks`,
          summary: `${boon.note} You sat well below the ${boon.stacks.target} stack cap for most of the fight.`,
          fix: 'Check whether your group has a Might source covering your subgroup, and stay inside their boon radius.',
          metrics: [
            {
              label: `Average ${boon.name}`,
              display: average.toFixed(1),
              value: average,
              target: boon.stacks.target,
            },
          ],
          impact: Math.min(8, ((boon.stacks.target - average) / boon.stacks.target) * 10),
        });
        continue;
      }

      const severity: Severity =
        ratio < boon.criticalBelow ? 'critical' : ratio < boon.warnBelow ? 'warning' : 'good';

      if (severity === 'good') {
        findings.push({
          id: `boon-uptime/${boon.name.toLowerCase()}`,
          checkId: 'boon-uptime',
          severity: 'good',
          title: `${boon.name} uptime ${percent(ratio)}`,
          summary: 'Effectively permanent for this fight.',
          metrics: [
            { label: `${boon.name} uptime`, display: percent(ratio), value: ratio * 100, target: 100 },
          ],
        });
        continue;
      }

      findings.push({
        id: `boon-uptime/${boon.name.toLowerCase()}`,
        checkId: 'boon-uptime',
        severity,
        title: `${boon.name} uptime was ${percent(ratio)}`,
        summary: `You went without ${boon.name} for ${duration(lostMs)} across ${count(gaps.length, 'gap')}. ${boon.note}`,
        fix: `${boon.name} is provided by your group on this build, so the fix is usually positional: stay within 360 units of whoever is providing it, and check whether the gaps line up with mechanics that spread the group out.`,
        metrics: [
          {
            label: `${boon.name} uptime`,
            display: percent(ratio),
            value: ratio * 100,
            target: 100,
          },
          {
            label: 'Time without it',
            display: duration(lostMs),
            value: lostMs,
            higherIsBetter: false,
          },
        ],
        evidence: [...gaps]
          .sort((a, b) => b.end - b.start - (a.end - a.start))
          .slice(0, 6)
          .map((gap) => ({
            time: gap.start,
            label: `No ${boon.name} for ${duration(gap.end - gap.start)} from ${timestamp(gap.start)}`,
          })),
        impact: Math.min(15, (1 - ratio) * 25),
      });
    }

    return findings;
  },
};
