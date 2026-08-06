import { autoAttackChainCheck } from './checks/autoAttackChain.ts';
import { boonUptimeCheck } from './checks/boonUptime.ts';
import { buildMatchCheck } from './checks/buildMatch.ts';
import { combosCheck } from './checks/combos.ts';
import { cooldownCheck } from './checks/cooldowns.ts';
import { downtimeCheck } from './checks/downtime.ts';
import { wastedCastsCheck } from './checks/wastedCasts.ts';
import { bladeEconomyCheck } from './checks/virtuoso/bladeEconomy.ts';
import { phantasmCheck } from './checks/virtuoso/phantasms.ts';
import { referenceLogCheck } from './compare.ts';
import { SEVERITY_ORDER, type AnalysisContext, type AnalysisResult, type Check, type Finding } from './types.ts';

/** Checks that apply to every profession. */
export const GENERIC_CHECKS: Check[] = [
  autoAttackChainCheck,
  wastedCastsCheck,
  downtimeCheck,
  boonUptimeCheck,
  combosCheck,
  cooldownCheck,
  buildMatchCheck,
  referenceLogCheck,
];

/** Keyed by the elite specialization name Elite Insights reports. */
export const PROFESSION_CHECKS: Record<string, Check[]> = {
  virtuoso: [bladeEconomyCheck, phantasmCheck],
};

export function checksFor(profession: string): Check[] {
  const specific = PROFESSION_CHECKS[profession.toLowerCase()] ?? [];
  return [...specific, ...GENERIC_CHECKS];
}

export function supportedProfessions(): string[] {
  return Object.keys(PROFESSION_CHECKS);
}

export function runAnalysis(context: AnalysisContext): AnalysisResult {
  const checks = checksFor(context.player.profession);
  const findings: Finding[] = [];
  const checksRun: Check[] = [];
  const checksSkipped: { check: Check; reason: string }[] = [];

  for (const check of checks) {
    const reason = check.applicable?.(context);
    if (reason) {
      checksSkipped.push({ check, reason });
      continue;
    }
    try {
      findings.push(...check.run(context));
      checksRun.push(check);
    } catch (error) {
      // One broken check should never take down the whole report.
      checksSkipped.push({
        check,
        reason: `The check failed to run: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  findings.sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return (b.impact ?? 0) - (a.impact ?? 0);
  });

  const penalty = findings.reduce((total, finding) => total + (finding.impact ?? 0), 0);
  const rawScore = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  const score = context.reference
    ? applyDamageScoreFloor(rawScore, context.player.dps, context.reference.player.dps)
    : rawScore;

  return { findings, score, checksRun, checksSkipped };
}

/**
 * Score cannot sit below the player's DPS as a percent of the reference
 * (capped at 100). Without a usable reference DPS, the raw score is unchanged.
 */
export function applyDamageScoreFloor(score: number, playerDps: number, referenceDps: number): number {
  if (!(referenceDps > 0)) return score;
  const damagePercent = Math.max(0, Math.min(100, Math.round((playerDps / referenceDps) * 100)));
  return Math.max(score, damagePercent);
}

export function scoreLabel(score: number): string {
  if (score >= 90) return 'Clean';
  if (score >= 75) return 'Solid';
  if (score >= 60) return 'Rough edges';
  if (score >= 40) return 'Needs work';
  return 'Lots to gain';
}
