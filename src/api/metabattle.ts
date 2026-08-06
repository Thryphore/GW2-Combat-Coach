import type { SkillIndex } from './gw2.ts';
import type { ReferenceBuild } from '../model/build.ts';
import type { NormalizedPlayer } from '../model/normalize.ts';
import { referenceBuildFromChatCode } from '../model/chatCode.ts';
import { cached } from './cache.ts';

const WIKI_API = 'https://metabattle.com/wiki/api.php';
const PAGE_BASE = 'https://metabattle.com/wiki/';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RAID_CATEGORY = 'Category:Raid builds';

export class MetaBattleError extends Error {}

export type DamageFocus = 'power' | 'condition' | 'unknown';

export interface RaidBuildCandidate {
  page: string;
  eliteSpec: string;
  /** The part of the page title after the elite spec, e.g. "Power DPS". */
  variant: string;
  score: number;
}

export interface AutoReferenceResult {
  chosen: ReferenceBuild;
  /** Other raid builds for the same elite spec, ranked after the chosen one. */
  alternatives: RaidBuildCandidate[];
  /** Every raid candidate considered for this elite spec. */
  candidates: RaidBuildCandidate[];
}

/** Extracts `{{Template|key = value|...}}` parameters, tolerating line breaks. */
function parseTemplate(wikitext: string, templateName: string): Record<string, string> | undefined {
  const pattern = new RegExp(`\\{\\{\\s*${templateName}\\s*([\\s\\S]*?)\\}\\}`, 'i');
  const match = pattern.exec(wikitext);
  if (!match) return undefined;

  const params: Record<string, string> = {};
  for (const part of match[1].split('|')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const value = part.slice(eq + 1).trim();
    if (key) params[key] = value;
  }
  return params;
}

function extractChatCode(wikitext: string): string | undefined {
  return /\[&[A-Za-z0-9+/=]+\]/.exec(wikitext)?.[0];
}

function weaponsFromSkillBar(params: Record<string, string> | undefined): string[] {
  if (!params) return [];
  const weapons: string[] = [];
  for (const key of ['weapon1', 'weapon2', 'weapon3', 'weapon4']) {
    const value = params[key];
    // Blank slots are written as an empty value or a literal "X".
    if (!value || value.toUpperCase() === 'X') continue;
    weapons.push(value);
  }
  return weapons;
}

export interface ParsedMetaBattlePage {
  title: string;
  url: string;
  build: ReferenceBuild;
  /** Gear line from the equipment template, if the page has one. */
  equipment?: { stats?: string; rune?: string; relic?: string };
}

export function parseMetaBattlePage(
  title: string,
  wikitext: string,
  skills: SkillIndex | undefined,
): ParsedMetaBattlePage {
  const url = PAGE_BASE + encodeURIComponent(title.replace(/ /g, '_'));
  const chatCode = extractChatCode(wikitext);
  if (!chatCode) {
    throw new MetaBattleError(
      `${title} does not publish a build template code, so its traits and skills cannot be read.`,
    );
  }

  const skillBar = parseTemplate(wikitext, 'Skill bar');
  const equipment = parseTemplate(wikitext, 'PvE equipment') ?? parseTemplate(wikitext, 'Equipment');
  const buildTemplate = parseTemplate(wikitext, 'Build');

  const build = referenceBuildFromChatCode(chatCode, skills, {
    name: title.replace(/^Build:/, ''),
    url,
    source: 'metabattle',
    weapons: weaponsFromSkillBar(skillBar),
    attribution: 'Build data from MetaBattle, licensed CC BY-NC-SA 3.0.',
  });

  if (buildTemplate?.specialization) {
    build.eliteSpec = buildTemplate.specialization.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  return {
    title,
    url,
    build,
    equipment: equipment
      ? { stats: equipment.stats, rune: equipment.rune, relic: equipment.relic }
      : undefined,
  };
}

async function fetchWikitext(page: string): Promise<string> {
  const url = `${WIKI_API}?action=parse&format=json&origin=*&prop=wikitext&page=${encodeURIComponent(page)}`;
  const response = await fetch(url);
  if (!response.ok) throw new MetaBattleError(`MetaBattle returned HTTP ${response.status} for "${page}".`);
  const data = (await response.json()) as {
    error?: { info?: string };
    parse?: { title?: string; wikitext?: { '*'?: string } };
  };
  if (data.error) throw new MetaBattleError(data.error.info ?? `MetaBattle could not load "${page}".`);
  const wikitext = data.parse?.wikitext?.['*'];
  if (!wikitext) throw new MetaBattleError(`MetaBattle returned no content for "${page}".`);
  return wikitext;
}

/** Loads a MetaBattle build page and turns its structured templates into a reference build. */
export async function fetchMetaBattleBuild(
  page: string,
  skills: SkillIndex | undefined,
): Promise<ParsedMetaBattlePage> {
  const wikitext = await cached(`metabattle:${page}`, TTL_MS, () => fetchWikitext(page));
  return parseMetaBattlePage(page, wikitext, skills);
}

/** Accepts a MetaBattle build URL or a raw page title. */
export function metaBattlePageFromInput(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (!url.hostname.toLowerCase().endsWith('metabattle.com')) return undefined;
      const path = decodeURIComponent(url.pathname.replace(/^\/wiki\//, ''));
      return path.replace(/_/g, ' ') || undefined;
    } catch {
      return undefined;
    }
  }
  return /^build:/i.test(trimmed) ? trimmed : undefined;
}

/** Splits a MetaBattle build page title into elite spec and variant. */
export function parseRaidBuildTitle(title: string): { eliteSpec: string; variant: string } | undefined {
  const match = /^Build:\s*(.+?)\s*-\s*(.+)$/i.exec(title.trim());
  if (!match) return undefined;
  return { eliteSpec: match[1].trim(), variant: match[2].trim() };
}

/**
 * Infers whether the log looks like a power or condition build from the share
 * of damage that Elite Insights marked as indirect.
 */
export function inferDamageFocus(player: NormalizedPlayer): DamageFocus {
  let direct = 0;
  let indirect = 0;
  for (const entry of player.damageBySkill.values()) {
    if (entry.indirect) indirect += entry.damage;
    else direct += entry.damage;
  }
  const total = direct + indirect;
  if (total <= 0) return 'unknown';
  const ratio = indirect / total;
  if (ratio >= 0.35) return 'condition';
  if (ratio <= 0.15) return 'power';
  return 'unknown';
}

export interface RaidBuildScoreOptions {
  focus?: DamageFocus;
  /** When true, prefer support/healer pages over pure DPS. */
  preferSupport?: boolean;
}

/** Ranks a raid-build variant for automatic selection. Higher is better. */
export function scoreRaidBuildVariant(
  variant: string,
  focusOrOptions: DamageFocus | RaidBuildScoreOptions = 'unknown',
): number {
  const options: RaidBuildScoreOptions =
    typeof focusOrOptions === 'string' ? { focus: focusOrOptions } : focusOrOptions;
  const focus = options.focus ?? 'unknown';
  const preferSupport = options.preferSupport === true;
  const text = variant.toLowerCase();
  // Category:Raid builds should already exclude these, but keep a hard filter.
  if (/\b(open world|pvp|spvp|wvw)\b/.test(text)) return Number.NEGATIVE_INFINITY;

  let score = 100;
  const isSupport = /\bsupport\b/.test(text);
  const isHealer = /\bhealer\b/.test(text);

  if (/\b(hand )?kiter\b/.test(text)) score -= 90;

  if (preferSupport) {
    if (isSupport) score += 45;
    if (isHealer) score += 25;
    if (!isSupport && !isHealer && /\bdps\b/.test(text)) score -= 25;
  } else {
    if (isHealer) score -= 70;
    if (isSupport) score -= 35;
    if (/\bdps\b/.test(text)) score += 20;
    if (/^(power|condi|condition|hybrid)\b.*\bdps$/i.test(variant.trim())) score += 25;
    if (/^(power|condi) dps$/i.test(variant.trim())) score += 15;
  }

  const isPower = /\bpower\b/.test(text);
  const isCondi = /\b(condi|condition)\b/.test(text);
  if (focus === 'power') {
    if (isPower) score += 30;
    if (isCondi) score -= 20;
  } else if (focus === 'condition') {
    if (isCondi) score += 30;
    if (isPower) score -= 20;
  }

  if (/\b(low intensity|easy)\b/.test(text)) score -= 12;
  if (/\bhybrid\b/.test(text) && focus !== 'unknown') score -= 5;

  return score;
}

async function fetchRaidBuildTitles(): Promise<string[]> {
  return cached('metabattle:category:raid-builds', TTL_MS, async () => {
    const titles: string[] = [];
    let continueToken: string | undefined;

    do {
      const params = new URLSearchParams({
        action: 'query',
        list: 'categorymembers',
        cmtitle: RAID_CATEGORY,
        cmtype: 'page',
        cmlimit: '500',
        format: 'json',
        origin: '*',
      });
      if (continueToken) params.set('cmcontinue', continueToken);

      const response = await fetch(`${WIKI_API}?${params}`);
      if (!response.ok) {
        throw new MetaBattleError(`MetaBattle returned HTTP ${response.status} listing raid builds.`);
      }

      const data = (await response.json()) as {
        error?: { info?: string };
        query?: { categorymembers?: { title: string }[] };
        continue?: { cmcontinue?: string };
      };
      if (data.error) {
        throw new MetaBattleError(data.error.info ?? 'MetaBattle could not list raid builds.');
      }

      for (const member of data.query?.categorymembers ?? []) {
        if (member.title.startsWith('Build:')) titles.push(member.title);
      }
      continueToken = data.continue?.cmcontinue;
    } while (continueToken);

    return titles;
  });
}

/** Lists MetaBattle raid builds for an elite specialization, ranked for this log. */
export async function listRaidBuildCandidates(
  eliteSpec: string,
  focusOrOptions: DamageFocus | RaidBuildScoreOptions = 'unknown',
): Promise<RaidBuildCandidate[]> {
  const options: RaidBuildScoreOptions =
    typeof focusOrOptions === 'string' ? { focus: focusOrOptions } : focusOrOptions;
  const titles = await fetchRaidBuildTitles();
  const wanted = eliteSpec.trim().toLowerCase();

  const candidates: RaidBuildCandidate[] = [];
  for (const title of titles) {
    const parsed = parseRaidBuildTitle(title);
    if (!parsed) continue;
    if (parsed.eliteSpec.toLowerCase() !== wanted) continue;
    const score = scoreRaidBuildVariant(parsed.variant, options);
    if (!Number.isFinite(score)) continue;
    candidates.push({
      page: title,
      eliteSpec: parsed.eliteSpec,
      variant: parsed.variant,
      score,
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.variant.localeCompare(b.variant));
  return candidates;
}

/**
 * Picks a MetaBattle raid build for the player's elite specialization.
 * Only pages in Category:Raid builds are considered for the automatic pick —
 * open-world and PvP are excluded. A preferred page (from a pasted link or an
 * alternatives click) is loaded directly even when it is outside that shortlist.
 */
export async function autoSelectRaidReference(
  eliteSpec: string,
  player: NormalizedPlayer,
  skills: SkillIndex | undefined,
  preferredPage?: string,
  preferSupport = false,
): Promise<AutoReferenceResult> {
  const focus = inferDamageFocus(player);
  const candidates = await listRaidBuildCandidates(eliteSpec, { focus, preferSupport });

  if (preferredPage?.trim()) {
    const page = preferredPage.trim();
    const parsed = await fetchMetaBattleBuild(page, skills);
    if (!parsed.build.eliteSpec) {
      parsed.build.eliteSpec =
        candidates.find((candidate) => candidate.page.toLowerCase() === page.toLowerCase())?.eliteSpec ??
        eliteSpec;
    }
    return {
      chosen: parsed.build,
      alternatives: candidates
        .filter((candidate) => candidate.page.toLowerCase() !== page.toLowerCase())
        .slice(0, 4),
      candidates,
    };
  }

  if (candidates.length === 0) {
    throw new MetaBattleError(
      `No MetaBattle raid builds were found for ${eliteSpec}. Open-world and PvP pages are ignored.`,
    );
  }

  const chosenCandidate = candidates[0];
  const parsed = await fetchMetaBattleBuild(chosenCandidate.page, skills);
  if (!parsed.build.eliteSpec) parsed.build.eliteSpec = chosenCandidate.eliteSpec;

  return {
    chosen: parsed.build,
    alternatives: candidates.filter((candidate) => candidate.page !== chosenCandidate.page).slice(0, 4),
    candidates,
  };
}
