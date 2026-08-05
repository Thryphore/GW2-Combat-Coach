import { findBuffId } from '../../model/normalize.ts';
import { boonsForRole } from '../boonRole.ts';
import { count, duration, percent, timestamp } from '../format.ts';
import type { Check, Finding, Severity } from '../types.ts';

interface BoonConfig {
  name: string;
  /** Uptime ratio below which the boon is worth flagging. */
  warnBelow: number;
  criticalBelow: number;
  note: string;
}

const BOON_CONFIG: Record<string, BoonConfig> = {
  Alacrity: {
    name: 'Alacrity',
    warnBelow: 0.9,
    criticalBelow: 0.7,
    note: 'Alacrity makes skills recharge 25% faster, so every second without it slows the whole subgroup.',
  },
  Quickness: {
    name: 'Quickness',
    warnBelow: 0.9,
    criticalBelow: 0.7,
    note: 'Quickness speeds up cast animations by 50%, so gaps directly cost casts.',
  },
};

const MIN_GAP_MS = 2000;

export const boonUptimeCheck: Check = {
  id: 'boon-uptime',
  name: 'Boon uptime',
  description:
    'For Alacrity and Quickness supports, measures uptime of the chronoboon that role is expected to cover.',

  applicable: ({ log, player, referenceBuild }) => {
    if (boonsForRole(log, player, referenceBuild).length === 0) {
      return 'This log is not an Alacrity or Quickness support role, so chronoboon uptime is not graded.';
    }
    return undefined;
  },

  run: ({ log, player, window, referenceBuild }) => {
    const findings: Finding[] = [];
    const tracked = boonsForRole(log, player, referenceBuild);

    for (const name of tracked) {
      const boon = BOON_CONFIG[name];
      if (!boon) continue;

      const buffId = findBuffId(log, boon.name);
      if (buffId === undefined) continue;
      const timeline = player.buffs.get(buffId);
      if (!timeline) continue;

      const ratio = timeline.uptimeRatio(window);
      // A boon that never appeared is usually not part of the composition at all.
      if (ratio <= 0) continue;

      const gaps = timeline.gaps(MIN_GAP_MS, window);
      const lostMs = gaps.reduce((total, gap) => total + (gap.end - gap.start), 0);
      const fix = `Keeping ${boon.name} up is part of this support role. Cover the subgroup, weave your boon skills on cooldown, and check whether gaps line up with mechanics that pull you out of range.`;

      const severity: Severity =
        ratio < boon.criticalBelow ? 'critical' : ratio < boon.warnBelow ? 'warning' : 'good';

      if (severity === 'good') {
        findings.push({
          id: `boon-uptime/${boon.name.toLowerCase()}`,
          checkId: 'boon-uptime',
          severity: 'good',
          title: `${boon.name} uptime ${percent(ratio)}`,
          summary: 'Effectively permanent for the people you are covering.',
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
        fix,
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
