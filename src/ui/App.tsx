import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { buildAiContext, formatAiContextForPrompt } from '../ai/buildAiContext.ts';
import { COOLDOWN_NORMAL_SUMMARY } from '../analysis/checks/cooldowns.ts';
import { IDLE_NORMAL_SUMMARY } from '../analysis/checks/downtime.ts';
import { applyDamageScoreFloor } from '../analysis/engine.ts';
import type { Finding, Severity } from '../analysis/types.ts';
import { AiChatPanel } from './components/AiChatPanel.tsx';
import { BuildPanel } from './components/BuildPanel.tsx';
import { CollapsiblePanel } from './components/CollapsiblePanel.tsx';
import { FindingCard } from './components/FindingCard.tsx';
import { LogForm, type FormValues } from './components/LogForm.tsx';
import { SummaryHeader } from './components/SummaryHeader.tsx';
import {
  runAnalysisRequest,
  type AnalysisBundle,
  type PatchTopLogBundle,
  type RunnerProgress,
} from './analysisRunner.ts';
import { SettingsModal } from './settings/SettingsModal.tsx';
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

/** True when the compared finding already carries reference dialogue/metrics. */
function hasReferenceDialogue(finding: Finding): boolean {
  if (finding.metrics?.some((metric) => /reference/i.test(metric.label))) return true;
  if (finding.tip && /reference/i.test(finding.tip)) return true;
  return /reference/i.test(finding.summary);
}

/** Reference-log findings that belong beside a specific execution check. */
function relatedReferenceLogFindings(finding: Finding, compared: Finding[]): Finding[] {
  return compared.filter((candidate) => {
    if (candidate.checkId !== 'reference-log') return false;
    const id = candidate.id;
    switch (finding.checkId) {
      case 'auto-attack-chain':
        return id.includes('auto-chains');
      case 'wasted-casts':
        // Aborted-cast comparison only belongs on aborted findings — not on animation-cancel saves.
        return finding.id.includes('aborted') && id.includes('aborted');
      case 'boon-uptime':
        return id.includes('boon');
      default:
        return false;
    }
  });
}

/**
 * Side-panel content when the patch-top log is used as a hidden reference.
 * Prefer the same finding re-run with reference dialogue when that adds
 * comparison text; otherwise fall back to the dedicated reference-log finding
 * for that topic. Never show both — they repeat the same numbers.
 * Build / DPS / cast-rate overview findings live in the end-of-report box.
 */
function patchTopInsightsFor(finding: Finding, compared: Finding[]): Finding[] {
  const matched = compared.filter((candidate) => candidate.id === finding.id);
  const related = relatedReferenceLogFindings(finding, compared);
  const enriched = matched.filter(hasReferenceDialogue);
  return enriched.length > 0 ? enriched : related.length > 0 ? related : [];
}

/** Overview findings for the patch-top summary box (build match, DPS, cast rates, …). */
function patchTopOverviewFindings(compared: Finding[]): Finding[] {
  return compared.filter((finding) => {
    if (finding.checkId === 'build-match') return true;
    if (finding.checkId !== 'reference-log') return false;
    const id = finding.id;
    return (
      id.includes('/dps') ||
      id.includes('/casts') ||
      id.includes('/damage-modifiers') ||
      id.includes('/profession')
    );
  });
}

/** Good "matches the reference" build findings stay hidden until the user opts in. */
function showFindingInMainList(
  finding: Finding,
  opts: {
    hasUserReferenceLog: boolean;
    hasUserReferenceBuild: boolean;
    /** Findings that look normal vs the auto patch-top log. */
    suppressNormalIds: ReadonlySet<string>;
  },
): boolean {
  if (opts.suppressNormalIds.has(finding.id)) return false;
  if (finding.checkId !== 'build-match' || finding.severity !== 'good') return true;
  return opts.hasUserReferenceLog || opts.hasUserReferenceBuild;
}

/** Finding ids that look in-line with the auto patch-top log and should leave the main list. */
function normalVsPatchTopIds(compared: Finding[]): Set<string> {
  const ids = new Set<string>();
  for (const finding of compared) {
    if (finding.id === 'downtime/idle' && finding.summary === IDLE_NORMAL_SUMMARY) {
      ids.add(finding.id);
    }
    if (finding.id === 'cooldowns/held' && finding.summary === COOLDOWN_NORMAL_SUMMARY) {
      ids.add(finding.id);
    }
  }
  return ids;
}

export function App() {
  const [route, navigate] = useHashRoute();
  const [referenceBuildPage, setReferenceBuildPage] = useState<string | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    <div className="mx-auto max-w-6xl px-5 py-10">
      <header className="mb-8">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-3xl font-semibold tracking-tight text-white">GW2 Combat Coach</h1>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="mt-1 inline-flex shrink-0 items-center gap-2 rounded-xl border border-ink-700 bg-ink-850/70 px-3 py-2 text-sm font-medium text-ink-200 hover:border-ink-600 hover:bg-ink-800 hover:text-white"
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
          >
            <SettingsIcon />
            Settings
          </button>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-400">
          Reads an arcdps log through dps.report or GW2 Wingman and gives insights
        </p>
      </header>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

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
          hasUserReferenceLog={!!route.ref?.trim()}
          hasUserReferenceBuild={!!referenceBuildPage}
          onSelectPlayer={(player) => {
            setReferenceBuildPage(undefined);
            navigate({ ...route, player });
          }}
          onSelectReferenceBuild={setReferenceBuildPage}
        />
      )}

      <footer className="mt-16 border-t border-ink-800 pt-8">
        <div className="grid gap-6 sm:grid-cols-3 sm:items-start">
          <div>
            <p className="text-sm font-medium text-ink-200">GW2 Combat Coach</p>
            <p className="mt-1 max-w-sm text-xs leading-relaxed text-ink-400">
              Runs entirely in your browser. Log data is never uploaded or stored elsewhere.
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-center">
            <a
              href="https://ko-fi.com/jacobwittig"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-brand-500/40 bg-brand-500/15 px-4 py-2.5 text-sm font-semibold text-brand-400 transition-colors hover:border-brand-400 hover:bg-brand-500/25 hover:text-white"
            >
              <KoFiIcon />
              Support on Ko-fi
            </a>
            <p className="text-xs text-ink-400">
              Made by <span className="font-medium text-ink-200">navi.5047</span>
            </p>
          </div>
          <nav aria-label="Data sources" className="sm:text-right">
            <p className="text-[11px] font-medium tracking-wide text-ink-400 uppercase">Data sources</p>
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs sm:justify-end">
              <li>
                <a
                  href="https://dps.report"
                  target="_blank"
                  rel="noreferrer"
                  className="text-ink-200 underline-offset-2 transition-colors hover:text-brand-400 hover:underline"
                >
                  dps.report
                </a>
              </li>
              <li>
                <a
                  href="https://gw2wingman.nevermindcreations.de"
                  target="_blank"
                  rel="noreferrer"
                  className="text-ink-200 underline-offset-2 transition-colors hover:text-brand-400 hover:underline"
                >
                  GW2 Wingman
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/baaron4/GW2-Elite-Insights-Parser"
                  target="_blank"
                  rel="noreferrer"
                  className="text-ink-200 underline-offset-2 transition-colors hover:text-brand-400 hover:underline"
                >
                  Elite Insights
                </a>
              </li>
              <li>
                <a
                  href="https://wiki.guildwars2.com/wiki/API:Main"
                  target="_blank"
                  rel="noreferrer"
                  className="text-ink-200 underline-offset-2 transition-colors hover:text-brand-400 hover:underline"
                >
                  Guild Wars 2 API
                </a>
              </li>
              <li>
                <a
                  href="https://metabattle.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-ink-200 underline-offset-2 transition-colors hover:text-brand-400 hover:underline"
                >
                  MetaBattle
                </a>
              </li>
            </ul>
          </nav>
        </div>
        <p className="mt-6 border-t border-ink-800/80 pt-4 text-[11px] leading-relaxed text-ink-400">
          Guild Wars 2 and all associated content are trademarks or registered trademarks of ArenaNet and NCSOFT.
          This is an unofficial fan project and is not affiliated with or endorsed by ArenaNet or NCSOFT.
        </p>
      </footer>
    </div>
  );
}

function SettingsIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.4.7 1.2 1.1 2 1.1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

function KoFiIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 8h13v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8z" />
      <path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17" />
      <path d="M8 2v3M11 2v3M14 2v3" />
    </svg>
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
  hasUserReferenceLog,
  hasUserReferenceBuild,
  onSelectPlayer,
  onSelectReferenceBuild,
}: {
  bundle: AnalysisBundle;
  hasUserReferenceLog: boolean;
  hasUserReferenceBuild: boolean;
  onSelectPlayer: (player: string) => void;
  onSelectReferenceBuild: (page: string) => void;
}) {
  const {
    log,
    player,
    result,
    build,
    referenceBuild,
    referenceAlternatives,
    referencePlayer,
    warnings,
    skills,
  } = bundle;
  const [patchTop, setPatchTop] = useState<PatchTopLogBundle | undefined>();

  useEffect(() => {
    let cancelled = false;
    setPatchTop(undefined);
    if (!bundle.patchTopPromise) return;
    void bundle.patchTopPromise.then((value) => {
      if (!cancelled) setPatchTop(value);
    });
    return () => {
      cancelled = true;
    };
  }, [bundle.patchTopPromise]);

  const suppressNormalIds =
    !hasUserReferenceLog && patchTop
      ? normalVsPatchTopIds(patchTop.comparedResult.findings)
      : new Set<string>();
  const listOpts = {
    hasUserReferenceLog,
    hasUserReferenceBuild,
    suppressNormalIds,
  };
  const mainFindings = result.findings.filter((finding) => showFindingInMainList(finding, listOpts));
  const hiddenFindings = result.findings
    .filter((finding) => !showFindingInMainList(finding, listOpts))
    .map((finding) => {
      // Prefer the patch-top comparison wording for suppressed "looks normal" findings.
      if (suppressNormalIds.has(finding.id) && patchTop) {
        return (
          patchTop.comparedResult.findings.find((candidate) => candidate.id === finding.id) ?? finding
        );
      }
      return finding;
    });
  const patchTopOverview = patchTop ? patchTopOverviewFindings(patchTop.comparedResult.findings) : [];
  const firstPatchTopIndex = patchTop
    ? mainFindings.findIndex(
        (finding) => patchTopInsightsFor(finding, patchTop.comparedResult.findings).length > 0,
      )
    : -1;
  // Pasted reference already floors in the engine; otherwise use the auto top log.
  const score =
    !hasUserReferenceLog && patchTop
      ? applyDamageScoreFloor(result.score, player.dps, patchTop.player.dps)
      : result.score;
  const compare =
    hasUserReferenceLog && referencePlayer
      ? { dps: referencePlayer.dps, cleaveDps: referencePlayer.cleaveDps, label: 'reference' }
      : patchTop
        ? { dps: patchTop.player.dps, cleaveDps: patchTop.player.cleaveDps, label: 'top log' }
        : undefined;
  const findingIds = [
    ...result.findings.map((finding) => finding.id),
    ...(patchTop?.comparedResult.findings.map((finding) => finding.id) ?? []),
  ];
  const hiddenFindingIds = hiddenFindings.map((finding) => finding.id);

  const compareDps = compare?.dps;
  const compareCleaveDps = compare?.cleaveDps;
  const compareLabel = compare?.label;
  const aiContext = useMemo(
    () =>
      buildAiContext({
        log,
        player,
        score,
        findings: result.findings,
        build,
        referenceBuild,
        compare:
          compareDps != null && compareCleaveDps != null && compareLabel
            ? { dps: compareDps, cleaveDps: compareCleaveDps, label: compareLabel }
            : undefined,
      }),
    [
      log,
      player,
      score,
      result.findings,
      build,
      referenceBuild,
      compareDps,
      compareCleaveDps,
      compareLabel,
    ],
  );
  const aiContextText = useMemo(() => formatAiContextForPrompt(aiContext), [aiContext]);
  const aiConversationKey = `${log.source.kind}:${log.source.id}:${player.name}:${score}`;

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
        score={score}
        players={log.players}
        onSelectPlayer={onSelectPlayer}
        referenceBuild={referenceBuild}
        build={build}
        skills={skills}
        compare={compare}
        findingIds={findingIds}
        hiddenFindingIds={hiddenFindingIds}
      />

      <AiChatPanel
        context={aiContext}
        contextText={aiContextText}
        conversationKey={aiConversationKey}
      />

      {SEVERITY_SECTIONS.map((section) => {
        const findings = mainFindings.filter((finding) => finding.severity === section.severity);
        if (findings.length === 0) return null;
        return (
          <section key={section.severity}>
            <h2 className="text-sm font-semibold tracking-wide text-ink-400 uppercase">{section.heading}</h2>
            <p className="mt-0.5 text-xs text-ink-400">{section.blurb}</p>
            <div className="mt-3 space-y-3">
              {findings.map((finding, index) => {
                const globalIndex = mainFindings.indexOf(finding);
                const sideFindings = patchTop
                  ? patchTopInsightsFor(finding, patchTop.comparedResult.findings)
                  : [];
                return (
                  <FindingCard
                    key={`${finding.id}-${index}`}
                    finding={finding}
                    skills={skills}
                    build={build}
                    reference={referenceBuild}
                    patchTopPrompt={globalIndex === firstPatchTopIndex ? 'full' : 'compact'}
                    patchTop={
                      patchTop && sideFindings.length > 0
                        ? {
                            meta: patchTop.meta,
                            findings: sideFindings,
                          }
                        : undefined
                    }
                  />
                );
              })}
            </div>
          </section>
        );
      })}

      <CollapsiblePanel
        title="Advanced"
        blurb={
          [
            patchTop ? 'Top log' : null,
            hiddenFindings.length > 0 ? 'Not shown above' : null,
            'What was checked',
          ]
            .filter(Boolean)
            .join(' · ')
        }
      >
        <div className="space-y-3">
          {patchTop && (
            <PatchTopInfoBox
              patchTop={patchTop}
              findings={patchTopOverview}
              skills={skills}
              build={build}
              reference={referenceBuild}
            />
          )}
          {hiddenFindings.length > 0 && (
            <HiddenFindingsBox
              findings={hiddenFindings}
              skills={skills}
              build={build}
              reference={referenceBuild}
            />
          )}
          <CollapsiblePanel
            title="What was checked"
            blurb={
              <>
                {result.checksRun.length} ran
                {result.checksSkipped.length > 0 ? `, ${result.checksSkipped.length} skipped` : ''}.
              </>
            }
          >
            <ul className="space-y-2">
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
          </CollapsiblePanel>
        </div>
      </CollapsiblePanel>

      <BuildPanel
        build={build}
        reference={referenceBuild}
        consumables={player.consumables}
        alternatives={referenceAlternatives}
        skills={skills}
        onSelectAlternative={onSelectReferenceBuild}
      />
    </div>
  );
}

function FindingsDropdown({
  title,
  blurb,
  findings,
  skills,
  build,
  reference,
  empty,
  headerExtra,
}: {
  title: string;
  blurb: string;
  findings: Finding[];
  skills: AnalysisBundle['skills'];
  build: AnalysisBundle['build'];
  reference: AnalysisBundle['referenceBuild'];
  empty: string;
  headerExtra?: ReactNode;
}) {
  return (
    <CollapsiblePanel title={title} blurb={blurb}>
      <div className="space-y-3">
        {headerExtra}
        {findings.length > 0 ? (
          findings.map((finding, index) => (
            <FindingCard
              key={`${finding.id}-${index}`}
              finding={finding}
              skills={skills}
              build={build}
              reference={reference}
            />
          ))
        ) : (
          <p className="text-sm text-ink-400">{empty}</p>
        )}
      </div>
    </CollapsiblePanel>
  );
}

function PatchTopInfoBox({
  patchTop,
  findings,
  skills,
  build,
  reference,
}: {
  patchTop: PatchTopLogBundle;
  findings: Finding[];
  skills: AnalysisBundle['skills'];
  build: AnalysisBundle['build'];
  reference: AnalysisBundle['referenceBuild'];
}) {
  const dps = Math.round(patchTop.meta.dps).toLocaleString();

  return (
    <FindingsDropdown
      title="Top log"
      blurb={`Current-patch highest ${patchTop.meta.profession} damage on this fight${
        patchTop.meta.playerName ? ` — ${patchTop.meta.playerName}` : ''
      }: ${dps} dps.`}
      findings={findings}
      skills={skills}
      build={build}
      reference={reference}
      empty="No extra build or DPS differences stood out against this log."
      headerExtra={
        <a
          href={patchTop.meta.permalink}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-sm text-brand-400 hover:underline"
        >
          Open top log
        </a>
      }
    />
  );
}

function HiddenFindingsBox({
  findings,
  skills,
  build,
  reference,
}: {
  findings: Finding[];
  skills: AnalysisBundle['skills'];
  build: AnalysisBundle['build'];
  reference: AnalysisBundle['referenceBuild'];
}) {
  return (
    <FindingsDropdown
      title="Not shown above"
      blurb={`${findings.length} ${findings.length === 1 ? 'finding was' : 'findings were'} left out of the main list — usually because they look normal for this fight or only confirm an auto-picked build.`}
      findings={findings}
      skills={skills}
      build={build}
      reference={reference}
      empty="Nothing is currently hidden."
    />
  );
}
