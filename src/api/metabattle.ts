import type { SkillIndex } from './gw2.ts';
import type { ReferenceBuild } from '../model/build.ts';
import { referenceBuildFromChatCode } from '../model/chatCode.ts';
import { cached } from './cache.ts';

const WIKI_API = 'https://metabattle.com/wiki/api.php';
const PAGE_BASE = 'https://metabattle.com/wiki/';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CuratedBuild {
  id: string;
  label: string;
  /** Elite specialization the build is for, matching what Elite Insights reports. */
  eliteSpec: string;
  content: string;
  page: string;
}

/**
 * Curated entry points. Any MetaBattle build page can also be pasted directly,
 * so this list only needs to cover the common cases.
 */
export const CURATED_BUILDS: CuratedBuild[] = [
  {
    id: 'virtuoso-power-dps',
    label: 'Power Virtuoso',
    eliteSpec: 'Virtuoso',
    content: 'Raids and fractals',
    page: 'Build:Virtuoso - Power DPS',
  },
  {
    id: 'virtuoso-condi-dps',
    label: 'Condition Virtuoso',
    eliteSpec: 'Virtuoso',
    content: 'Raids and fractals',
    page: 'Build:Virtuoso - Condi DPS',
  },
  {
    id: 'virtuoso-power-open-world',
    label: 'Power Virtuoso',
    eliteSpec: 'Virtuoso',
    content: 'Open world',
    page: 'Build:Virtuoso - Power Virtuoso',
  },
  {
    id: 'virtuoso-condi-open-world',
    label: 'Condition Virtuoso',
    eliteSpec: 'Virtuoso',
    content: 'Open world',
    page: 'Build:Virtuoso - Condition Virtuoso',
  },
];

export class MetaBattleError extends Error {}

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

  const build = referenceBuildFromChatCode(chatCode, skills, {
    name: title.replace(/^Build:/, ''),
    url,
    source: 'metabattle',
    weapons: weaponsFromSkillBar(skillBar),
    attribution: 'Build data from MetaBattle, licensed CC BY-NC-SA 3.0.',
  });

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
