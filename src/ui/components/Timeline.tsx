import type { SkillIndex } from '../../api/gw2.ts';
import { boonsForRole } from '../../analysis/boonRole.ts';
import { timestamp } from '../../analysis/format.ts';
import type { InferredBuild, ReferenceBuild } from '../../model/build.ts';
import { findBladeBuffId, findBuffId, type NormalizedLog, type NormalizedPlayer } from '../../model/normalize.ts';
import { skillKeybind } from '../skillKeybind.ts';
import { SkillTipContent } from './Gw2Tip.tsx';
import { HoverTooltip } from './HoverTooltip.tsx';

interface Props {
  log: NormalizedLog;
  player: NormalizedPlayer;
  referenceBuild?: ReferenceBuild;
  build?: InferredBuild;
  skills?: SkillIndex;
}

function castKeybind(
  skillId: number,
  skills: SkillIndex | undefined,
  build: InferredBuild | undefined,
): string | undefined {
  const info = skills?.skill(skillId);
  if (!info?.slot) return undefined;
  if (info.slot === 'Utility' && build) {
    const index = build.utilities.findIndex((entry) => entry.id === skillId);
    return skillKeybind(info.slot, index >= 0 ? index : undefined);
  }
  return skillKeybind(info.slot);
}

export function Timeline({ log, player, referenceBuild, build, skills }: Props) {
  const span = Math.max(1, log.fullFight.end - log.fullFight.start);
  const toPercent = (ms: number) => ((ms - log.fullFight.start) / span) * 100;
  const trackedBoons = boonsForRole(log, player, referenceBuild);

  const rows = trackedBoons
    .map((name) => {
      const id = findBuffId(log, name);
      const timeline = id === undefined ? undefined : player.buffs.get(id);
      if (!timeline || timeline.uptimeMs(log.fullFight) <= 0) return null;
      return {
        name,
        uptime: timeline.uptimeRatio(log.fullFight),
        windows: timeline.activeWindows(log.fullFight),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const bladesId = findBladeBuffId(log);
  const bladesTimeline = bladesId === undefined ? undefined : player.buffs.get(bladesId);
  const bladeSegments =
    bladesTimeline && !bladesTimeline.isEmpty
      ? bladesTimeline.segments(log.fullFight).filter((segment) => segment.stacks > 0)
      : [];
  const avgBlades = bladesTimeline?.averageStacks(log.fullFight) ?? 0;

  const ticks = Array.from({ length: 6 }, (_, index) => (span / 5) * index);

  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-850/70 p-5">
      <h2 className="text-sm font-semibold tracking-wide text-ink-400 uppercase">Fight timeline</h2>

      <div className="mt-4 space-y-3">
        {bladeSegments.length > 0 && (
          <div className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-xs text-ink-400">Blades</span>
            <div className="relative h-4 flex-1 overflow-hidden rounded-md bg-ink-800">
              {bladeSegments.map((segment, index) => (
                <div
                  key={index}
                  className="absolute bottom-0 bg-brand-400"
                  style={{
                    left: `${toPercent(segment.start)}%`,
                    width: `${Math.max(0.25, ((segment.end - segment.start) / span) * 100)}%`,
                    height: `${Math.max(18, (segment.stacks / 5) * 100)}%`,
                    opacity: 0.35 + (segment.stacks / 5) * 0.65,
                  }}
                  title={`Blades ×${segment.stacks} · ${timestamp(segment.start)} – ${timestamp(segment.end)}`}
                />
              ))}
            </div>
            <span className="w-10 shrink-0 text-right font-mono text-xs text-ink-200">
              {avgBlades.toFixed(1)}
            </span>
          </div>
        )}

        {rows.map((row) => (
          <div key={row.name} className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-xs text-ink-400">{row.name}</span>
            <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-ink-800">
              {row.windows.map((window, index) => (
                <div
                  key={index}
                  className="absolute inset-y-0 bg-brand-500"
                  style={{
                    left: `${toPercent(window.start)}%`,
                    width: `${Math.max(0.25, ((window.end - window.start) / span) * 100)}%`,
                  }}
                  title={`${row.name} ${timestamp(window.start)} - ${timestamp(window.end)}`}
                />
              ))}
            </div>
            <span className="w-10 shrink-0 text-right font-mono text-xs text-ink-200">
              {Math.round(row.uptime * 100)}%
            </span>
          </div>
        ))}

        <div className="flex items-center gap-3">
          <span className="w-20 shrink-0 text-xs text-ink-400">Casts</span>
          <div className="relative h-6 flex-1 overflow-hidden rounded-md bg-ink-800">
            {player.casts.map((cast, index) => {
              const info = skills?.skill(cast.skillId);
              const keybind = castKeybind(cast.skillId, skills, build);
              const chain = skills?.chainPosition(cast.skillId);
              const cancelled = cast.timeGained < 0;
              const tip = info ? (
                <SkillTipContent
                  skill={info}
                  keybind={keybind}
                  chain={chain}
                  footnote={`${timestamp(cast.time)}${cancelled ? ' · cancelled' : ''}`}
                />
              ) : (
                <SkillTipContent
                  skill={{ id: cast.skillId, name: cast.name }}
                  keybind={keybind}
                  footnote={`${timestamp(cast.time)}${cancelled ? ' · cancelled' : ''}`}
                />
              );

              return (
                <HoverTooltip
                  key={index}
                  content={tip}
                  className="absolute inset-y-1 w-1 -translate-x-1/2"
                  style={{ left: `${toPercent(cast.time)}%` }}
                >
                  <span
                    className={`block h-full w-px ${
                      cancelled ? 'bg-crit-500' : cast.isAutoAttack ? 'bg-ink-600' : 'bg-good-500'
                    }`}
                  />
                </HoverTooltip>
              );
            })}
          </div>
          <span className="w-10 shrink-0" />
        </div>

        <div className="flex items-center gap-3">
          <span className="w-20 shrink-0" />
          <div className="relative h-4 flex-1">
            {ticks.map((tick) => (
              <span
                key={tick}
                className="absolute -translate-x-1/2 font-mono text-[10px] text-ink-400"
                style={{ left: `${toPercent(tick)}%` }}
              >
                {timestamp(tick)}
              </span>
            ))}
          </div>
          <span className="w-10 shrink-0" />
        </div>
      </div>

      <p className="mt-4 text-xs text-ink-400">
        Green ticks are skills, grey ticks are auto-attacks, red ticks are casts that were cancelled before they fired.
        Blades height and brightness show stack count (average on the right). Alacrity and Quickness only appear here for
        support roles. Hover a cast for skill details.
      </p>
    </section>
  );
}
