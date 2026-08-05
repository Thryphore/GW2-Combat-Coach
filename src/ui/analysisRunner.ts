import { fetchEliteInsightsJson, type FetchProgress } from '../api/fetchLog.ts';
import { fetchSkillsLive, loadSkillIndex, SkillIndex } from '../api/gw2.ts';
import { autoSelectRaidReference, type RaidBuildCandidate } from '../api/metabattle.ts';
import { parseLogInput } from '../api/logSource.ts';
import { isSupportRole } from '../analysis/boonRole.ts';
import { runAnalysis } from '../analysis/engine.ts';
import type { AnalysisResult } from '../analysis/types.ts';
import {
  inferBuild,
  seedSkillsFromLog,
  weaponSkillsFromWeapons,
  type InferredBuild,
  type ReferenceBuild,
} from '../model/build.ts';
import { normalizeLog, pickDefaultPlayer, type NormalizedLog, type NormalizedPlayer } from '../model/normalize.ts';

export interface AnalysisRequest {
  logInput: string;
  referenceLogInput?: string;
  playerName?: string;
  /** When set, forces this MetaBattle raid page instead of the automatic pick. */
  referenceBuildPage?: string;
}

export interface AnalysisBundle {
  log: NormalizedLog;
  player: NormalizedPlayer;
  skills?: SkillIndex;
  build?: InferredBuild;
  referenceBuild?: ReferenceBuild;
  /** Other MetaBattle raid builds for this elite spec, after the automatic pick. */
  referenceAlternatives: RaidBuildCandidate[];
  referenceLog?: NormalizedLog;
  referencePlayer?: NormalizedPlayer;
  result: AnalysisResult;
  /** Non-fatal problems worth surfacing, such as a reference build failing to load. */
  warnings: string[];
}

export interface RunnerProgress {
  label: string;
  detail?: string;
}

export interface RunOptions {
  signal?: AbortSignal;
  onProgress?: (progress: RunnerProgress) => void;
}

function describeFetch(progress: FetchProgress, what: string): RunnerProgress {
  if (progress.stage === 'cached') return { label: `Loading ${what}`, detail: 'From local cache' };
  if (progress.stage === 'parsing') return { label: `Parsing ${what}`, detail: 'Reading the encounter data' };
  const mb = progress.bytesReceived / (1024 * 1024);
  const total = progress.bytesTotal ? ` of ${(progress.bytesTotal / (1024 * 1024)).toFixed(1)} MB` : '';
  return {
    label: `Downloading ${what}`,
    detail: progress.stage === 'connecting' ? 'Contacting the log host' : `${mb.toFixed(1)} MB${total}`,
  };
}

/** Fills in metadata for skills the shipped snapshot does not cover. */
async function enrichSkills(skills: SkillIndex, ids: Iterable<number>): Promise<void> {
  const missing = [...new Set(ids)].filter((id) => Number.isFinite(id) && id > 0 && !skills.skill(id));
  if (missing.length === 0) return;
  const fetched = await fetchSkillsLive(missing);
  skills.addSkills(fetched);
}

function castSkillIds(player: NormalizedPlayer): number[] {
  return player.casts.map((cast) => cast.skillId);
}

export async function runAnalysisRequest(
  request: AnalysisRequest,
  { signal, onProgress }: RunOptions = {},
): Promise<AnalysisBundle> {
  const warnings: string[] = [];

  const source = parseLogInput(request.logInput);
  const raw = await fetchEliteInsightsJson(source, {
    signal,
    onProgress: (progress) => onProgress?.(describeFetch(progress, 'your log')),
  });

  onProgress?.({ label: 'Normalizing the log' });
  const log = normalizeLog(raw, source);

  const player =
    (request.playerName && log.players.find((p) => p.name === request.playerName || p.account === request.playerName)) ||
    pickDefaultPlayer(log);
  if (!player) throw new Error('That log contains no players to analyze.');

  onProgress?.({ label: 'Loading skill data', detail: player.profession });
  let skills = await loadSkillIndex(player.profession);
  if (!skills) {
    warnings.push(
      `No GW2 skill snapshot is bundled for ${player.profession} yet, so profession-specific metadata is limited.`,
    );
    skills = SkillIndex.empty(player.profession);
  }

  // Live API first so thin EI stubs cannot block richer skill records.
  await enrichSkills(skills, castSkillIds(player));
  seedSkillsFromLog(skills, log);

  const build = inferBuild(log, player, skills);

  let referenceBuild: ReferenceBuild | undefined;
  let referenceAlternatives: RaidBuildCandidate[] = [];
  onProgress?.({ label: 'Choosing a MetaBattle raid build', detail: player.profession });
  try {
    const selection = await autoSelectRaidReference(
      player.profession,
      player,
      skills,
      request.referenceBuildPage,
      isSupportRole(log, player),
    );
    referenceBuild = selection.chosen;
    referenceAlternatives = selection.alternatives;
    if (referenceBuild && !referenceBuild.weaponSkills?.length) {
      referenceBuild = {
        ...referenceBuild,
        weaponSkills: weaponSkillsFromWeapons(referenceBuild.weapons, skills),
      };
    }
  } catch (error) {
    warnings.push(
      `A MetaBattle raid reference build could not be chosen: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  let referenceLog: NormalizedLog | undefined;
  let referencePlayer: NormalizedPlayer | undefined;
  if (request.referenceLogInput?.trim()) {
    try {
      const referenceSource = parseLogInput(request.referenceLogInput);
      const referenceRaw = await fetchEliteInsightsJson(referenceSource, {
        signal,
        onProgress: (progress) => onProgress?.(describeFetch(progress, 'the reference log')),
      });
      referenceLog = normalizeLog(referenceRaw, referenceSource);
      referencePlayer =
        referenceLog.players.find((candidate) => candidate.profession === player.profession) ??
        pickDefaultPlayer(referenceLog);
      if (referencePlayer) {
        await enrichSkills(skills, castSkillIds(referencePlayer));
        seedSkillsFromLog(skills, referenceLog);
      }
    } catch (error) {
      warnings.push(
        `The reference log could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  onProgress?.({ label: 'Running checks' });
  const result = runAnalysis({
    log,
    player,
    window: log.fullFight,
    skills,
    build,
    referenceBuild,
    reference: referenceLog && referencePlayer ? { log: referenceLog, player: referencePlayer } : undefined,
  });

  return {
    log,
    player,
    skills,
    build,
    referenceBuild,
    referenceAlternatives,
    referenceLog,
    referencePlayer,
    result,
    warnings,
  };
}
