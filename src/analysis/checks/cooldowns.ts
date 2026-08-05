import { findBuffId } from '../../model/normalize.ts';
import { count, duration, timestamp } from '../format.ts';
import type { Check, Finding } from '../types.ts';

/** Skills below this recharge are effectively spammable and never "held". */
const MIN_RECHARGE_SEC = 4;
/** Slop below this is normal rotation sequencing, not a held cooldown. */
const MIN_IDLE_MS = 1500;
/** Alacrity recharges skills 25% faster, i.e. 80% of the base duration. */
const ALACRITY_RECHARGE_FACTOR = 0.8;

const TRACKED_SLOTS = /^(Weapon_[1-5]|Utility|Heal|Elite|Profession_[1-5])$/;

interface SkillIdle {
  skillId: number;
  name: string;
  casts: number;
  idleMs: number;
  missedCasts: number;
  firstIdleAt: number;
  rechargeSec: number;
}

export const cooldownCheck: Check = {
  id: 'cooldowns',
  name: 'Cooldown usage',
  description:
    'Compares how often each skill was actually cast against how often its recharge allowed, adjusting for your Alacrity uptime.',

  applicable: ({ skills }) => (skills ? undefined : 'No GW2 skill data is available for this profession yet.'),

  run: ({ log, player, window, skills }) => {
    if (!skills) return [];

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

    if (idles.length === 0) return [];

    idles.sort((a, b) => b.missedCasts - a.missedCasts);
    const totalMissed = idles.reduce((total, entry) => total + entry.missedCasts, 0);
    const fightMinutes = Math.max(0.1, (window.end - window.start) / 60000);
    const missedPerMinute = totalMissed / fightMinutes;

    const severity = missedPerMinute > 6 ? 'critical' : missedPerMinute > 3 ? 'warning' : 'info';

    return [
      {
        id: 'cooldowns/held',
        checkId: 'cooldowns',
        severity,
        title: `About ${Math.round(totalMissed)} casts left on cooldown`,
        summary: `Across ${count(idles.length, 'skill')} you sat on recharged cooldowns long enough to fit roughly ${Math.round(totalMissed)} more casts (${missedPerMinute.toFixed(1)} per minute). The biggest was ${idles[0].name}.`,
        detail:
          'This counts time where a skill had finished recharging but was not used. Holding a cooldown for a burst window or an incoming mechanic is legitimate, so read this as a list of candidates rather than a list of errors.',
        fix: 'Work down this list one skill at a time. For damage skills with short recharges, the default should be casting on cooldown unless you are deliberately saving them.',
        caveat:
          'Recharge is taken from the GW2 API base value and adjusted by your Alacrity uptime. Traits, relics, and skills that reset cooldowns are not modelled, so a skill like a phantasm refreshed by a signet can look overdue when it was not.',
        metrics: [
          {
            label: 'Missed casts',
            display: Math.round(totalMissed).toString(),
            value: totalMissed,
            higherIsBetter: false,
          },
          {
            label: 'Per minute',
            display: missedPerMinute.toFixed(1),
            value: missedPerMinute,
            target: 2,
            higherIsBetter: false,
          },
        ],
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
