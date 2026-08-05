import { fetchEliteInsightsJson, type FetchProgress } from '../api/fetchLog.ts';
import { fetchSkillsLive, loadSkillIndex, type SkillIndex } from '../api/gw2.ts';
import { fetchMetaBattleBuild, metaBattlePageFromInput } from '../api/metabattle.ts';
import { parseLogInput } from '../api/logSource.ts';
import { runAnalysis } from '../analysis/engine.ts';
import type { AnalysisResult } from '../analysis/types.ts';
import { inferBuild, type InferredBuild, type ReferenceBuild } from '../model/build.ts';
import { referenceBuildFromChatCode } from '../model/chatCode.ts';
import { normalizeLog, pickDefaultPlayer, type NormalizedLog, type NormalizedPlayer } from '../model/normalize.ts';

export type ReferenceBuildSelection =
  | { kind: 'none' }
  | { kind: 'metabattle'; page: string }
  | { kind: 'chat-code'; code: string };

export interface AnalysisRequest {
  logInput: string;
  referenceLogInput?: string;
  playerName?: string;
  referenceBuild: ReferenceBuildSelection;
}

export interface AnalysisBundle {
  log: NormalizedLog;
  player: NormalizedPlayer;
  skills?: SkillIndex;
  build?: InferredBuild;
  referenceBuild?: ReferenceBuild;
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
  if (progress.stage === 'parsing') return { label: `Parsing ${what}`, detail: 'Reading the encounter data' };
  const mb = progress.bytesReceived / (1024 * 1024);
  const total = progress.bytesTotal ? ` of ${(progress.bytesTotal / (1024 * 1024)).toFixed(1)} MB` : '';
  return {
    label: `Downloading ${what}`,
    detail: progress.stage === 'connecting' ? 'Contacting the log host' : `${mb.toFixed(1)} MB${total}`,
  };
}

/** Fills in metadata for skills the shipped snapshot does not cover. */
async function enrichSkills(skills: SkillIndex, player: NormalizedPlayer): Promise<void> {
  const missing = [...new Set(player.casts.map((cast) => cast.skillId))].filter((id) => !skills.skill(id));
  if (missing.length === 0) return;
  const fetched = await fetchSkillsLive(missing);
  skills.addSkills(fetched);
}

async function loadReferenceBuild(
  selection: ReferenceBuildSelection,
  skills: SkillIndex | undefined,
): Promise<ReferenceBuild | undefined> {
  if (selection.kind === 'none') return undefined;
  if (selection.kind === 'chat-code') {
    return referenceBuildFromChatCode(selection.code, skills, { name: 'Pasted build template' });
  }
  const page = metaBattlePageFromInput(selection.page) ?? selection.page;
  const parsed = await fetchMetaBattleBuild(page, skills);
  return parsed.build;
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
  const skills = await loadSkillIndex(player.profession);
  if (!skills) {
    warnings.push(
      `No GW2 skill data is bundled for ${player.profession} yet, so checks that need skill metadata were skipped.`,
    );
  } else {
    await enrichSkills(skills, player);
  }

  const build = skills ? inferBuild(log, player, skills) : undefined;

  let referenceBuild: ReferenceBuild | undefined;
  if (request.referenceBuild.kind !== 'none') {
    onProgress?.({ label: 'Loading the reference build' });
    try {
      referenceBuild = await loadReferenceBuild(request.referenceBuild, skills);
    } catch (error) {
      warnings.push(
        `The reference build could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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

  return { log, player, skills, build, referenceBuild, referenceLog, referencePlayer, result, warnings };
}
