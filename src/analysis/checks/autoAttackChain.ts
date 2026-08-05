import type { SkillIndex } from '../../api/gw2.ts';
import type { NormalizedPlayer } from '../../model/normalize.ts';
import { count, duration, percent, timestamp } from '../format.ts';
import type { Check, Evidence, Finding } from '../types.ts';

/** Auto chains lapse on their own after a few idle seconds; that is not a mistake. */
const CHAIN_TIMEOUT_MS = 4000;

export interface AutoChainMeasurement {
  attempts: number;
  completed: number;
  completionRate: number;
  drops: Evidence[];
  abortedCount: number;
  abortedMs: number;
}

/** Measures auto-attack chain completion for a player. */
export function measureAutoAttackChains(
  player: NormalizedPlayer,
  skills: SkillIndex,
): AutoChainMeasurement {
  const autos = player.casts.filter((cast) => cast.isAutoAttack && skills.chainPosition(cast.skillId));
  if (autos.length < 4) {
    return { attempts: 0, completed: 0, completionRate: 1, drops: [], abortedCount: 0, abortedMs: 0 };
  }

  const swapTimes = player.casts.filter((cast) => cast.isWeaponSwap).map((cast) => cast.time);
  const swappedBetween = (from: number, to: number) => swapTimes.some((t) => t >= from && t <= to);

  let started = 0;
  let completed = 0;
  const drops: Evidence[] = [];

  for (let i = 0; i < autos.length; i += 1) {
    const cast = autos[i];
    const position = skills.chainPosition(cast.skillId);
    if (!position) continue;

    if (position.step === 1) started += 1;
    if (position.step === position.length) {
      completed += 1;
      continue;
    }

    const next = autos[i + 1];
    if (!next) break;
    const nextPosition = skills.chainPosition(next.skillId);
    if (!nextPosition) continue;

    if (nextPosition.rootId !== position.rootId) continue;
    if (next.time - cast.endTime > CHAIN_TIMEOUT_MS) continue;
    if (swappedBetween(cast.time, next.time)) continue;
    if (nextPosition.step === position.step + 1) continue;

    if (nextPosition.step === 1) {
      const finalStep = skills.skill(position.nextId ?? 0)?.name;
      drops.push({
        time: cast.time,
        label: `${cast.name} (step ${position.step} of ${position.length}) restarted the chain`,
        detail: finalStep ? `${finalStep} never landed` : undefined,
      });
    }
  }

  const aborted = autos.filter((cast) => cast.timeGained < 0);
  const abortedMs = aborted.reduce((total, cast) => total + Math.abs(cast.timeGained), 0);
  const attempts = Math.max(started, completed);
  const completionRate = attempts > 0 ? Math.min(1, completed / attempts) : 1;

  return {
    attempts,
    completed,
    completionRate,
    drops,
    abortedCount: aborted.length,
    abortedMs,
  };
}

export const autoAttackChainCheck: Check = {
  id: 'auto-attack-chain',
  name: 'Auto-attack chains',
  description:
    'Follows the GW2 API chain graph to see whether multi-hit auto-attack chains reached their final, hardest-hitting step.',

  applicable: ({ player, skills }) => {
    if (!skills) return 'No GW2 skill data is available for this profession yet.';
    const hasChainedAuto = player.casts.some((cast) => cast.isAutoAttack && skills.chainPosition(cast.skillId));
    if (!hasChainedAuto) {
      return 'None of the weapons used have a chained auto-attack, so there is no chain to drop.';
    }
    return undefined;
  },

  run: ({ player, skills }) => {
    if (!skills) return [];

    const measured = measureAutoAttackChains(player, skills);
    if (measured.attempts === 0 && measured.abortedCount === 0) return [];

    const findings: Finding[] = [];
    const { attempts, completed, completionRate, drops, abortedCount, abortedMs } = measured;

    if (drops.length > 0) {
      const dropRate = attempts > 0 ? drops.length / attempts : 0;
      const severity = dropRate > 0.35 ? 'critical' : dropRate > 0.15 ? 'warning' : 'info';
      findings.push({
        id: 'auto-attack-chain/dropped',
        checkId: 'auto-attack-chain',
        severity,
        title: `${count(drops.length, 'auto-attack chain')} restarted before finishing`,
        summary: `You completed ${completed} of ${attempts} chains (${percent(completionRate)}). The final hit of an auto chain is the biggest one, so dropping back to the first step throws that damage away.`,
        detail:
          'A chain restart that is not caused by a weapon swap or a long pause usually means the animation was cut short by moving, dodging, or turning away from the target mid-swing.',
        fix: 'Let the chain finish before repositioning. If you need to move, do it during a skill you were going to cast anyway rather than mid-chain.',
        metrics: [
          {
            label: 'Chain completion',
            display: percent(completionRate),
            value: completionRate * 100,
            target: 90,
          },
          {
            label: 'Chains dropped',
            display: String(drops.length),
            value: drops.length,
            higherIsBetter: false,
          },
        ],
        evidence: drops.slice(0, 8),
        impact: Math.min(12, dropRate * 30),
      });
    } else if (attempts >= 5) {
      findings.push({
        id: 'auto-attack-chain/clean',
        checkId: 'auto-attack-chain',
        severity: 'good',
        title: 'Auto-attack chains finished cleanly',
        summary: `All ${attempts} chains reached their final step.`,
      });
    }

    if (abortedCount > 2) {
      const aborted = player.casts.filter(
        (cast) => cast.isAutoAttack && skills.chainPosition(cast.skillId) && cast.timeGained < 0,
      );
      findings.push({
        id: 'auto-attack-chain/aborted',
        checkId: 'auto-attack-chain',
        severity: abortedMs > 2000 ? 'warning' : 'info',
        title: `${count(abortedCount, 'auto-attack')} cancelled mid-swing`,
        summary: `${duration(abortedMs)} of auto-attack animation was started and then thrown away without the hit landing.`,
        fix: 'These are usually caused by moving or dodging right after pressing 1. Queue movement between attacks rather than during them.',
        metrics: [
          {
            label: 'Wasted auto-attack time',
            display: duration(abortedMs),
            value: abortedMs,
            higherIsBetter: false,
          },
        ],
        evidence: aborted.slice(0, 6).map((cast) => ({
          time: cast.time,
          label: `${cast.name} cancelled at ${timestamp(cast.time)}`,
          detail: `${Math.abs(cast.timeGained)}ms lost`,
        })),
        impact: Math.min(6, abortedMs / 1000),
      });
    }

    return findings;
  },
};
