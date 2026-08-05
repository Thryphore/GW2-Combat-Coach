import { count, duration, percent, timestamp } from '../format.ts';
import type { Check, Finding } from '../types.ts';

/** Below this, a gap is just the natural seam between two casts. */
const MIN_GAP_MS = 900;

export const downtimeCheck: Check = {
  id: 'downtime',
  name: 'Downtime',
  description: 'Finds stretches where no skill was being cast while you were alive and in combat.',

  run: ({ player, window }) => {
    const casts = player.casts.filter((cast) => !cast.isWeaponSwap);
    if (casts.length < 5) return [];

    const start = Math.max(window.start, player.firstAware);
    const end = Math.min(window.end, player.lastAware);
    const span = Math.max(1, end - start);

    const gaps: { start: number; end: number }[] = [];
    let cursor = start;
    for (const cast of casts) {
      if (cast.time > cursor + MIN_GAP_MS) gaps.push({ start: cursor, end: cast.time });
      cursor = Math.max(cursor, cast.endTime);
    }
    if (end > cursor + MIN_GAP_MS) gaps.push({ start: cursor, end });

    if (gaps.length === 0) return [];

    const idleMs = gaps.reduce((total, gap) => total + (gap.end - gap.start), 0);
    const share = idleMs / span;
    if (share < 0.02) return [];

    const severity = share > 0.15 ? 'critical' : share > 0.07 ? 'warning' : 'info';
    const ranked = [...gaps].sort((a, b) => b.end - b.start - (a.end - a.start));

    return [
      {
        id: 'downtime/idle',
        checkId: 'downtime',
        severity,
        title: `${duration(idleMs)} with nothing being cast`,
        summary: `${percent(share, 1)} of your time in this fight had no skill going out, spread over ${count(gaps.length, 'gap')}. The longest was ${duration(ranked[0].end - ranked[0].start)} at ${timestamp(ranked[0].start)}.`,
        detail:
          'Some downtime is unavoidable: phase transitions, mechanics that push you out, and running between targets all show up here. The goal is to shrink the gaps you control by filling them with auto-attacks.',
        fix: 'When you have nothing off cooldown, auto-attack. Even a low-damage filler beats standing still, and it keeps chains and resource generation ticking.',
        caveat:
          'Boss phase transitions and forced movement mechanics are counted as downtime because the log cannot tell them apart from idling.',
        metrics: [
          {
            label: 'Idle time',
            display: duration(idleMs),
            value: idleMs,
            higherIsBetter: false,
          },
          {
            label: 'Share of fight',
            display: percent(share, 1),
            value: share * 100,
            target: 5,
            higherIsBetter: false,
          },
        ],
        evidence: ranked.slice(0, 6).map((gap) => ({
          time: gap.start,
          label: `${duration(gap.end - gap.start)} idle from ${timestamp(gap.start)}`,
        })),
        impact: Math.min(20, share * 80),
      } satisfies Finding,
    ];
  },
};
