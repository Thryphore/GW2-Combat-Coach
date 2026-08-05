import { timestamp } from '../../analysis/format.ts';
import { findBuffId, type NormalizedLog, type NormalizedPlayer } from '../../model/normalize.ts';

const BOONS = ['Alacrity', 'Quickness', 'Fury', 'Might'];

interface Props {
  log: NormalizedLog;
  player: NormalizedPlayer;
}

export function Timeline({ log, player }: Props) {
  const span = Math.max(1, log.fullFight.end - log.fullFight.start);
  const toPercent = (ms: number) => ((ms - log.fullFight.start) / span) * 100;

  const rows = BOONS.map((name) => {
    const id = findBuffId(log, name);
    const timeline = id === undefined ? undefined : player.buffs.get(id);
    if (!timeline || timeline.uptimeMs(log.fullFight) <= 0) return null;
    return {
      name,
      uptime: timeline.uptimeRatio(log.fullFight),
      windows: timeline.activeWindows(log.fullFight),
    };
  }).filter((row): row is NonNullable<typeof row> => row !== null);

  const ticks = Array.from({ length: 6 }, (_, index) => (span / 5) * index);

  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-850/70 p-5">
      <h2 className="text-sm font-semibold tracking-wide text-ink-400 uppercase">Fight timeline</h2>

      <div className="mt-4 space-y-3">
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
            {player.casts.map((cast, index) => (
              <div
                key={index}
                className={`absolute inset-y-1 w-px ${
                  cast.timeGained < 0 ? 'bg-crit-500' : cast.isAutoAttack ? 'bg-ink-600' : 'bg-good-500'
                }`}
                style={{ left: `${toPercent(cast.time)}%` }}
                title={`${timestamp(cast.time)} ${cast.name}${cast.timeGained < 0 ? ' (cancelled)' : ''}`}
              />
            ))}
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
      </p>
    </section>
  );
}
