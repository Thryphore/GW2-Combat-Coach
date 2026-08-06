import { cached } from './cache.ts';

const WINGMAN_API = 'https://gw2wingman.nevermindcreations.de/api';
const WINGMAN_HOST = 'https://gw2wingman.nevermindcreations.de';

/** Boss list changes rarely. */
const BOSSES_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Patch-top records move; keep this short enough to notice new records. */
const BOSS_STATS_TTL_MS = 6 * 60 * 60 * 1000;

export class WingmanTopLogError extends Error {}

export interface WingmanBossInfo {
  name: string;
  displayName?: string;
  short?: string;
  targetIDs?: number[];
  altLanguageTargets?: Record<string, string[]>;
  hasCM?: boolean;
  onlyCM?: boolean;
  type?: string;
}

export interface TopProfessionLog {
  /** Signed Wingman boss id (negative for challenge mode). */
  bossId: number;
  profession: string;
  dps: number;
  logId: string;
  playerName?: string;
  permalink: string;
  era: string;
}

interface BossStats {
  bossID?: string | number;
  era?: string;
  professions_top?: Record<string, number>;
  professions_top_Links?: Record<string, string>;
  professions_top_Names?: Record<string, string>;
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(cm|challenge mode|legendary challenge mode|lcm)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Picks the Wingman boss dictionary key for this encounter, if one exists. */
export function matchWingmanBossId(
  bosses: Record<string, WingmanBossInfo>,
  triggerId: number | undefined,
  fightName: string,
): number | undefined {
  if (triggerId && triggerId > 0) {
    if (bosses[String(triggerId)]) return triggerId;
    for (const [id, boss] of Object.entries(bosses)) {
      if (boss.targetIDs?.includes(triggerId)) {
        const numeric = Number(id);
        if (Number.isFinite(numeric) && numeric > 0) return numeric;
      }
    }
  }

  const wanted = normalizeName(fightName);
  if (!wanted) return undefined;

  let best: { id: number; score: number } | undefined;
  for (const [id, boss] of Object.entries(bosses)) {
    const numeric = Number(id);
    if (!Number.isFinite(numeric) || numeric <= 0) continue;

    const candidates = [
      boss.displayName,
      boss.name,
      boss.short,
      ...(boss.altLanguageTargets ? Object.keys(boss.altLanguageTargets) : []),
      ...(boss.altLanguageTargets ? Object.values(boss.altLanguageTargets).flat() : []),
    ].filter((name): name is string => !!name);

    for (const candidate of candidates) {
      const normalized = normalizeName(candidate);
      if (!normalized) continue;
      let score = 0;
      if (normalized === wanted) score = 100;
      else if (wanted.includes(normalized) || normalized.includes(wanted)) score = 80;
      else continue;
      // Prefer exact display/name matches over short codes.
      if (candidate === boss.displayName || candidate === boss.name) score += 5;
      if (!best || score > best.score) best = { id: numeric, score };
    }
  }

  return best && best.score >= 80 ? best.id : undefined;
}

/** Wingman uses a negative boss id for challenge mode. */
export function signedBossId(bossId: number, isCM: boolean): number {
  const absolute = Math.abs(bossId);
  return isCM ? -absolute : absolute;
}

export function topLogPermalink(logId: string): string {
  return `${WINGMAN_HOST}/log/${encodeURIComponent(logId)}`;
}

export function pickTopProfessionLog(
  stats: BossStats,
  profession: string,
  bossId: number,
): TopProfessionLog | undefined {
  const link = stats.professions_top_Links?.[profession];
  const dps = stats.professions_top?.[profession];
  if (!link || !dps || dps <= 0) return undefined;

  return {
    bossId,
    profession,
    dps,
    logId: link,
    playerName: stats.professions_top_Names?.[profession],
    permalink: topLogPermalink(link),
    era: stats.era ?? 'this',
  };
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new WingmanTopLogError('Could not reach GW2 Wingman.');
  }
  if (!response.ok) {
    throw new WingmanTopLogError(`GW2 Wingman returned HTTP ${response.status}.`);
  }
  return (await response.json()) as T;
}

export async function fetchWingmanBosses(signal?: AbortSignal): Promise<Record<string, WingmanBossInfo>> {
  return cached('wingman:bosses', BOSSES_TTL_MS, () =>
    fetchJson<Record<string, WingmanBossInfo>>(`${WINGMAN_API}/bosses`, signal),
  );
}

export async function fetchWingmanBossStats(
  bossId: number,
  era = 'this',
  signal?: AbortSignal,
): Promise<BossStats> {
  const params = new URLSearchParams({ bossID: String(bossId), era });
  return cached(`wingman:boss:${bossId}:${era}`, BOSS_STATS_TTL_MS, () =>
    fetchJson<BossStats>(`${WINGMAN_API}/boss?${params}`, signal),
  );
}

/**
 * Resolves the current-patch highest-damage log on Wingman for this fight and
 * elite specialization. Returns undefined when the encounter or profession has
 * no public top record.
 */
export async function resolveTopProfessionLog(options: {
  triggerId?: number;
  fightName: string;
  isCM: boolean;
  profession: string;
  signal?: AbortSignal;
}): Promise<TopProfessionLog | undefined> {
  const bosses = await fetchWingmanBosses(options.signal);
  const matched = matchWingmanBossId(bosses, options.triggerId, options.fightName);
  if (matched === undefined) return undefined;

  const bossId = signedBossId(matched, options.isCM);
  const stats = await fetchWingmanBossStats(bossId, 'this', options.signal);
  return pickTopProfessionLog(stats, options.profession, bossId);
}
