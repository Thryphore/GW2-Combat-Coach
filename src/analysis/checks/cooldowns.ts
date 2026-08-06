import type { SkillIndex } from '../../api/gw2.ts';
import { findBuffId, type NormalizedLog, type NormalizedPlayer } from '../../model/normalize.ts';
import type { Interval } from '../../model/timeline.ts';
import { count, duration, timestamp } from '../format.ts';
import type { Check, Finding, Metric } from '../types.ts';

/** Skills below this recharge are effectively spammable and never "held". */
const MIN_RECHARGE_SEC = 4;
/** Slop below this is normal rotation sequencing, not a held cooldown. */
const MIN_IDLE_MS = 1500;
/** Alacrity recharges skills 25% faster, i.e. 80% of the base duration. */
const ALACRITY_RECHARGE_FACTOR = 0.8;

const TRACKED_SLOTS = /^(Weapon_[1-5]|Utility|Heal|Elite|Profession_[1-5])$/;

export interface SkillIdle {
  skillId: number;
  name: string;
  casts: number;
  idleMs: number;
  missedCasts: number;
  firstIdleAt: number;
  rechargeSec: number;
}

export interface CooldownHoldMeasurement {
  skills: SkillIdle[];
  totalMissed: number;
  missedPerMinute: number;
}

/**
 * Estimates how many casts were left on cooldown. Shared by the cooldown check
 * and the reference-log comparison.
 */
export function measureCooldownHolds(
  log: NormalizedLog,
  player: NormalizedPlayer,
  window: Interval,
  skills: SkillIndex,
): CooldownHoldMeasurement {
  const alacrityId = findBuffId(log, 'Alacrity');
  const alacrity = alacrityId === undefined ? undefined : player.buffs.get(alacrityId);
  const effectiveRecharge = (baseSec: number, from: number, to: number) => {
    const ratio = alacrity ? alacrity.uptimeRatio({ start: from, end: Math.max(to, from + 1) }) : 0;
    return baseSec * 1000 * (1 - (1 - ALACRITY_RECHARGE_FACTOR) * ratio);
  };

  const grouped = new Map<number, typeof player.casts>();
  for (const cast of player.casts) {
    if (cast.isAutoAttack || cast.isWeaponSwap) continue;
    const skill = skills.skill(cast.skillId);
    if (!skill?.rechargeSec || skill.rechargeSec < MIN_RECHARGE_SEC) continue;
    if (!skill.slot || !TRACKED_SLOTS.test(skill.slot)) continue;
    const list = grouped.get(cast.skillId) ?? [];
    list.push(cast);
    grouped.set(cast.skillId, list);
  }

  const idles: SkillIdle[] = [];
  for (const [skillId, casts] of grouped) {
    const skill = skills.skill(skillId);
    if (!skill?.rechargeSec) continue;

    let idleMs = 0;
    let missedCasts = 0;
    let firstIdleAt = 0;

    for (let i = 0; i < casts.length; i += 1) {
      const current = casts[i];
      const next = casts[i + 1];
      const until = next ? next.time : window.end;
      const recharge = effectiveRecharge(skill.rechargeSec, current.time, until);
      const idle = until - current.time - recharge;
      if (idle > MIN_IDLE_MS) {
        idleMs += idle;
        missedCasts += idle / recharge;
        if (firstIdleAt === 0) firstIdleAt = current.time + recharge;
      }
    }

    if (missedCasts >= 1) {
      idles.push({
        skillId,
        name: casts[0].name,
        casts: casts.length,
        idleMs,
        missedCasts,
        firstIdleAt,
        rechargeSec: skill.rechargeSec,
      });
    }
  }

  idles.sort((a, b) => b.missedCasts - a.missedCasts);
  const totalMissed = idles.reduce((total, entry) => total + entry.missedCasts, 0);
  const fightMinutes = Math.max(0.1, (window.end - window.start) / 60000);

  return {
    skills: idles,
    totalMissed,
    missedPerMinute: totalMissed / fightMinutes,
  };
}

/** Summary used when missed casts/min are within 0.75 of the reference — safe to hide in the main list. */
export const COOLDOWN_NORMAL_SUMMARY = 'Cooldown holds look normal for this fight.';

export const cooldownCheck: Check = {
  id: 'cooldowns',
  name: 'Cooldown usage',
  description:
    'Compares how often each skill was actually cast against how often its recharge allowed, adjusting for your Alacrity uptime.',

  applicable: ({ skills }) => (skills ? undefined : 'No GW2 skill data is available for this profession yet.'),

  run: ({ log, player, window, skills, reference }) => {
    if (!skills) return [];

    const measured = measureCooldownHolds(log, player, window, skills);
    const { skills: idles, totalMissed, missedPerMinute } = measured;
    if (idles.length === 0) return [];

    const sameProfession = reference && reference.player.profession === player.profession;
    const refMeasured =
      sameProfession && reference
        ? measureCooldownHolds(reference.log, reference.player, reference.log.fullFight, skills)
        : undefined;

    let severity: Finding['severity'] =
      missedPerMinute > 6 ? 'critical' : missedPerMinute > 3 ? 'warning' : 'info';
    if (refMeasured) {
      const delta = missedPerMinute - refMeasured.missedPerMinute;
      if (delta <= 0.75) severity = 'info';
      else if (delta > 2) severity = missedPerMinute > 6 ? 'critical' : 'warning';
    }

    const facts = `Across ${count(idles.length, 'skill')} you sat on recharged cooldowns long enough to fit roughly ${Math.round(totalMissed)} more casts (${missedPerMinute.toFixed(1)} per minute). The biggest was ${idles[0].name}.`;

    let summary: string;
    let tip: string;
    if (refMeasured) {
      const delta = missedPerMinute - refMeasured.missedPerMinute;
      if (delta <= 0.75) {
        summary = COOLDOWN_NORMAL_SUMMARY;
        tip = `${facts} The reference missed about ${refMeasured.missedPerMinute.toFixed(1)}/min — holding cooldowns at this rate looks normal for the fight.`;
      } else {
        summary = 'You are sitting on recharges more than the reference did.';
        tip = `${facts} The reference only missed about ${refMeasured.missedPerMinute.toFixed(1)}/min (${Math.round(refMeasured.totalMissed)} casts).`;
      }
    } else {
      summary = `About ${missedPerMinute.toFixed(1)} missed casts per minute, led by ${idles[0].name}.`;
      tip = facts;
    }

    const metrics: Metric[] = [];
    if (refMeasured) {
      const rateMax = Math.max(missedPerMinute, refMeasured.missedPerMinute, 0.01);
      const castMax = Math.max(totalMissed, refMeasured.totalMissed, 0.01);
      metrics.push(
        {
          label: 'Your missed casts/min',
          display: missedPerMinute.toFixed(1),
          value: missedPerMinute,
          target: refMeasured.missedPerMinute,
          barMax: rateMax,
          higherIsBetter: false,
        },
        {
          label: 'Reference missed casts/min',
          display: refMeasured.missedPerMinute.toFixed(1),
          value: refMeasured.missedPerMinute,
          target: refMeasured.missedPerMinute,
          barMax: rateMax,
          higherIsBetter: false,
        },
        {
          label: 'Your missed casts',
          display: Math.round(totalMissed).toString(),
          value: totalMissed,
          target: refMeasured.totalMissed,
          barMax: castMax,
          higherIsBetter: false,
        },
      );
    } else {
      metrics.push(
        {
          label: 'Your missed casts/min',
          display: missedPerMinute.toFixed(1),
          value: missedPerMinute,
          target: 2,
          higherIsBetter: false,
        },
        {
          label: 'Missed casts',
          display: Math.round(totalMissed).toString(),
          value: totalMissed,
          higherIsBetter: false,
        },
      );
    }

    return [
      {
        id: 'cooldowns/held',
        checkId: 'cooldowns',
        severity,
        title: `About ${Math.round(totalMissed)} casts left on cooldown`,
        summary,
        tip,
        detail:
          'This counts time where a skill had finished recharging but was not used. Holding a cooldown for a burst window or an incoming mechanic is legitimate, so read this as a list of candidates rather than a list of errors.',
        fix: refMeasured
          ? 'Work down this list one skill at a time. If the reference was casting them through the same phases, the holds are probably not fight-forced.'
          : 'Work down this list one skill at a time. For damage skills with short recharges, the default should be casting on cooldown unless you are deliberately saving them.',
        caveat: refMeasured
          ? 'Recharge uses the GW2 API base value adjusted by Alacrity in both logs. Traits and skills that reset cooldowns are not modelled. Rates are per minute so fight length does not dominate.'
          : 'Recharge is taken from the GW2 API base value and adjusted by your Alacrity uptime. Traits, relics, and skills that reset cooldowns are not modelled, so a skill like a phantasm refreshed by a signet can look overdue when it was not.',
        metrics,
        evidence: idles.slice(0, 6).map((entry) => ({
          time: entry.firstIdleAt,
          label: `${entry.name}: cast ${entry.casts}x, about ${Math.round(entry.missedCasts)} more possible`,
          detail: `${entry.rechargeSec}s recharge, ${duration(entry.idleMs)} idle, first available again at ${timestamp(entry.firstIdleAt)}`,
        })),
        impact: Math.min(15, missedPerMinute * 2),
      } satisfies Finding,
    ];
  },
};
