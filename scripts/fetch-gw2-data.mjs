#!/usr/bin/env node
/**
 * Builds the static GW2 API snapshot the app ships with.
 *
 * Shipping a snapshot keeps analysis instant and keeps the app working when the
 * official API is having a bad day; the runtime client still falls back to live
 * requests for ids that are not in the snapshot.
 *
 * Usage: node scripts/fetch-gw2-data.mjs [Profession ...]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.guildwars2.com/v2';
// skills_by_palette only exists on this schema version or newer.
const SCHEMA = '2019-12-19T00:00:00.000Z';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/gw2');
const DEFAULT_PROFESSIONS = ['Mesmer'];

async function getJson(url) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url);
    if (response.ok) return response.json();
    // 206 means some requested ids do not exist; the body still holds the rest.
    if (response.status === 206) return response.json();
    if (response.status === 429 || response.status >= 500) {
      const wait = 500 * 2 ** attempt;
      console.warn(`  ${response.status} from ${url}, retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw new Error(`GET ${url} failed with ${response.status}`);
  }
  throw new Error(`GET ${url} failed after retries`);
}

async function getByIds(endpoint, ids) {
  const unique = [...new Set(ids)].filter((id) => Number.isFinite(id));
  const results = [];
  for (let i = 0; i < unique.length; i += 200) {
    const batch = unique.slice(i, i + 200);
    const data = await getJson(`${API}/${endpoint}?ids=${batch.join(',')}&v=${SCHEMA}`);
    if (Array.isArray(data)) results.push(...data);
  }
  return results;
}

function factValue(skill, type, key = 'value') {
  const fact = skill.facts?.find((f) => f.type === type);
  return fact ? fact[key] : undefined;
}

/**
 * Combo data lives in the facts array rather than as top-level properties on
 * most skills, e.g. Chaos Storm only reports its Ethereal field through a
 * ComboField fact.
 */
function comboInfo(skill) {
  const field = skill.facts?.find((f) => f.type === 'ComboField');
  const finisher = skill.facts?.find((f) => f.type === 'ComboFinisher');
  return {
    fieldType: skill.combo_field ?? field?.field_type,
    finisherType: skill.combo_finisher ?? finisher?.finisher_type,
    finisherPercent: finisher?.percent,
    // Field lifetime is a plain Time fact labelled "Duration".
    durationSec: skill.facts?.find((f) => f.text === 'Duration' && f.type === 'Time')?.duration,
  };
}

function trimSkill(skill) {
  const trimmed = {
    id: skill.id,
    name: skill.name,
  };
  if (skill.slot) trimmed.slot = skill.slot;
  if (skill.type) trimmed.type = skill.type;
  if (skill.weapon_type && skill.weapon_type !== 'None') trimmed.weaponType = skill.weapon_type;
  if (skill.specialization) trimmed.specialization = skill.specialization;
  if (skill.categories?.length) trimmed.categories = skill.categories;
  if (skill.flags?.length) trimmed.flags = skill.flags;
  if (skill.next_chain) trimmed.nextChain = skill.next_chain;
  if (skill.prev_chain) trimmed.prevChain = skill.prev_chain;
  if (skill.icon) trimmed.icon = skill.icon;
  if (skill.description) trimmed.description = skill.description;

  const recharge = factValue(skill, 'Recharge');
  if (typeof recharge === 'number' && recharge > 0) trimmed.rechargeSec = recharge;

  const combo = comboInfo(skill);
  if (combo.fieldType) {
    trimmed.comboField = combo.fieldType;
    if (combo.durationSec) trimmed.fieldDurationSec = combo.durationSec;
  }
  if (combo.finisherType) {
    trimmed.comboFinisher = combo.finisherType;
    if (combo.finisherPercent) trimmed.finisherPercent = combo.finisherPercent;
  }

  return trimmed;
}

async function buildProfession(name) {
  console.log(`Fetching ${name}...`);
  const profession = await getJson(`${API}/professions/${name}?v=${SCHEMA}`);

  const skillIds = new Set();
  for (const entry of profession.skills ?? []) skillIds.add(entry.id);

  const weapons = {};
  for (const [weapon, data] of Object.entries(profession.weapons ?? {})) {
    weapons[weapon] = {
      specialization: data.specialization,
      flags: data.flags ?? [],
      skills: (data.skills ?? []).map((entry) => {
        skillIds.add(entry.id);
        return {
          id: entry.id,
          slot: entry.slot,
          offhand: entry.offhand,
          attunement: entry.attunement,
        };
      }),
    };
  }

  const specializations = await getByIds('specializations', profession.specializations ?? []);
  const traitIds = specializations.flatMap((spec) => [
    ...(spec.minor_traits ?? []),
    ...(spec.major_traits ?? []),
  ]);
  const traits = await getByIds('traits', traitIds);
  for (const trait of traits) {
    for (const skill of trait.skills ?? []) if (skill.id) skillIds.add(skill.id);
  }

  // Auto-attack chains are discovered by walking next_chain, so keep pulling
  // until the closure stops growing.
  const skills = new Map();
  let pending = [...skillIds];
  while (pending.length > 0) {
    const fetched = await getByIds('skills', pending);
    pending = [];
    for (const skill of fetched) {
      if (skills.has(skill.id)) continue;
      skills.set(skill.id, trimSkill(skill));
      for (const linked of [skill.next_chain, skill.prev_chain, skill.flip_skill, skill.toolbelt_skill]) {
        if (linked && !skills.has(linked)) pending.push(linked);
      }
    }
  }

  const snapshot = {
    generatedAt: new Date().toISOString().slice(0, 10),
    profession: profession.name,
    icon: profession.icon,
    specializations: specializations
      .map((spec) => ({
        id: spec.id,
        name: spec.name,
        elite: spec.elite === true,
        icon: spec.icon,
        minorTraits: spec.minor_traits ?? [],
        majorTraits: spec.major_traits ?? [],
      }))
      .sort((a, b) => a.id - b.id),
    traits: Object.fromEntries(
      traits
        .sort((a, b) => a.id - b.id)
        .map((trait) => [
          trait.id,
          {
            id: trait.id,
            name: trait.name,
            icon: trait.icon,
            tier: trait.tier,
            order: trait.order,
            slot: trait.slot,
            specialization: trait.specialization,
            description: trait.description,
          },
        ]),
    ),
    skills: Object.fromEntries([...skills.entries()].sort((a, b) => a[0] - b[0])),
    weapons,
    skillsByPalette: (profession.skills_by_palette ?? []).sort((a, b) => a[0] - b[0]),
  };

  const path = resolve(OUT_DIR, `${profession.name.toLowerCase()}.json`);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(
    `  ${profession.name}: ${Object.keys(snapshot.skills).length} skills, ${traits.length} traits, ` +
      `${snapshot.skillsByPalette.length} palette entries -> ${path}`,
  );
}

const professions = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_PROFESSIONS;
for (const profession of professions) {
  await buildProfession(profession);
}
