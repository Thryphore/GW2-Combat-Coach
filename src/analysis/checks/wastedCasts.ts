import type { NormalizedCast, NormalizedPlayer } from '../../model/normalize.ts';
import type { Interval } from '../../model/timeline.ts';
import { count, duration, percent, timestamp } from '../format.ts';
import type { Check, Finding, Metric } from '../types.ts';

/**
 * Block skills designed to be cancelled early into a follow-up attack.
 * Elite Insights marks those cancels as aborted (timeGained < 0), but they are
 * intentional — e.g. Illusionary Riposte → Counter Blade for CC.
 */
const INTENTIONAL_EARLY_CANCEL_SKILL_IDS = new Set([
  10280, // Illusionary Riposte → Counter Blade
  10276, // Illusionary Counter → Counterspell
]);

function isIntentionalEarlyCancel(cast: NormalizedCast): boolean {
  return INTENTIONAL_EARLY_CANCEL_SKILL_IDS.has(cast.skillId);
}

export interface CancelledCastMeasurement {
  abortedCount: number;
  cancelledCount: number;
  wastedMs: number;
  savedMs: number;
  /** Aborted time as a fraction of the analysis window. */
  wasteShare: number;
  worst: { name: string; ms: number; times: number[] }[];
}

/** Separates aborted casts from deliberate aftercast cancels. */
export function measureCancelledCasts(
  player: NormalizedPlayer,
  window: Interval,
): CancelledCastMeasurement {
  const nonAuto = player.casts.filter((cast) => !cast.isAutoAttack && !cast.isWeaponSwap);
  const aborted = nonAuto.filter((cast) => cast.timeGained < 0 && !isIntentionalEarlyCancel(cast));
  const cancelled = nonAuto.filter((cast) => cast.timeGained > 0);
  const wastedMs = aborted.reduce((total, cast) => total + Math.abs(cast.timeGained), 0);
  const savedMs = cancelled.reduce((total, cast) => total + cast.timeGained, 0);
  const fightMs = Math.max(1, window.end - window.start);

  const worst = new Map<string, { name: string; ms: number; times: number[] }>();
  for (const cast of aborted) {
    const entry = worst.get(cast.name) ?? { name: cast.name, ms: 0, times: [] };
    entry.ms += Math.abs(cast.timeGained);
    entry.times.push(cast.time);
    worst.set(cast.name, entry);
  }

  return {
    abortedCount: aborted.length,
    cancelledCount: cancelled.length,
    wastedMs,
    savedMs,
    wasteShare: wastedMs / fightMs,
    worst: [...worst.values()].sort((a, b) => b.ms - a.ms),
  };
}

export const wastedCastsCheck: Check = {
  id: 'wasted-casts',
  name: 'Cancelled casts',
  description:
    'Separates casts that were aborted before they did anything (time thrown away) from deliberate animation cancels after the skill fired (time saved).',

  run: ({ player, window, reference }) => {
    const measured = measureCancelledCasts(player, window);
    if (measured.abortedCount === 0 && measured.savedMs <= 500) return [];

    const findings: Finding[] = [];
    const refMeasured = reference
      ? measureCancelledCasts(reference.player, reference.log.fullFight)
      : undefined;

    if (measured.abortedCount > 0) {
      const { wasteShare, wastedMs, abortedCount, worst } = measured;
      let severity: Finding['severity'] =
        wasteShare > 0.02 ? 'critical' : wasteShare > 0.0075 ? 'warning' : 'info';
      if (refMeasured) {
        const delta = wasteShare - refMeasured.wasteShare;
        if (delta <= 0.005) severity = 'info';
        else if (delta > 0.015) severity = wasteShare > 0.02 ? 'critical' : 'warning';
      }

      let summary = `${duration(wastedMs)} (${percent(wasteShare, 1)} of the fight) went into skills that were interrupted before they did anything. The worst offender was ${worst[0].name} at ${duration(worst[0].ms)}.`;
      if (refMeasured) {
        summary += ` The reference lost ${duration(refMeasured.wastedMs)} (${percent(refMeasured.wasteShare, 1)}).`;
      }

      const metrics: Metric[] = [
        {
          label: 'Your aborted time',
          display: `${duration(wastedMs)} (${percent(wasteShare, 1)})`,
          value: wasteShare * 100,
          target: refMeasured ? refMeasured.wasteShare * 100 : undefined,
          higherIsBetter: false,
        },
      ];
      if (refMeasured) {
        metrics.push({
          label: 'Reference aborted time',
          display: `${duration(refMeasured.wastedMs)} (${percent(refMeasured.wasteShare, 1)})`,
          value: refMeasured.wasteShare * 100,
          higherIsBetter: false,
        });
      }

      findings.push({
        id: 'wasted-casts/aborted',
        checkId: 'wasted-casts',
        severity,
        title: `${count(abortedCount, 'cast')} aborted before firing`,
        summary,
        detail:
          'Elite Insights marks a cast as wasted when the animation was stopped before the skill fired, so the cast time was paid with nothing to show for it. Common causes are pressing another skill too early, dodging out of a cast, or getting interrupted. Block skills that are meant to be cancelled into a follow-up (Illusionary Riposte → Counter Blade, Illusionary Counter → Counterspell) are not counted.',
        fix: 'Watch the skills at the top of this list. If you are cancelling them yourself, either commit to the cast or stop pressing it in situations where you know you will have to move.',
        metrics,
        evidence: worst.slice(0, 6).map((entry) => ({
          time: entry.times[0],
          label: `${entry.name}: ${count(entry.times.length, 'cancel')}, ${duration(entry.ms)} lost`,
          detail: `first at ${timestamp(entry.times[0])}`,
        })),
        impact: Math.min(18, wasteShare * 400),
      });
    }

    if (measured.savedMs > 500) {
      findings.push({
        id: 'wasted-casts/saved',
        checkId: 'wasted-casts',
        severity: 'good',
        title: `${duration(measured.savedMs)} saved with animation cancels`,
        summary: `${count(measured.cancelledCount, 'cast')} were cut short after the damage had already gone out, which is exactly what you want.`,
        metrics: [{ label: 'Time saved', display: duration(measured.savedMs), value: measured.savedMs }],
      });
    }

    return findings;
  },
};
