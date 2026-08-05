import { useEffect, useRef, useState } from 'react';
import { supportedProfessions } from '../analysis/engine.ts';
import type { Severity } from '../analysis/types.ts';
import { BuildPanel } from './components/BuildPanel.tsx';
import { FindingCard } from './components/FindingCard.tsx';
import { LogForm, type FormValues } from './components/LogForm.tsx';
import { SummaryHeader } from './components/SummaryHeader.tsx';
import { Timeline } from './components/Timeline.tsx';
import { runAnalysisRequest, type AnalysisBundle, type RunnerProgress } from './analysisRunner.ts';
import { useHashRoute } from './useHashRoute.ts';

type Status =
  | { kind: 'idle' }
  | { kind: 'loading'; progress: RunnerProgress }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; bundle: AnalysisBundle };

const SEVERITY_SECTIONS: { severity: Severity; heading: string; blurb: string }[] = [
  { severity: 'critical', heading: 'Biggest losses', blurb: 'These cost you the most in this fight.' },
  { severity: 'warning', heading: 'Worth fixing', blurb: 'Clear improvements once the big items are handled.' },
  { severity: 'info', heading: 'Worth a look', blurb: 'Smaller or situational observations.' },
  { severity: 'good', heading: 'Done well', blurb: 'Things you already got right.' },
];

export function App() {
  const [route, navigate] = useHashRoute();
  const [referenceBuildPage, setReferenceBuildPage] = useState<string | undefined>();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const formDefaults = useRef<FormValues>({
    logInput: route.log ?? '',
    referenceLogInput: route.ref ?? '',
  });

  useEffect(() => {
    if (!route.log) {
      setStatus({ kind: 'idle' });
      return;
    }

    const controller = new AbortController();
    setStatus({ kind: 'loading', progress: { label: 'Starting' } });

    runAnalysisRequest(
      {
        logInput: route.log,
        referenceLogInput: route.ref,
        playerName: route.player,
        referenceBuildPage,
      },
      {
        signal: controller.signal,
        onProgress: (progress) => setStatus({ kind: 'loading', progress }),
      },
    )
      .then((bundle) => {
        if (controller.signal.aborted) return;
        setStatus({ kind: 'ready', bundle });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      });

    return () => controller.abort();
  }, [route.log, route.ref, route.player, referenceBuildPage]);

  const onSubmit = (values: FormValues) => {
    formDefaults.current = values;
    setReferenceBuildPage(undefined);
    navigate({ log: values.logInput, ref: values.referenceLogInput || undefined });
  };

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-white">GW2 Combat Coach</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-400">
          Reads an arcdps log through dps.report or GW2 Wingman and tells you what to fix: dropped auto-attack
          chains, cancelled casts, unused combo fields, boon gaps, and held cooldowns. Deep coaching currently covers{' '}
          {supportedProfessions().map((name) => name[0].toUpperCase() + name.slice(1)).join(', ')}; every other
          specialization still gets the general checks, and a MetaBattle raid build is chosen automatically for
          comparison.
        </p>
      </header>

      <LogForm initial={formDefaults.current} busy={status.kind === 'loading'} onSubmit={onSubmit} />

      {status.kind === 'idle' && <GettingStarted />}

      {status.kind === 'loading' && (
        <div className="mt-6 rounded-2xl border border-ink-700 bg-ink-850/70 p-5">
          <div className="flex items-center gap-3">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
            <div>
              <p className="text-sm font-medium text-white">{status.progress.label}</p>
              {status.progress.detail && <p className="text-xs text-ink-400">{status.progress.detail}</p>}
            </div>
          </div>
        </div>
      )}

      {status.kind === 'error' && (
        <div className="mt-6 rounded-2xl border border-crit-500/40 bg-crit-500/10 p-5">
          <h2 className="text-sm font-semibold text-crit-500">That log could not be analyzed</h2>
          <p className="mt-1 text-sm text-ink-200">{status.message}</p>
        </div>
      )}

      {status.kind === 'ready' && (
        <Results
          bundle={status.bundle}
          onSelectPlayer={(player) => {
            setReferenceBuildPage(undefined);
            navigate({ ...route, player });
          }}
          onSelectReferenceBuild={setReferenceBuildPage}
        />
      )}

      <footer className="mt-12 border-t border-ink-800 pt-6 text-xs leading-relaxed text-ink-400">
        <p>
          Log data comes from{' '}
          <a href="https://dps.report" target="_blank" rel="noreferrer" className="text-brand-400 hover:underline">
            dps.report
          </a>{' '}
          or{' '}
          <a
            href="https://gw2wingman.nevermindcreations.de"
            target="_blank"
            rel="noreferrer"
            className="text-brand-400 hover:underline"
          >
            GW2 Wingman
          </a>
          , parsed by Elite Insights. Skill, trait and combo data comes from the official Guild Wars 2 API. Raid build
          data comes from{' '}
          <a href="https://metabattle.com" target="_blank" rel="noreferrer" className="text-brand-400 hover:underline">
            MetaBattle
          </a>
          . Everything runs in your browser; no log data is sent anywhere else.
        </p>
        <p className="mt-2">
          Guild Wars 2 and all associated content are property of ArenaNet and NCSOFT. This is an unofficial fan
          project.
        </p>
      </footer>
    </div>
  );
}

function GettingStarted() {
  return (
    <section className="mt-6 grid gap-4 md:grid-cols-3">
      {[
        {
          title: 'Record a log',
          body: 'Run arcdps with logging enabled. Each encounter writes an .evtc or .zevtc file into your arcdps logs folder.',
        },
        {
          title: 'Upload it',
          body: 'Drop the file on dps.report or GW2 Wingman, or let an auto-upload tool do it. Copy the permalink it gives you back.',
        },
        {
          title: 'Paste it above',
          body: 'The report is read straight from the host in your browser. A MetaBattle raid build is picked automatically; optionally add a reference log too.',
        },
      ].map((step, index) => (
        <div key={step.title} className="rounded-2xl border border-ink-700 bg-ink-850/70 p-5">
          <div className="text-xs font-semibold text-brand-400">Step {index + 1}</div>
          <h2 className="mt-1 text-base font-semibold text-white">{step.title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-400">{step.body}</p>
        </div>
      ))}
    </section>
  );
}

function Results({
  bundle,
  onSelectPlayer,
  onSelectReferenceBuild,
}: {
  bundle: AnalysisBundle;
  onSelectPlayer: (player: string) => void;
  onSelectReferenceBuild: (page: string) => void;
}) {
  const { log, player, result, build, referenceBuild, referenceAlternatives, warnings, skills } = bundle;

  return (
    <div className="mt-6 space-y-6">
      {warnings.length > 0 && (
        <div className="rounded-2xl border border-warn-500/40 bg-warn-500/10 p-4">
          <ul className="space-y-1 text-sm text-ink-200">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <SummaryHeader
        log={log}
        player={player}
        score={result.score}
        players={log.players}
        onSelectPlayer={onSelectPlayer}
      />

      {SEVERITY_SECTIONS.map((section) => {
        const findings = result.findings.filter((finding) => finding.severity === section.severity);
        if (findings.length === 0) return null;
        return (
          <section key={section.severity}>
            <h2 className="text-sm font-semibold tracking-wide text-ink-400 uppercase">{section.heading}</h2>
            <p className="mt-0.5 text-xs text-ink-400">{section.blurb}</p>
            <div className="mt-3 space-y-3">
              {findings.map((finding) => (
                <FindingCard
                  key={finding.id}
                  finding={finding}
                  skills={skills}
                  build={build}
                  reference={referenceBuild}
                />
              ))}
            </div>
          </section>
        );
      })}

      <Timeline
        log={log}
        player={player}
        referenceBuild={referenceBuild}
        build={build}
        skills={skills}
      />

      <BuildPanel
        build={build}
        reference={referenceBuild}
        consumables={player.consumables}
        alternatives={referenceAlternatives}
        skills={skills}
        onSelectAlternative={onSelectReferenceBuild}
      />

      <section className="rounded-2xl border border-ink-700 bg-ink-850/70 p-5">
        <h2 className="text-sm font-semibold tracking-wide text-ink-400 uppercase">What was checked</h2>
        <ul className="mt-3 space-y-2">
          {result.checksRun.map((check) => (
            <li key={check.id} className="text-sm">
              <span className="text-good-500">✓</span>{' '}
              <span className="font-medium text-ink-200">{check.name}</span>{' '}
              <span className="text-ink-400">— {check.description}</span>
            </li>
          ))}
          {result.checksSkipped.map(({ check, reason }) => (
            <li key={check.id} className="text-sm">
              <span className="text-ink-600">–</span>{' '}
              <span className="font-medium text-ink-400">{check.name}</span>{' '}
              <span className="text-ink-600">— {reason}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
