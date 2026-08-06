import { fetchEliteInsightsJson, type FetchProgress } from '../api/fetchLog.ts';
import { fetchSkillsLive, loadSkillIndex, SkillIndex } from '../api/gw2.ts';
import { autoSelectRaidReference, type RaidBuildCandidate } from '../api/metabattle.ts';
import { parseLogInput } from '../api/logSource.ts';
import { resolveTopProfessionLog, type TopProfessionLog } from '../api/wingmanTopLog.ts';
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

/** Current-patch top-damage log for the fight/class, kept out of default comparisons. */
export interface PatchTopLogBundle {
  meta: TopProfessionLog;
  log: NormalizedLog;
  player: NormalizedPlayer;
  /**
   * The user's log re-analyzed with the patch-top log as `reference`. Same
   * dialogue as a pasted reference log; the main report does not use this.
   */
  comparedResult: AnalysisResult;
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
  /**
   * Resolves to the current-patch top-damage log analysis when no reference was
   * provided. Never used as `reference` for the main report. May resolve to
   * undefined if Wingman has no record or the download fails.
   */
  patchTopPromise?: Promise<PatchTopLogBundle | undefined>;
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

  // Kick off Wingman patch-top discovery early when no reference was pasted.
  // The meta lookup stays out of the main analysis path entirely.
  const wantsPatchTop = !request.referenceLogInput?.trim();
  const patchTopMetaPromise = wantsPatchTop
    ? resolveTopProfessionLog({
        triggerId: log.triggerId,
        fightName: log.fightName,
        isCM: log.isCM,
        profession: player.profession,
        signal,
      }).catch((error) => {
        if (signal?.aborted) throw error;
        return undefined;
      })
    : Promise.resolve(undefined);

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

  // Download/analyze the top log in the background so the main report is not
  // blocked. Failures stay silent — the UI simply omits the side panels.
  const patchTopPromise = wantsPatchTop
    ? patchTopMetaPromise.then((meta) =>
        meta
          ? loadPatchTopLog({
              meta,
              log,
              player,
              skills,
              build,
              referenceBuild,
              signal,
            })
          : undefined,
      )
    : undefined;

  return {
    log,
    player,
    skills,
    build,
    referenceBuild,
    referenceAlternatives,
    referenceLog,
    referencePlayer,
    patchTopPromise,
    result,
    warnings,
  };
}

async function loadPatchTopLog(options: {
  meta: TopProfessionLog;
  log: NormalizedLog;
  player: NormalizedPlayer;
  skills: SkillIndex;
  build?: InferredBuild;
  referenceBuild?: ReferenceBuild;
  signal?: AbortSignal;
}): Promise<PatchTopLogBundle | undefined> {
  const { meta, log, player, skills, build, referenceBuild, signal } = options;
  try {
    // Same encounter and class already analyzed — nothing extra to show.
    if (meta.permalink === log.source.permalink || meta.logId === log.source.id) {
      return undefined;
    }

    const source = parseLogInput(meta.permalink);
    const raw = await fetchEliteInsightsJson(source, { signal });
    const topLog = normalizeLog(raw, source);
    const topPlayer =
      topLog.players.find((candidate) => candidate.profession === player.profession) ??
      pickDefaultPlayer(topLog);
    if (!topPlayer) return undefined;

    await enrichSkills(skills, castSkillIds(topPlayer));
    seedSkillsFromLog(skills, topLog);

    // Same path as a pasted reference log — but only exposed via the side panels.
    const comparedResult = runAnalysis({
      log,
      player,
      window: log.fullFight,
      skills,
      build,
      referenceBuild,
      reference: { log: topLog, player: topPlayer },
    });

    return { meta, log: topLog, player: topPlayer, comparedResult };
  } catch (error) {
    if (signal?.aborted) throw error;
    // Silent by design: the main report should look identical when this fails.
    return undefined;
  }
}
