import { useState } from 'react';
import type { SkillIndex } from '../../api/gw2.ts';
import { measureAutoAttackChains } from '../../analysis/checks/autoAttackChain.ts';
import { measureCooldownHolds } from '../../analysis/checks/cooldowns.ts';
import { measureIdleTime } from '../../analysis/checks/downtime.ts';
import { measureCancelledCasts } from '../../analysis/checks/wastedCasts.ts';
import { compactNumber, duration, percent } from '../../analysis/format.ts';
import type { Severity } from '../../analysis/types.ts';
import {
  findBladeBuffId,
  findBuffId,
  resolveEiIcon,
  shouldShowCleaveDps,
  type NormalizedLog,
  type NormalizedPlayer,
} from '../../model/normalize.ts';
import { resolveFindingTarget, scrollToFinding } from '../findingNav.ts';
import { DropdownChevron } from './DropdownChevron.tsx';
import { SEVERITY_STYLES } from './severity.ts';

/** Combat boons worth scanning on any role. */
const IMPORTANT_BOONS: { name: string; stacking?: boolean; fallbackIcon: string }[] = [
  { name: 'Quickness', fallbackIcon: 'https://wiki.guildwars2.com/images/b/b4/Quickness.png' },
  { name: 'Alacrity', fallbackIcon: 'https://wiki.guildwars2.com/images/4/4c/Alacrity.png' },
  { name: 'Might', stacking: true, fallbackIcon: 'https://wiki.guildwars2.com/images/7/7c/Might.png' },
  { name: 'Fury', fallbackIcon: 'https://wiki.guildwars2.com/images/4/46/Fury.png' },
  { name: 'Protection', fallbackIcon: 'https://wiki.guildwars2.com/images/6/6c/Protection.png' },
  { name: 'Resolution', fallbackIcon: 'https://wiki.guildwars2.com/images/0/06/Resolution.png' },
  { name: 'Regeneration', fallbackIcon: 'https://wiki.guildwars2.com/images/5/53/Regeneration.png' },
  { name: 'Vigor', fallbackIcon: 'https://wiki.guildwars2.com/images/a/a3/Vigor.png' },
  { name: 'Swiftness', fallbackIcon: 'https://wiki.guildwars2.com/images/a/af/Swiftness.png' },
  { name: 'Resistance', fallbackIcon: 'https://wiki.guildwars2.com/images/3/30/Resistance.png' },
  {
    name: 'Stability',
    stacking: true,
    fallbackIcon: 'https://wiki.guildwars2.com/images/a/ab/Stability.png',
  },
  { name: 'Aegis', fallbackIcon: 'https://wiki.guildwars2.com/images/e/e5/Aegis.png' },
];

type Tone = Severity | 'neutral';

interface Cube {
  label: string;
  value: string;
  /** Small secondary line under the main value (e.g. peak 1s damage). */
  aside?: string;
  detail?: string;
  tone: Tone;
  /** Finding ids to scroll to, in preference order. */
  targets: string[];
}

function CubeCard({ cube, targetId }: { cube: Cube; targetId?: string }) {
  const accent =
    cube.tone === 'neutral'
      ? 'border-ink-700'
      : cube.tone === 'good'
        ? 'border-good-500/40'
        : cube.tone === 'warning'
          ? 'border-warn-500/40'
          : cube.tone === 'critical'
            ? 'border-crit-500/40'
            : 'border-info-500/40';
  const valueColor =
    cube.tone === 'neutral' ? 'text-white' : SEVERITY_STYLES[cube.tone].text;
  const className = `flex min-h-28 flex-col justify-between rounded-2xl border bg-ink-850/70 p-4 text-left ${accent}`;

  const body = (
    <>
      <div className="text-[11px] font-semibold tracking-wide text-ink-400 uppercase">{cube.label}</div>
      <div className={`mt-3 font-mono text-2xl font-semibold tracking-tight ${valueColor}`}>
        {cube.value}
      </div>
      {cube.aside && (
        <p className="mt-0.5 font-mono text-[11px] leading-snug text-ink-400">{cube.aside}</p>
      )}
      {cube.detail && <p className="mt-1 text-xs leading-snug text-ink-400">{cube.detail}</p>}
    </>
  );

  if (!targetId) {
    return <div className={className}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => scrollToFinding(targetId)}
      className={`${className} cursor-pointer transition-colors hover:bg-ink-800/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400`}
      title={`Jump to ${cube.label} details`}
    >
      {body}
    </button>
  );
}

function dpsTone(ratio: number | undefined): Tone {
  if (ratio === undefined) return 'neutral';
  if (ratio >= 0.95) return 'good';
  if (ratio >= 0.8) return 'info';
  if (ratio >= 0.65) return 'warning';
  return 'critical';
}

function chainTone(rate: number): Tone {
  if (rate >= 0.9) return 'good';
  if (rate >= 0.75) return 'info';
  if (rate >= 0.55) return 'warning';
  return 'critical';
}

function idleTone(share: number): Tone {
  if (share < 0.02) return 'good';
  if (share < 0.05) return 'info';
  if (share < 0.1) return 'warning';
  return 'critical';
}

/** Aborted-cast waste is never “good” — this cube only appears when time was lost. */
function wasteTone(share: number): Tone {
  if (share > 0.02) return 'critical';
  if (share > 0.0075) return 'warning';
  return 'info';
}

function buildCubes(
  log: NormalizedLog,
  player: NormalizedPlayer,
  skills: SkillIndex | undefined,
  compare?: { dps: number; cleaveDps: number; label: string },
): Cube[] {
  const cubes: Cube[] = [];
  const dpsRatio = compare && compare.dps > 0 ? player.dps / compare.dps : undefined;
  const cleaveRatio =
    compare && compare.cleaveDps > 0 ? player.cleaveDps / compare.cleaveDps : undefined;

  cubes.push({
    label: 'DPS',
    value: compactNumber(player.dps),
    aside: player.peakDps > 0 ? `peak damage ${compactNumber(player.peakDps)}` : undefined,
    detail:
      dpsRatio !== undefined
        ? `${percent(dpsRatio)} of ${compare!.label} (${compactNumber(compare!.dps)})`
        : `${compactNumber(player.damage)} target`,
    tone: dpsTone(dpsRatio),
    targets: ['reference-log/dps'],
  });

  if (shouldShowCleaveDps(player)) {
    cubes.push({
      label: 'Cleave DPS',
      value: compactNumber(player.cleaveDps),
      aside: player.peakCleaveDps > 0 ? `peak damage ${compactNumber(player.peakCleaveDps)}` : undefined,
      detail:
        cleaveRatio !== undefined
          ? `${percent(cleaveRatio)} of ${compare!.label} (${compactNumber(compare!.cleaveDps)})`
          : `${compactNumber(player.cleaveDamage)} all`,
      tone: dpsTone(cleaveRatio),
      targets: ['reference-log/dps'],
    });
  }

  if (skills) {
    const chains = measureAutoAttackChains(player, skills);
    if (chains.attempts > 0) {
      cubes.push({
        label: 'Auto chains',
        value: percent(chains.completionRate),
        detail: `${chains.completed} of ${chains.attempts} finished${
          chains.drops.length > 0 ? ` · ${chains.drops.length} restarted early` : ''
        }`,
        tone: chainTone(chains.completionRate),
        targets: [
          'auto-attack-chain/dropped',
          'auto-attack-chain/aborted',
          'auto-attack-chain/clean',
          'reference-log/auto-chains',
          'auto-attack-chain',
        ],
      });
    }
  }

  const idle = measureIdleTime(player, log.fullFight);
  cubes.push({
    label: 'Idle time',
    value: percent(idle.share),
    detail: idle.share < 0.02 ? 'Almost no silence' : `${duration(idle.idleMs)} with nothing casting`,
    tone: idleTone(idle.share),
    targets: ['downtime/idle', 'downtime'],
  });

  const cancelled = measureCancelledCasts(player, log.fullFight);
  if (cancelled.abortedCount > 0 || cancelled.wasteShare >= 0.005) {
    cubes.push({
      label: 'Aborted casts',
      value: duration(cancelled.wastedMs),
      detail: `${cancelled.abortedCount} cast${cancelled.abortedCount === 1 ? '' : 's'} · ${percent(cancelled.wasteShare, 1)} of the fight`,
      tone: wasteTone(cancelled.wasteShare),
      targets: ['wasted-casts/aborted', 'reference-log/aborted-casts', 'wasted-casts'],
    });
  } else if (cancelled.savedMs > 500) {
    cubes.push({
      label: 'Anim. cancels',
      value: duration(cancelled.savedMs),
      detail: `${cancelled.cancelledCount} aftercast cancel${cancelled.cancelledCount === 1 ? '' : 's'}`,
      tone: 'good',
      targets: ['wasted-casts/saved', 'wasted-casts'],
    });
  }

  if (skills) {
    const holds = measureCooldownHolds(log, player, log.fullFight, skills);
    if (holds.skills.length > 0) {
      const top = holds.skills[0];
      cubes.push({
        label: 'Cooldown holds',
        value: `${holds.missedPerMinute.toFixed(1)}/min`,
        detail: top ? `Mostly ${top.name}` : `${holds.totalMissed.toFixed(0)} missed casts`,
        tone:
          holds.missedPerMinute < 1.5
            ? 'good'
            : holds.missedPerMinute < 3
              ? 'info'
              : holds.missedPerMinute < 5
                ? 'warning'
                : 'critical',
        targets: ['cooldowns/held', 'cooldowns'],
      });
    }
  }

  const bladesId = findBladeBuffId(log);
  const blades = bladesId !== undefined ? player.buffs.get(bladesId) : undefined;
  if (blades && !blades.isEmpty) {
    const avg = blades.averageStacks(log.fullFight);
    cubes.push({
      label: 'Avg blades',
      value: avg.toFixed(1),
      detail: 'Across the fight',
      tone: avg >= 3.5 ? 'good' : avg >= 2.5 ? 'info' : avg >= 1.5 ? 'warning' : 'critical',
      targets: ['virtuoso/blades'],
    });
  }

  return cubes.slice(0, 8);
}

interface BoonRow {
  name: string;
  icon: string;
  uptime: number;
  avgStacks?: number;
  generation?: number;
}

function importantBoonRows(log: NormalizedLog, player: NormalizedPlayer): BoonRow[] {
  const rows: BoonRow[] = [];
  for (const boon of IMPORTANT_BOONS) {
    const id = findBuffId(log, boon.name);
    if (id === undefined) continue;
    const timeline = player.buffs.get(id);
    if (!timeline || timeline.isEmpty) continue;
    const uptime = timeline.uptimeRatio(log.fullFight);
    if (uptime < 0.01) continue;
    const generation = player.buffGeneration.get(id);
    rows.push({
      name: boon.name,
      icon: resolveEiIcon(log.buffs.get(id)?.icon) ?? boon.fallbackIcon,
      uptime,
      avgStacks: boon.stacking ? timeline.averageStacks(log.fullFight) : undefined,
      generation: generation !== undefined && generation > 0 ? generation : undefined,
    });
  }
  return rows;
}

function BoonUptimeDropdown({
  rows,
  findingIds,
}: {
  rows: BoonRow[];
  findingIds: ReadonlySet<string>;
}) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;

  return (
    <div className="mt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-brand-400 transition-colors hover:text-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        <DropdownChevron open={open} />
        Boons
        <span className="font-normal text-ink-400">({rows.length})</span>
      </button>

      <div
        aria-hidden={!open}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
          open ? 'grid-rows-[1fr] opacity-100' : 'pointer-events-none grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {rows.map((row) => {
              const targetId = resolveFindingTarget(findingIds, [
                `boon-uptime/${row.name.toLowerCase()}`,
                'boon-uptime',
                'reference-log/boon',
              ]);
              const className =
                'flex items-center gap-2.5 rounded-xl border border-ink-700 bg-ink-900/40 px-2.5 py-2 text-left';
              const body = (
                <>
                  <img
                    src={row.icon}
                    alt=""
                    className="h-8 w-8 shrink-0 rounded-md object-contain ring-1 ring-ink-700"
                    loading="lazy"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-ink-200">{row.name}</div>
                    <div className="font-mono text-xs text-white">
                      {percent(row.uptime)}
                      {row.avgStacks !== undefined && (
                        <span className="text-ink-400"> · {row.avgStacks.toFixed(1)} avg</span>
                      )}
                    </div>
                  </div>
                </>
              );
              const title =
                row.generation !== undefined
                  ? `${row.name}: ${percent(row.uptime)} uptime, ${row.generation.toFixed(0)}% generation`
                  : `${row.name}: ${percent(row.uptime)} uptime`;

              if (!targetId) {
                return (
                  <div key={row.name} className={className} title={title}>
                    {body}
                  </div>
                );
              }

              return (
                <button
                  key={row.name}
                  type="button"
                  onClick={() => scrollToFinding(targetId)}
                  className={`${className} cursor-pointer transition-colors hover:bg-ink-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400`}
                  title={`${title} — jump to details`}
                >
                  {body}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AtAGlance({
  log,
  player,
  skills,
  compare,
  findingIds = [],
  hiddenFindingIds = [],
}: {
  log: NormalizedLog;
  player: NormalizedPlayer;
  skills?: SkillIndex;
  compare?: { dps: number; cleaveDps: number; label: string };
  /** Finding ids present in the report (main list, hidden, and top-log overview). */
  findingIds?: readonly string[];
  /** Findings parked under "Not shown above" — omit matching dashboard cubes. */
  hiddenFindingIds?: readonly string[];
}) {
  const ids = new Set(findingIds);
  const hidden = new Set(hiddenFindingIds);
  const cubes = buildCubes(log, player, skills, compare).filter((cube) => {
    const targetId = resolveFindingTarget(ids, cube.targets);
    return !targetId || !hidden.has(targetId);
  });
  const boons = importantBoonRows(log, player).filter((row) => {
    const targetId = resolveFindingTarget(ids, [
      `boon-uptime/${row.name.toLowerCase()}`,
      'boon-uptime',
      'reference-log/boon',
    ]);
    return !targetId || !hidden.has(targetId);
  });
  if (cubes.length === 0 && boons.length === 0) return null;

  return (
    <div className="mt-5 border-t border-ink-700 pt-4">
      <h3 className="text-sm font-semibold tracking-wide text-ink-400 uppercase">At a glance</h3>
      {cubes.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {cubes.map((cube) => (
            <CubeCard
              key={cube.label}
              cube={cube}
              targetId={resolveFindingTarget(ids, cube.targets)}
            />
          ))}
        </div>
      )}
      <BoonUptimeDropdown rows={boons} findingIds={ids} />
    </div>
  );
}
