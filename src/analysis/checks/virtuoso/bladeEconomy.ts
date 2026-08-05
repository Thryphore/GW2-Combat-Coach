import type { SkillIndex } from '../../../api/gw2.ts';
import { findBladeBuffId, findBuffId, type NormalizedLog, type NormalizedPlayer } from '../../../model/normalize.ts';
import { count, duration, percent, timestamp } from '../../format.ts';
import type { Check, Finding } from '../../types.ts';

/** Virtuoso stocks five Blades, and Infinite Forge refunds two on a full spend. */
const FULL_STOCK = 5;
/** Alacrity recharges skills 25% faster, i.e. 80% of the base duration. */
const ALACRITY_RECHARGE_FACTOR = 0.8;
const F5_RECHARGE_FALLBACK_SEC = 30;

/**
 * Maps a cast to Profession_1–5 (F1–F5). Prefers the skill snapshot slot, then
 * falls back to English Bladesong / Bladeturn names for logs without skill data.
 */
function fSlot(skills: SkillIndex | undefined, skillId: number, name: string): number | undefined {
  const slot = skills?.skill(skillId)?.slot;
  const fromSlot = slot ? /^Profession_([1-5])$/.exec(slot) : null;
  if (fromSlot) return Number(fromSlot[1]);

  if (/^Bladesong Harmony$/i.test(name)) return 1;
  if (/^Bladesong Sorrow$/i.test(name)) return 2;
  if (/^Bladesong Dissonance$/i.test(name)) return 3;
  if (/^Bladesong Distortion$/i.test(name)) return 4;
  if (/^(Bladeturn Requiem|Bladeturn Refrain)$/i.test(name)) return 5;
  return undefined;
}

function isF4(slot: number | undefined): boolean {
  return slot === 4;
}

function isF5(slot: number | undefined): boolean {
  return slot === 5;
}

/**
 * Skills that stock a Blade on Virtuoso (clone summons become blades).
 * Excludes F skills, which consume blades rather than generate them.
 */
function wouldGenerateBlade(
  skills: SkillIndex | undefined,
  skillId: number,
  name: string,
  slot: number | undefined,
): boolean {
  if (slot !== undefined) return false;
  const info = skills?.skill(skillId);
  if (info?.categories?.includes('Clone')) return true;
  const description = info?.description?.toLowerCase() ?? '';
  if (/summon a clone|create a clone|stock a blade/.test(description)) return true;
  return /^(Decoy|Mirror Images|Illusionary Leap|Illusionary Riposte|Illusionary Counter|Ether Clone|Phase Retreat|Bladecall|Blade Leap|Feigned Surge|Imminent Voyage|Journey)$/i.test(
    name,
  );
}

function f5ReadyAt(
  log: NormalizedLog,
  player: NormalizedPlayer,
  skills: SkillIndex | undefined,
  timelineEnd: number,
  time: number,
): boolean {
  const f5Casts = player.casts
    .filter((cast) => isF5(fSlot(skills, cast.skillId, cast.name)))
    .sort((a, b) => a.time - b.time);
  const previous = [...f5Casts].reverse().find((cast) => cast.time <= time);
  if (!previous) return true;

  const info = skills?.skill(previous.skillId);
  const baseSec = info?.rechargeSec && info.rechargeSec > 0 ? info.rechargeSec : F5_RECHARGE_FALLBACK_SEC;
  const alacrityId = findBuffId(log, 'Alacrity');
  const alacrity = alacrityId === undefined ? undefined : player.buffs.get(alacrityId);
  const until = Math.min(timelineEnd, time);
  const ratio = alacrity ? alacrity.uptimeRatio({ start: previous.time, end: Math.max(until, previous.time + 1) }) : 0;
  const rechargeMs = baseSec * 1000 * (1 - (1 - ALACRITY_RECHARGE_FACTOR) * ratio);
  return previous.time + rechargeMs <= time;
}

export const bladeEconomyCheck: Check = {
  id: 'virtuoso/blades',
  name: 'Blade economy',
  description:
    'Checks F-skill Blade spends at five stacks, early non-F4 spends, and Blade generation wasted while capped.',
  professions: ['Virtuoso'],

  applicable: ({ log, player, skills }) => {
    if (findBladeBuffId(log) === undefined) {
      return 'This log does not track the Blades stack, so blade economy cannot be measured.';
    }
    const hasFSkills = player.casts.some((cast) => fSlot(skills, cast.skillId, cast.name) !== undefined);
    return hasFSkills ? undefined : 'No Virtuoso F skills were cast in this log.';
  },

  run: ({ log, player, window, skills }) => {
    const buffId = findBladeBuffId(log);
    if (buffId === undefined) return [];
    const timeline = player.buffs.get(buffId);
    if (!timeline) return [];

    const fCasts = player.casts
      .map((cast) => {
        const slot = fSlot(skills, cast.skillId, cast.name);
        if (slot === undefined) return null;
        return {
          cast,
          slot,
          // Sample just before the cast so the spend itself is not counted.
          stacks: timeline.stacksAt(cast.time - 1),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    if (fCasts.length === 0) return [];

    const findings: Finding[] = [];
    const fullStack = fCasts.filter((entry) => entry.stacks >= FULL_STOCK);
    const premature = fCasts.filter((entry) => entry.stacks < FULL_STOCK && !isF4(entry.slot));
    const f4Early = fCasts.filter((entry) => entry.stacks < FULL_STOCK && isF4(entry.slot));

    if (premature.length > 0) {
      const ratio = premature.length / Math.max(1, fCasts.length - f4Early.length);
      const bladesLost = premature.reduce((total, spend) => total + (FULL_STOCK - spend.stacks), 0);
      findings.push({
        id: 'virtuoso/blades/premature',
        checkId: 'virtuoso/blades',
        severity: ratio > 0.4 ? 'critical' : 'warning',
        title: `${count(premature.length, 'F skill')} fired below five Blades`,
        summary: `${premature.length} of ${fCasts.length - f4Early.length} non-F4 F skills went out under a full stack, spending ${bladesLost} fewer Blades than they could have. ${fullStack.length} of ${fCasts.length} F skills were cast at five.`,
        detail:
          'Bladesong damage scales with the Blades it consumes, and Infinite Forge only refunds Blades when you spend a full stack of five. F4 (Bladesong Distortion) is left out of this warning — it is often pressed for the distortion, not a full spend.',
        fix: 'Hold F1–F3 and F5 until the counter reads five unless you specifically need F4 for defense.',
        metrics: [
          {
            label: 'F skills at five',
            display: `${fullStack.length} / ${fCasts.length}`,
            value: (fullStack.length / fCasts.length) * 100,
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
          label: `F${spend.slot} ${spend.cast.name} at ${timestamp(spend.cast.time)} with ${count(spend.stacks, 'Blade')}`,
        })),
        impact: Math.min(16, ratio * 25),
      });
    } else {
      findings.push({
        id: 'virtuoso/blades/premature',
        checkId: 'virtuoso/blades',
        severity: 'good',
        title:
          fullStack.length === fCasts.length
            ? 'Every F skill was spent at five Blades'
            : 'No early F spends outside of F4',
        summary:
          fullStack.length === fCasts.length
            ? `All ${fCasts.length} F skills consumed five Blades.`
            : `${fullStack.length} of ${fCasts.length} F skills were at five; the rest were F4 (Bladesong Distortion), which is fine below a full stack.`,
        metrics: [
          {
            label: 'F skills at five',
            display: `${fullStack.length} / ${fCasts.length}`,
            value: (fullStack.length / fCasts.length) * 100,
            target: 100,
          },
        ],
      });
    }

    const wastedGen = player.casts
      .map((cast) => {
        const slot = fSlot(skills, cast.skillId, cast.name);
        if (!wouldGenerateBlade(skills, cast.skillId, cast.name, slot)) return null;
        if (timeline.stacksAt(cast.time - 1) < FULL_STOCK) return null;
        if (cast.time < window.start || cast.time > window.end) return null;
        return cast;
      })
      .filter((cast): cast is NonNullable<typeof cast> => cast !== null);

    if (wastedGen.length > 0) {
      const withF5Ready = wastedGen.filter((cast) =>
        f5ReadyAt(log, player, skills, window.end, cast.time),
      );
      const cappedMs = timeline.uptimeMs(window, FULL_STOCK);
      const fightMs = Math.max(1, window.end - window.start);

      findings.push({
        id: 'virtuoso/blades/wasted-gen',
        checkId: 'virtuoso/blades',
        severity: 'info',
        title: `${count(wastedGen.length, 'skill')} generated a Blade while already at five`,
        summary: `${wastedGen.length} casts that stock Blades landed while you were already capped. Those Blades are thrown away.`,
        detail: `You were also at five Blades for ${duration(cappedMs)} (${percent(cappedMs / fightMs)} of the fight).`,
        fix: 'When you hit five, spend promptly — F5 (Bladeturn Requiem) is instant and a clean dump if your damaging Bladesongs are not ready.',
        metrics: [
          {
            label: 'Wasted generators',
            display: String(wastedGen.length),
            value: wastedGen.length,
            higherIsBetter: false,
          },
          {
            label: 'Time at cap',
            display: percent(cappedMs / fightMs),
            value: (cappedMs / fightMs) * 100,
            target: 10,
            higherIsBetter: false,
          },
        ],
        insights: [
          {
            title: 'F5 was ready',
            summary:
              withF5Ready.length === 0
                ? 'None of those wasted generations happened while Bladeturn Requiem (F5) was off cooldown.'
                : `${withF5Ready.length} of ${wastedGen.length} happened while F5 was available. Bladeturn Requiem is instant — dumping there avoids sitting capped.`,
            metrics: [
              {
                label: 'While F5 ready',
                display: `${withF5Ready.length} / ${wastedGen.length}`,
                value: (withF5Ready.length / wastedGen.length) * 100,
                higherIsBetter: false,
              },
            ],
          },
        ],
        evidence: wastedGen.slice(0, 8).map((cast) => ({
          time: cast.time,
          label: `${cast.name} at ${timestamp(cast.time)} while capped${
            f5ReadyAt(log, player, skills, window.end, cast.time) ? ' · F5 ready' : ''
          }`,
        })),
        impact: Math.min(8, wastedGen.length * 0.8),
      });
    }

    return findings;
  },
};
