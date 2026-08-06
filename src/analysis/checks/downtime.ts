import type { NormalizedPlayer } from '../../model/normalize.ts';
import type { Interval } from '../../model/timeline.ts';
import { count, duration, percent, timestamp } from '../format.ts';
import type { Check, Finding, Metric } from '../types.ts';

/** Below this, a gap is just the natural seam between two casts. */
const MIN_GAP_MS = 900;

export interface IdleGap {
  start: number;
  end: number;
}

export interface IdleMeasurement {
  /** Alive/in-combat window used for the measurement. */
  spanMs: number;
  idleMs: number;
  /** Idle time as a fraction of the measured span. */
  share: number;
  gaps: IdleGap[];
}

/**
 * Stretches where no non-swap skill was being cast while the player was aware.
 * Shared by the downtime check and the reference-log comparison.
 */
export function measureIdleTime(player: NormalizedPlayer, window: Interval): IdleMeasurement {
  const casts = player.casts.filter((cast) => !cast.isWeaponSwap);
  const start = Math.max(window.start, player.firstAware);
  const end = Math.min(window.end, player.lastAware);
  const spanMs = Math.max(1, end - start);

  if (casts.length < 5) {
    return { spanMs, idleMs: 0, share: 0, gaps: [] };
  }

  const gaps: IdleGap[] = [];
  let cursor = start;
  for (const cast of casts) {
    if (cast.time > cursor + MIN_GAP_MS) gaps.push({ start: cursor, end: cast.time });
    cursor = Math.max(cursor, cast.endTime);
  }
  if (end > cursor + MIN_GAP_MS) gaps.push({ start: cursor, end });

  const idleMs = gaps.reduce((total, gap) => total + (gap.end - gap.start), 0);
  return { spanMs, idleMs, share: idleMs / spanMs, gaps };
}

/** Summary used when idle share is within 2pp of the reference — safe to hide in the main list. */
export const IDLE_NORMAL_SUMMARY = 'Idle time looks normal for this encounter.';

export const downtimeCheck: Check = {
  id: 'downtime',
  name: 'Downtime',
  description: 'Finds stretches where no skill was being cast while you were alive and in combat.',

  run: ({ player, window, reference }) => {
    const measured = measureIdleTime(player, window);
    const { idleMs, share, gaps } = measured;
    if (gaps.length === 0 || share < 0.02) return [];

    const refMeasured = reference
      ? measureIdleTime(reference.player, reference.log.fullFight)
      : undefined;

    let severity: Finding['severity'] = share > 0.15 ? 'critical' : share > 0.07 ? 'warning' : 'info';
    if (refMeasured) {
      const delta = share - refMeasured.share;
      if (delta <= 0.02) severity = 'info';
      else if (delta > 0.07) severity = share > 0.15 ? 'critical' : 'warning';
    }

    const ranked = [...gaps].sort((a, b) => b.end - b.start - (a.end - a.start));
    const longest = `${duration(ranked[0].end - ranked[0].start)} at ${timestamp(ranked[0].start)}`;
    const facts = `${percent(share, 1)} of your time in this fight had no skill going out, spread over ${count(gaps.length, 'gap')}. The longest was ${longest}.`;

    let summary: string;
    let tip: string;
    if (refMeasured) {
      const delta = share - refMeasured.share;
      if (delta <= 0.02) {
        summary = IDLE_NORMAL_SUMMARY;
        tip = `${facts} The reference idled ${percent(refMeasured.share, 1)} (${duration(refMeasured.idleMs)}) — for this encounter that amount of not attacking looks normal.`;
      } else {
        summary = `${percent(delta, 1)} more idle than the reference — unlikely to be just phase transitions.`;
        tip = `${facts} The reference only idled ${percent(refMeasured.share, 1)} (${duration(refMeasured.idleMs)}).`;
      }
    } else {
      summary = `${percent(share, 1)} of the fight had no skill going out.`;
      tip = facts;
    }

    const metrics: Metric[] = [];
    if (refMeasured) {
      const barMax = Math.max(share, refMeasured.share, 0.01) * 100;
      metrics.push(
        {
          label: 'Your idle time',
          display: `${duration(idleMs)} (${percent(share, 1)})`,
          value: share * 100,
          target: refMeasured.share * 100,
          barMax,
          higherIsBetter: false,
        },
        {
          label: 'Reference idle time',
          display: `${duration(refMeasured.idleMs)} (${percent(refMeasured.share, 1)})`,
          value: refMeasured.share * 100,
          target: refMeasured.share * 100,
          barMax,
          higherIsBetter: false,
        },
      );
    } else {
      metrics.push(
        {
          label: 'Your idle time',
          display: `${duration(idleMs)} (${percent(share, 1)})`,
          value: share * 100,
          target: 5,
          higherIsBetter: false,
        },
        {
          label: 'Share of fight',
          display: percent(share, 1),
          value: share * 100,
          target: 5,
          higherIsBetter: false,
        },
      );
    }

    return [
      {
        id: 'downtime/idle',
        checkId: 'downtime',
        severity,
        title: `${duration(idleMs)} with nothing being cast`,
        summary,
        tip,
        detail:
          'Some downtime is unavoidable: phase transitions, mechanics that push you out, and running between targets all show up here. The goal is to shrink the gaps you control by filling them with auto-attacks.',
        fix: refMeasured
          ? 'When you have nothing off cooldown, auto-attack. If the reference kept attacking through the same beats, those gaps are yours to fill.'
          : 'When you have nothing off cooldown, auto-attack. Even a low-damage filler beats standing still, and it keeps chains and resource generation ticking.',
        caveat: refMeasured
          ? 'Boss phase transitions and forced movement count as idle in both logs. Idle share is compared so fight length does not skew the result.'
          : 'Boss phase transitions and forced movement mechanics are counted as downtime because the log cannot tell them apart from idling.',
        metrics,
        evidence: ranked.slice(0, 6).map((gap) => ({
          time: gap.start,
          label: `${duration(gap.end - gap.start)} idle from ${timestamp(gap.start)}`,
        })),
        impact: Math.min(20, share * 80),
      } satisfies Finding,
    ];
  },
};
