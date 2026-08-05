import { findBuffId } from '../model/normalize.ts';
import type { NormalizedPlayer } from '../model/normalize.ts';
import { compactNumber, count, percent } from './format.ts';
import type { Check, Finding } from './types.ts';

const TRACKED_BOONS = ['Alacrity', 'Quickness', 'Fury', 'Might'];

/** Ignore skills that differ by less than this many casts per minute. */
const MIN_RATE_DELTA = 0.75;

interface CastRate {
  name: string;
  perMinute: number;
}

function castRates(player: NormalizedPlayer): Map<string, CastRate> {
  const minutes = Math.max(0.1, player.activeTimeMs / 60000);
  const rates = new Map<string, CastRate>();
  for (const cast of player.casts) {
    if (cast.isWeaponSwap) continue;
    const entry = rates.get(cast.name) ?? { name: cast.name, perMinute: 0 };
    entry.perMinute += 1 / minutes;
    rates.set(cast.name, entry);
  }
  return rates;
}

/**
 * Diffs the analyzed log against a reference log. Everything is normalized to
 * casts per minute of active time so a 3 minute kill can be compared against a
 * 5 minute one.
 */
export const referenceLogCheck: Check = {
  id: 'reference-log',
  name: 'Reference log comparison',
  description: 'Compares your casts, boons, damage modifiers and DPS against a second log.',

  applicable: ({ reference }) => (reference ? undefined : 'No reference log was provided.'),

  run: ({ log, player, reference }) => {
    if (!reference) return [];

    const findings: Finding[] = [];
    const theirs = reference.player;

    if (player.profession !== theirs.profession) {
      findings.push({
        id: 'reference-log/profession',
        checkId: 'reference-log',
        severity: 'info',
        title: `Comparing ${player.profession} against ${theirs.profession}`,
        summary:
          'The two logs are different specializations, so skill-by-skill differences below are not meaningful. Boon uptime and DPS still are.',
      });
    }

    const dpsDelta = player.dps - theirs.dps;
    const dpsRatio = theirs.dps > 0 ? player.dps / theirs.dps : 1;
    findings.push({
      id: 'reference-log/dps',
      checkId: 'reference-log',
      severity: dpsRatio < 0.8 ? 'warning' : dpsRatio < 0.95 ? 'info' : 'good',
      title:
        dpsDelta >= 0
          ? `${compactNumber(player.dps)} DPS, ${compactNumber(Math.abs(dpsDelta))} ahead of the reference`
          : `${compactNumber(player.dps)} DPS, ${compactNumber(Math.abs(dpsDelta))} behind the reference`,
      summary: `${player.name} on ${log.fightName} versus ${theirs.name} on ${reference.log.fightName}, which did ${compactNumber(theirs.dps)} DPS.`,
      caveat:
        'Encounter length, boss mechanics, target hitbox and group composition all move DPS independently of how well you played.',
      metrics: [
        { label: 'Your DPS', display: compactNumber(player.dps), value: player.dps, target: theirs.dps },
        { label: 'Reference DPS', display: compactNumber(theirs.dps), value: theirs.dps },
      ],
    });

    const mine = castRates(player);
    const ref = castRates(theirs);
    const under: { name: string; mine: number; theirs: number }[] = [];
    for (const [name, rate] of ref) {
      const own = mine.get(name)?.perMinute ?? 0;
      if (rate.perMinute - own >= MIN_RATE_DELTA) {
        under.push({ name, mine: own, theirs: rate.perMinute });
      }
    }
    under.sort((a, b) => b.theirs - b.mine - (a.theirs - a.mine));

    if (under.length > 0) {
      findings.push({
        id: 'reference-log/casts',
        checkId: 'reference-log',
        severity: under.length > 4 ? 'warning' : 'info',
        title: `${count(under.length, 'skill')} cast less often than the reference`,
        summary: `The largest difference is ${under[0].name}: ${under[0].mine.toFixed(1)} casts per minute against ${under[0].theirs.toFixed(1)}.`,
        detail:
          'Rates are per minute of active time, so a longer or shorter fight does not skew the comparison. Skills the reference never used are not listed.',
        fix: 'Work through this list from the top. A large gap on a damage skill usually means it is not in your priority at all.',
        evidence: under.slice(0, 8).map((entry) => ({
          time: 0,
          label: `${entry.name}: ${entry.mine.toFixed(1)} vs ${entry.theirs.toFixed(1)} casts per minute`,
        })),
        impact: Math.min(10, under.length * 1.5),
      });
    }

    for (const boonName of TRACKED_BOONS) {
      const myBuffId = findBuffId(log, boonName);
      const theirBuffId = findBuffId(reference.log, boonName);
      if (myBuffId === undefined || theirBuffId === undefined) continue;
      const myTimeline = player.buffs.get(myBuffId);
      const theirTimeline = theirs.buffs.get(theirBuffId);
      if (!myTimeline || !theirTimeline) continue;

      const myRatio = myTimeline.uptimeRatio();
      const theirRatio = theirTimeline.uptimeRatio();
      if (theirRatio - myRatio < 0.1) continue;

      findings.push({
        id: `reference-log/boon-${boonName.toLowerCase()}`,
        checkId: 'reference-log',
        severity: theirRatio - myRatio > 0.25 ? 'warning' : 'info',
        title: `${boonName} uptime trails the reference by ${percent(theirRatio - myRatio)}`,
        summary: `You had ${percent(myRatio)} against their ${percent(theirRatio)}.`,
        metrics: [
          { label: `Your ${boonName}`, display: percent(myRatio), value: myRatio * 100, target: theirRatio * 100 },
          { label: `Reference ${boonName}`, display: percent(theirRatio), value: theirRatio * 100 },
        ],
        impact: Math.min(8, (theirRatio - myRatio) * 20),
      });
    }

    const myMods = new Map(player.damageModifiers.map((mod) => [mod.name, mod]));
    const modGaps = theirs.damageModifiers
      .map((mod) => ({
        name: mod.name,
        mine: myMods.get(mod.name)?.hitRatio ?? 0,
        theirs: mod.hitRatio,
      }))
      .filter((entry) => entry.theirs - entry.mine > 0.15 && entry.theirs > 0.2)
      .sort((a, b) => b.theirs - b.mine - (a.theirs - a.mine));

    if (modGaps.length > 0) {
      findings.push({
        id: 'reference-log/damage-modifiers',
        checkId: 'reference-log',
        severity: 'info',
        title: `${count(modGaps.length, 'damage modifier')} applied to fewer of your hits`,
        summary: `${modGaps[0].name} covered ${percent(modGaps[0].mine)} of your hits against ${percent(modGaps[0].theirs)} in the reference log.`,
        detail:
          'Damage modifiers are conditional multipliers from traits, relics and food. A lower hit coverage means you were meeting the condition less often, which is usually a rotation or positioning difference.',
        evidence: modGaps.slice(0, 6).map((entry) => ({
          time: 0,
          label: `${entry.name}: ${percent(entry.mine)} vs ${percent(entry.theirs)} of hits`,
        })),
        impact: Math.min(6, modGaps.length),
      });
    }

    return findings;
  },
};
