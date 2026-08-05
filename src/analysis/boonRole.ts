import type { ReferenceBuild } from '../model/build.ts';
import { findBuffId, type NormalizedLog, type NormalizedPlayer } from '../model/normalize.ts';

/** Group-support chronoboons. Pure DPS builds are not graded on these. */
export const SUPPORT_CHRONO_BOONS = ['Alacrity', 'Quickness'] as const;

/** Squad/group generation at or above this counts as providing the boon. */
const SUPPORT_GENERATION_THRESHOLD = 10;

export function isSupportBuildName(name: string | undefined): boolean {
  if (!name) return false;
  return /\b(support|healer)\b/i.test(name);
}

function generatesChronoboon(
  log: NormalizedLog,
  player: NormalizedPlayer,
  name: (typeof SUPPORT_CHRONO_BOONS)[number],
): boolean {
  const id = findBuffId(log, name);
  if (id === undefined) return false;
  return (player.buffGeneration.get(id) ?? 0) >= SUPPORT_GENERATION_THRESHOLD;
}

/** True when the player (or their MetaBattle raid build) is a boon/heal support. */
export function isSupportRole(
  log: NormalizedLog,
  player: NormalizedPlayer,
  referenceBuild?: ReferenceBuild,
): boolean {
  if (isSupportBuildName(referenceBuild?.name)) return true;

  for (const name of SUPPORT_CHRONO_BOONS) {
    if (generatesChronoboon(log, player, name)) return true;
  }
  return false;
}

/**
 * Chronoboons this player is expected to keep up.
 * Uses the MetaBattle title when it names Alacrity or Quickness; otherwise uses
 * squad generation. DPS and non-providers get an empty list.
 */
export function boonsForRole(
  log: NormalizedLog,
  player: NormalizedPlayer,
  referenceBuild?: ReferenceBuild,
): readonly string[] {
  if (!isSupportRole(log, player, referenceBuild)) return [];

  const title = referenceBuild?.name ?? '';
  const namedAlacrity = /\balacrity\b/i.test(title);
  const namedQuickness = /\bquickness\b/i.test(title);

  if (namedAlacrity || namedQuickness) {
    const named: string[] = [];
    if (namedAlacrity) named.push('Alacrity');
    if (namedQuickness) named.push('Quickness');
    return named;
  }

  return SUPPORT_CHRONO_BOONS.filter((name) => generatesChronoboon(log, player, name));
}
