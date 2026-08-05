import { findBuffId, findBuffIdMatching } from '../../../model/normalize.ts';
import type { NormalizedLog } from '../../../model/normalize.ts';
import { count, duration, percent, timestamp } from '../../format.ts';
import type { Check, Finding } from '../../types.ts';

/** Virtuoso stocks five Blades, and Infinite Forge refunds two on a full spend. */
const FULL_STOCK = 5;

/** Bladeturn Requiem is the defensive F5; it is cast for the block, not the spend. */
const DEFENSIVE_BLADESONGS = /^(Bladeturn Requiem|Bladeturn Refrain)$/i;

function bladeBuffId(log: NormalizedLog): number | undefined {
  return findBuffId(log, 'Blades') ?? findBuffIdMatching(log, /^blade/i);
}

export const bladeEconomyCheck: Check = {
  id: 'virtuoso/blades',
  name: 'Blade economy',
  description:
    'Checks that Bladesongs are spent at a full stack of five Blades, and how long you spent capped and generating nothing.',
  professions: ['Virtuoso'],

  applicable: ({ log, player }) => {
    if (bladeBuffId(log) === undefined) {
      return 'This log does not track the Blades stack, so blade economy cannot be measured.';
    }
    const hasBladesongs = player.casts.some((cast) => cast.name.startsWith('Bladesong'));
    return hasBladesongs ? undefined : 'No Bladesongs were cast in this log.';
  },

  run: ({ log, player, window }) => {
    const buffId = bladeBuffId(log);
    if (buffId === undefined) return [];
    const timeline = player.buffs.get(buffId);
    if (!timeline) return [];

    const bladesongs = player.casts.filter(
      (cast) => cast.name.startsWith('Bladesong') && !DEFENSIVE_BLADESONGS.test(cast.name),
    );
    if (bladesongs.length === 0) return [];

    const spends = bladesongs.map((cast) => ({
      cast,
      // Sample just before the cast so the spend itself is not counted.
      stacks: timeline.stacksAt(cast.time - 1),
    }));
    const premature = spends.filter((spend) => spend.stacks < FULL_STOCK);

    const findings: Finding[] = [];
    const fightMs = Math.max(1, window.end - window.start);

    if (premature.length > 0) {
      const ratio = premature.length / spends.length;
      const bladesLost = premature.reduce((total, spend) => total + (FULL_STOCK - spend.stacks), 0);
      findings.push({
        id: 'virtuoso/blades/premature',
        checkId: 'virtuoso/blades',
        severity: ratio > 0.4 ? 'critical' : ratio > 0.15 ? 'warning' : 'info',
        title: `${count(premature.length, 'Bladesong')} fired below five Blades`,
        summary: `${premature.length} of ${spends.length} damaging Bladesongs went out under a full stack, spending ${bladesLost} fewer Blades than they could have.`,
        detail:
          'Bladesong damage scales with the Blades it consumes, and Infinite Forge only refunds Blades when you spend a full stack of five. Firing early costs damage twice: once on the hit, once on the refund you did not get.',
        fix: 'Hold Bladesongs until the counter reads five. If you find yourself capped and waiting, that is the opposite problem and the next finding covers it.',
        metrics: [
          {
            label: 'Full-stack spends',
            display: `${spends.length - premature.length} / ${spends.length}`,
            value: ((spends.length - premature.length) / spends.length) * 100,
            target: 100,
          },
          {
            label: 'Blades left unspent',
            display: String(bladesLost),
            value: bladesLost,
            higherIsBetter: false,
          },
        ],
        evidence: premature.slice(0, 8).map((spend) => ({
          time: spend.cast.time,
          label: `${spend.cast.name} at ${timestamp(spend.cast.time)} with ${count(spend.stacks, 'Blade')}`,
        })),
        impact: Math.min(16, ratio * 25),
      });
    } else {
      findings.push({
        id: 'virtuoso/blades/premature',
        checkId: 'virtuoso/blades',
        severity: 'good',
        title: 'Every Bladesong was spent at full stacks',
        summary: `All ${spends.length} damaging Bladesongs consumed five Blades, so Infinite Forge refunded on each one.`,
      });
    }

    const cappedMs = timeline.uptimeMs(window, FULL_STOCK);
    const cappedShare = cappedMs / fightMs;
    if (cappedShare > 0.1) {
      const cappedWindows = timeline
        .activeWindows(window, FULL_STOCK)
        .sort((a, b) => b.end - b.start - (a.end - a.start));
      findings.push({
        id: 'virtuoso/blades/capped',
        checkId: 'virtuoso/blades',
        severity: cappedShare > 0.25 ? 'warning' : 'info',
        title: `Capped at five Blades for ${duration(cappedMs)}`,
        summary: `You spent ${percent(cappedShare)} of the fight at the Blade cap. Every Blade generated while capped is thrown away.`,
        fix: 'When you hit five, spend a Bladesong promptly. Waiting for a "better" moment while capped wastes the generation from your dagger skills and bleeds.',
        metrics: [
          {
            label: 'Time at cap',
            display: percent(cappedShare),
            value: cappedShare * 100,
            target: 10,
            higherIsBetter: false,
          },
        ],
        evidence: cappedWindows.slice(0, 5).map((w) => ({
          time: w.start,
          label: `Capped for ${duration(w.end - w.start)} from ${timestamp(w.start)}`,
        })),
        impact: Math.min(10, cappedShare * 20),
      });
    }

    return findings;
  },
};
