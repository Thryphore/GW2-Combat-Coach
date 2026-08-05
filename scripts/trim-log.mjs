#!/usr/bin/env node
/**
 * Turns a real dps.report log into a small test fixture.
 *
 * Elite Insights JSON for a full encounter is tens of megabytes, most of it
 * per-second graph data the analysis never reads. This keeps one player and the
 * maps that player's data references.
 *
 * Usage: node scripts/trim-log.mjs <permalink> [player name] [output name]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../src/analysis/__fixtures__');

const [permalinkArg, playerArg, nameArg] = process.argv.slice(2);
if (!permalinkArg) {
  console.error('Usage: node scripts/trim-log.mjs <dps.report permalink> [player name] [output name]');
  process.exit(1);
}

const permalink = permalinkArg.startsWith('http') ? permalinkArg : `https://dps.report/${permalinkArg}`;

console.log(`Fetching ${permalink} ...`);
const response = await fetch(`https://dps.report/getJson?permalink=${encodeURIComponent(permalink)}`);
if (!response.ok) {
  console.error(`dps.report returned HTTP ${response.status}`);
  process.exit(1);
}
const log = await response.json();
if (log.error) {
  console.error(`dps.report error: ${log.error}`);
  process.exit(1);
}

const players = log.players ?? [];
const player = playerArg
  ? players.find((p) => p.name === playerArg || p.account === playerArg)
  : players.find((p) => p.name === log.recordedBy) ?? players[0];

if (!player) {
  console.error(`No matching player. Available: ${players.map((p) => `${p.name} (${p.profession})`).join(', ')}`);
  process.exit(1);
}

const referencedSkills = new Set();
for (const rotation of player.rotation ?? []) referencedSkills.add(rotation.id);
for (const dist of player.totalDamageDist?.[0] ?? []) referencedSkills.add(dist.id);

const referencedBuffs = new Set((player.buffUptimes ?? []).map((buff) => buff.id));
const referencedMods = new Set((player.damageModifiers ?? []).map((mod) => mod.id));

const pick = (map, ids, prefix) =>
  Object.fromEntries(
    Object.entries(map ?? {}).filter(([key]) => ids.has(Number(key.replace(prefix, '')))),
  );

const trimmed = {
  eliteInsightsVersion: log.eliteInsightsVersion,
  arcVersion: log.arcVersion,
  gW2Build: log.gW2Build,
  triggerID: log.triggerID,
  fightName: log.fightName ?? log.name,
  durationMS: log.durationMS,
  success: log.success,
  isCM: log.isCM,
  isLateStart: log.isLateStart,
  recordedBy: log.recordedBy,
  timeStartStd: log.timeStartStd,
  phases: (log.phases ?? []).map(({ start, end, name }) => ({ start, end, name })),
  targets: (log.targets ?? []).map(({ name, totalHealth }) => ({ name, totalHealth })),
  players: [
    {
      name: player.name,
      account: player.account,
      group: player.group,
      profession: player.profession,
      firstAware: player.firstAware,
      lastAware: player.lastAware,
      activeTimes: player.activeTimes,
      weapons: player.weapons,
      weaponSets: player.weaponSets,
      dpsAll: player.dpsAll,
      statsAll: player.statsAll,
      defenses: player.defenses,
      rotation: player.rotation,
      buffUptimes: (player.buffUptimes ?? []).map(({ id, states, buffData }) => ({
        id,
        states,
        buffData: buffData?.slice(0, 1),
      })),
      damageModifiers: player.damageModifiers,
      totalDamageDist: player.totalDamageDist?.slice(0, 1),
    },
  ],
  skillMap: pick(log.skillMap, referencedSkills, 's'),
  buffMap: pick(log.buffMap, referencedBuffs, 'b'),
  damageModMap: pick(log.damageModMap, referencedMods, 'd'),
  personalBuffs: log.personalBuffs,
  logErrors: log.logErrors ?? [],
};

const name = nameArg ?? `${player.profession.toLowerCase()}-${log.triggerID ?? 'log'}`;
const path = resolve(OUT_DIR, `${name}.json`);
await mkdir(OUT_DIR, { recursive: true });
await writeFile(path, `${JSON.stringify(trimmed, null, 2)}\n`, 'utf8');

console.log(
  `Wrote ${path} for ${player.name} (${player.profession}): ` +
    `${player.rotation?.length ?? 0} skills cast, ${Object.keys(trimmed.skillMap).length} skill entries.`,
);
