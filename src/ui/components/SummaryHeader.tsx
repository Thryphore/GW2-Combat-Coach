import { scoreLabel } from '../../analysis/engine.ts';
import { compactNumber, duration } from '../../analysis/format.ts';
import type { NormalizedLog, NormalizedPlayer } from '../../model/normalize.ts';

function ScoreRing({ score }: { score: number }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const dash = (score / 100) * circumference;
  const color = score >= 85 ? 'var(--color-good-500)' : score >= 65 ? 'var(--color-warn-500)' : 'var(--color-crit-500)';

  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={radius} fill="none" stroke="var(--color-ink-700)" strokeWidth="6" />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold text-white">{score}</span>
        <span className="text-[10px] tracking-wide text-ink-400 uppercase">score</span>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs tracking-wide text-ink-400 uppercase">{label}</div>
      <div className="mt-0.5 font-mono text-lg text-white">{value}</div>
    </div>
  );
}

interface Props {
  log: NormalizedLog;
  player: NormalizedPlayer;
  score: number;
  players: NormalizedPlayer[];
  onSelectPlayer: (name: string) => void;
}

export function SummaryHeader({ log, player, score, players, onSelectPlayer }: Props) {
  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-850/70 p-5">
      <div className="flex flex-wrap items-center gap-5">
        <ScoreRing score={score} />

        <div className="min-w-56 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-white">{log.fightName}</h2>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                log.success
                  ? 'bg-good-500/15 text-good-500 ring-good-500/30'
                  : 'bg-crit-500/15 text-crit-500 ring-crit-500/30'
              }`}
            >
              {log.success ? 'Kill' : 'Failed'}
            </span>
            {log.isCM && (
              <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-xs font-medium text-brand-400 ring-1 ring-brand-500/30 ring-inset">
                Challenge mode
              </span>
            )}
          </div>

          <p className="mt-1 text-sm text-ink-400">
            {scoreLabel(score)} execution ·{' '}
            <a
              href={log.source.permalink}
              target="_blank"
              rel="noreferrer"
              className="text-brand-400 underline-offset-2 hover:underline"
            >
              open on {log.source.serviceName}
            </a>
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor="player-select" className="text-xs tracking-wide text-ink-400 uppercase">
              Analyzing
            </label>
            <select
              id="player-select"
              value={player.name}
              onChange={(event) => onSelectPlayer(event.target.value)}
              className="rounded-lg border border-ink-700 bg-ink-800 px-2 py-1 text-sm text-white"
            >
              {players.map((candidate) => (
                <option key={candidate.name} value={candidate.name}>
                  {candidate.name} — {candidate.profession}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-6">
          <Stat label="DPS" value={compactNumber(player.dps)} />
          <Stat label="Damage" value={compactNumber(player.damage)} />
          <Stat label="Duration" value={duration(log.durationMs)} />
          <Stat label="Deaths" value={String(player.deaths)} />
        </div>
      </div>
    </section>
  );
}
