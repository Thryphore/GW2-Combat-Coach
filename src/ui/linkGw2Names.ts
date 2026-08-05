import type { SkillIndex, SkillInfo, TraitInfo } from '../api/gw2.ts';

export type Gw2NameHit =
  | { kind: 'skill'; name: string; skill: SkillInfo }
  | { kind: 'trait'; name: string; trait: TraitInfo };

export type Gw2TextPart = { kind: 'text'; value: string } | Gw2NameHit;

interface NameCatalog {
  pattern: RegExp;
  byName: Map<string, Gw2NameHit>;
  revision: number;
}

const catalogCache = new WeakMap<SkillIndex, NameCatalog>();

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function catalogFor(skills: SkillIndex): NameCatalog | undefined {
  const cached = catalogCache.get(skills);
  if (cached && cached.revision === skills.revision) return cached;

  const byName = new Map<string, Gw2NameHit>();

  // Traits first so identically named skills win when registered second.
  for (const trait of skills.listTraits()) {
    byName.set(trait.name, { kind: 'trait', name: trait.name, trait });
  }
  for (const skill of skills.listSkills()) {
    byName.set(skill.name, { kind: 'skill', name: skill.name, skill });
  }

  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  if (names.length === 0) return undefined;

  // Longest-first alternation so "Chaos Storm" wins over "Chaos".
  const pattern = new RegExp(
    `(?<![A-Za-z0-9])(${names.map(escapeRegExp).join('|')})(?![A-Za-z0-9])`,
    'g',
  );

  const catalog = { pattern, byName, revision: skills.revision };
  catalogCache.set(skills, catalog);
  return catalog;
}

/** Splits prose into plain text and known skill/trait name hits. */
export function splitGw2Names(text: string, skills: SkillIndex | undefined): Gw2TextPart[] {
  if (!text) return [];
  if (!skills) return [{ kind: 'text', value: text }];

  const catalog = catalogFor(skills);
  if (!catalog) return [{ kind: 'text', value: text }];

  const parts: Gw2TextPart[] = [];
  let cursor = 0;
  catalog.pattern.lastIndex = 0;

  for (const match of text.matchAll(catalog.pattern)) {
    const index = match.index ?? 0;
    const name = match[1]!;
    const hit = catalog.byName.get(name);
    if (!hit) continue;
    if (index > cursor) parts.push({ kind: 'text', value: text.slice(cursor, index) });
    parts.push(hit);
    cursor = index + name.length;
  }

  if (cursor < text.length) parts.push({ kind: 'text', value: text.slice(cursor) });
  return parts.length > 0 ? parts : [{ kind: 'text', value: text }];
}
