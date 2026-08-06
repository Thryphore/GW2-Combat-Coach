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

export interface SkillCancelBucket {
  name: string;
  ms: number;
  times: number[];
}

export interface CancelledCastMeasurement {
  abortedCount: number;
  cancelledCount: number;
  wastedMs: number;
  savedMs: number;
  /** Aborted time as a fraction of the analysis window. */
  wasteShare: number;
  worst: SkillCancelBucket[];
  /** Aftercast cancels grouped by skill, most time saved first. */
  savedBySkill: SkillCancelBucket[];
}

function bucketBySkill(casts: NormalizedCast[], msOf: (cast: NormalizedCast) => number): SkillCancelBucket[] {
  const buckets = new Map<string, SkillCancelBucket>();
  for (const cast of casts) {
    const entry = buckets.get(cast.name) ?? { name: cast.name, ms: 0, times: [] };
    entry.ms += msOf(cast);
    entry.times.push(cast.time);
    buckets.set(cast.name, entry);
  }
  return [...buckets.values()].sort((a, b) => b.ms - a.ms);
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

  return {
    abortedCount: aborted.length,
    cancelledCount: cancelled.length,
    wastedMs,
    savedMs,
    wasteShare: wastedMs / fightMs,
    worst: bucketBySkill(aborted, (cast) => Math.abs(cast.timeGained)),
    savedBySkill: bucketBySkill(cancelled, (cast) => cast.timeGained),
  };
}

export const wastedCastsCheck: Check = {
  id: 'wasted-casts',
  name: 'Cancelled casts',
  description:
    'Separates casts that were aborted before they activated (time thrown away) from aftercast cancels after the skill activated (time saved).',

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

      let summary: string;
      if (refMeasured) {
        const delta = wasteShare - refMeasured.wasteShare;
        summary =
          delta <= 0.005
            ? 'Aborted casts look normal versus the reference.'
            : 'More aborted-cast time than the reference.';
      } else {
        summary = `${percent(wasteShare, 1)} of the fight lost to casts that never fired.`;
      }

      const metrics: Metric[] = [];
      if (refMeasured) {
        const barMax = Math.max(wasteShare, refMeasured.wasteShare, 0.01) * 100;
        metrics.push(
          {
            label: 'Your aborted time',
            display: `${duration(wastedMs)} (${percent(wasteShare, 1)})`,
            value: wasteShare * 100,
            target: refMeasured.wasteShare * 100,
            barMax,
            higherIsBetter: false,
          },
          {
            label: 'Reference aborted time',
            display: `${duration(refMeasured.wastedMs)} (${percent(refMeasured.wasteShare, 1)})`,
            value: refMeasured.wasteShare * 100,
            target: refMeasured.wasteShare * 100,
            barMax,
            higherIsBetter: false,
          },
        );
      } else {
        metrics.push({
          label: 'Your aborted time',
          display: `${duration(wastedMs)} (${percent(wasteShare, 1)})`,
          value: wasteShare * 100,
          higherIsBetter: false,
        });
      }

      findings.push({
        id: 'wasted-casts/aborted',
        checkId: 'wasted-casts',
        severity,
        title: `${count(abortedCount, 'cast')} aborted before firing`,
        summary,
        tip: 'Elite Insights marks a cast as wasted when the animation was stopped before the skill fired, so the cast time was paid with nothing to show for it. Common causes are pressing another skill too early, dodging out of a cast, or getting interrupted. Block skills that are meant to be cancelled into a follow-up (Illusionary Riposte → Counter Blade, Illusionary Counter → Counterspell) are not counted.',
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
      const topSaved = measured.savedBySkill[0];
      const skillTip = topSaved
        ? `Most of that came from ${topSaved.name} (${count(topSaved.times.length, 'cancel')}, ${duration(topSaved.ms)} saved).`
        : undefined;

      const activationCaveat =
        'Elite Insights marks these when the cast reached activation (aftercast cancel) — that is not a guarantee every hit landed on multi-hit or channeled skills.';
      let summary = `${count(measured.cancelledCount, 'cast')} were cut short after the skill activated, which is usually what you want.`;
      let tip = [skillTip, activationCaveat].filter(Boolean).join(' ');
      const metrics: Metric[] = [];

      if (refMeasured) {
        const deltaMs = measured.savedMs - refMeasured.savedMs;
        summary =
          deltaMs > 500
            ? 'More animation-cancel time saved than the reference.'
            : deltaMs < -500
              ? 'Less animation-cancel time saved than the reference.'
              : 'Animation cancels look in line with the reference.';
        tip = [
          skillTip,
          `The reference saved ${duration(refMeasured.savedMs)} across ${count(refMeasured.cancelledCount, 'cancel')}.`,
          activationCaveat,
        ]
          .filter(Boolean)
          .join(' ');
        const barMax = Math.max(measured.savedMs, refMeasured.savedMs, 1);
        metrics.push(
          {
            label: 'Your time saved',
            display: duration(measured.savedMs),
            value: measured.savedMs,
            target: refMeasured.savedMs,
            barMax,
            higherIsBetter: true,
          },
          {
            label: 'Reference time saved',
            display: duration(refMeasured.savedMs),
            value: refMeasured.savedMs,
            target: refMeasured.savedMs,
            barMax,
            higherIsBetter: true,
          },
        );
      } else {
        metrics.push({
          label: 'Time saved',
          display: duration(measured.savedMs),
          value: measured.savedMs,
        });
      }

      findings.push({
        id: 'wasted-casts/saved',
        checkId: 'wasted-casts',
        severity: 'good',
        title: `${duration(measured.savedMs)} saved with animation cancels`,
        summary,
        tip,
        metrics,
        evidence: measured.savedBySkill.slice(0, 8).map((entry) => ({
          time: entry.times[0],
          label: `${entry.name}: ${count(entry.times.length, 'cancel')}, ${duration(entry.ms)} saved`,
          detail: `first at ${timestamp(entry.times[0])}`,
        })),
      });
    }

    return findings;
  },
};
