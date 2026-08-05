import type { ReferenceBuild } from '../model/build.ts';
import { findBuffId, type NormalizedLog, type NormalizedPlayer } from '../model/normalize.ts';

/** Group-support chronoboons. Pure DPS builds are not graded on these. */
export const SUPPORT_CHRONO_BOONS = ['Alacrity', 'Quickness'] as const;

/** Offensive boons every role still cares about on their own bar. */
export const PERSONAL_OFFENSE_BOONS = ['Fury', 'Might'] as const;

/** Full set a support is expected to keep up when they provide them. */
export const SUPPORT_UPKEEP_BOONS = [...SUPPORT_CHRONO_BOONS, ...PERSONAL_OFFENSE_BOONS] as const;

/** Squad/group generation at or above this counts as providing the boon. */
const SUPPORT_GENERATION_THRESHOLD = 10;

export function isSupportBuildName(name: string | undefined): boolean {
  if (!name) return false;
  return /\b(support|healer)\b/i.test(name);
}

/** True when the player (or their MetaBattle raid build) is a boon/heal support. */
export function isSupportRole(
  log: NormalizedLog,
  player: NormalizedPlayer,
  referenceBuild?: ReferenceBuild,
): boolean {
  if (isSupportBuildName(referenceBuild?.name)) return true;

  for (const name of SUPPORT_CHRONO_BOONS) {
    const id = findBuffId(log, name);
    if (id === undefined) continue;
    if ((player.buffGeneration.get(id) ?? 0) >= SUPPORT_GENERATION_THRESHOLD) return true;
  }
  return false;
}

/**
 * Boons to surface in coaching and the fight timeline.
 * Supports get the full upkeep set; DPS only get personal offensive boons.
 */
export function boonsForRole(
  log: NormalizedLog,
  player: NormalizedPlayer,
  referenceBuild?: ReferenceBuild,
): readonly string[] {
  return isSupportRole(log, player, referenceBuild) ? SUPPORT_UPKEEP_BOONS : PERSONAL_OFFENSE_BOONS;
}
