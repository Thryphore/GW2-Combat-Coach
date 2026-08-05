import { count, duration, percent, timestamp } from '../format.ts';
import type { Check, Finding } from '../types.ts';

export const wastedCastsCheck: Check = {
  id: 'wasted-casts',
  name: 'Cancelled casts',
  description:
    'Separates casts that were aborted before they did anything (time thrown away) from deliberate animation cancels after the skill fired (time saved).',

  run: ({ player, window }) => {
    const nonAuto = player.casts.filter((cast) => !cast.isAutoAttack && !cast.isWeaponSwap);
    if (nonAuto.length === 0) return [];

    const aborted = nonAuto.filter((cast) => cast.timeGained < 0);
    const cancelled = nonAuto.filter((cast) => cast.timeGained > 0);

    const wastedMs = aborted.reduce((total, cast) => total + Math.abs(cast.timeGained), 0);
    const savedMs = cancelled.reduce((total, cast) => total + cast.timeGained, 0);
    const fightMs = Math.max(1, window.end - window.start);

    const findings: Finding[] = [];

    if (aborted.length > 0) {
      const share = wastedMs / fightMs;
      const severity = share > 0.02 ? 'critical' : share > 0.0075 ? 'warning' : 'info';

      const worst = new Map<string, { name: string; ms: number; times: number[] }>();
      for (const cast of aborted) {
        const entry = worst.get(cast.name) ?? { name: cast.name, ms: 0, times: [] };
        entry.ms += Math.abs(cast.timeGained);
        entry.times.push(cast.time);
        worst.set(cast.name, entry);
      }
      const ranked = [...worst.values()].sort((a, b) => b.ms - a.ms);

      findings.push({
        id: 'wasted-casts/aborted',
        checkId: 'wasted-casts',
        severity,
        title: `${count(aborted.length, 'cast')} aborted before firing`,
        summary: `${duration(wastedMs)} (${percent(share, 1)} of the fight) went into skills that were interrupted before they did anything. The worst offender was ${ranked[0].name} at ${duration(ranked[0].ms)}.`,
        detail:
          'Elite Insights marks a cast as wasted when the animation was stopped before the skill fired, so the cast time was paid with nothing to show for it. Common causes are pressing another skill too early, dodging out of a cast, or getting interrupted.',
        fix: 'Watch the skills at the top of this list. If you are cancelling them yourself, either commit to the cast or stop pressing it in situations where you know you will have to move.',
        metrics: [
          {
            label: 'Time wasted',
            display: duration(wastedMs),
            value: wastedMs,
            higherIsBetter: false,
          },
          {
            label: 'Share of fight',
            display: percent(share, 1),
            value: share * 100,
            higherIsBetter: false,
          },
        ],
        evidence: ranked.slice(0, 6).map((entry) => ({
          time: entry.times[0],
          label: `${entry.name}: ${count(entry.times.length, 'cancel')}, ${duration(entry.ms)} lost`,
          detail: `first at ${timestamp(entry.times[0])}`,
        })),
        impact: Math.min(18, share * 400),
      });
    }

    if (savedMs > 500) {
      findings.push({
        id: 'wasted-casts/saved',
        checkId: 'wasted-casts',
        severity: 'good',
        title: `${duration(savedMs)} saved with animation cancels`,
        summary: `${count(cancelled.length, 'cast')} were cut short after the damage had already gone out, which is exactly what you want.`,
        metrics: [{ label: 'Time saved', display: duration(savedMs), value: savedMs }],
      });
    }

    return findings;
  },
};
