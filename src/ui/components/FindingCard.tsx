import { useState } from 'react';
import type { SkillIndex } from '../../api/gw2.ts';
import type { TopProfessionLog } from '../../api/wingmanTopLog.ts';
import { timestamp } from '../../analysis/format.ts';
import type { Finding, Metric } from '../../analysis/types.ts';
import type { InferredBuild, ReferenceBuild } from '../../model/build.ts';
import { findingAnchorId } from '../findingNav.ts';
import { DropdownChevron } from './DropdownChevron.tsx';
import { HoverTooltip } from './HoverTooltip.tsx';
import { SkillLinkedText } from './SkillLinkedText.tsx';
import { SEVERITY_STYLES } from './severity.ts';

interface LinkContext {
  skills?: SkillIndex;
  build?: InferredBuild;
  reference?: ReferenceBuild;
}

export interface PatchTopInsights {
  meta: TopProfessionLog;
  /**
   * Findings from re-running the user's analysis with the patch-top log as the
   * reference — same wording as a pasted reference log.
   */
  findings: Finding[];
}

/** Full CTA on the first card; compact strip on the rest. */
export type PatchTopPrompt = 'full' | 'compact';

function MetricBar({ metric, link }: { metric: Metric; link: LinkContext }) {
  const higherIsBetter = metric.higherIsBetter ?? true;
  const target = metric.target;
  const barMax = metric.barMax;

  // Shared comparison scale uses absolute width; otherwise keep the old
  // target-relative fill (inverted when lower is better).
  const fill =
    barMax && barMax > 0
      ? Math.max(0, Math.min(100, (metric.value / barMax) * 100))
      : target && target > 0
        ? Math.max(
            0,
            Math.min(100, higherIsBetter ? (metric.value / target) * 100 : (target / Math.max(metric.value, 0.001)) * 100),
          )
        : undefined;

  const quality =
    target !== undefined && target > 0
      ? higherIsBetter
        ? metric.value / target
        : target / Math.max(metric.value, 0.001)
      : fill !== undefined
        ? fill / 100
        : undefined;

  const barColor =
    quality === undefined
      ? 'bg-info-500'
      : quality >= 0.95
        ? 'bg-good-500'
        : quality >= 0.7
          ? 'bg-warn-500'
          : 'bg-crit-500';

  return (
    <div className="min-w-36 flex-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-ink-400">
          <SkillLinkedText text={metric.label} {...link} />
        </span>
        <span className="font-mono text-sm text-ink-200">{metric.display}</span>
      </div>
      {fill !== undefined && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-700">
          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${fill}%` }} />
        </div>
      )}
    </div>
  );
}

function FindingBody({
  finding,
  link,
  compact = false,
}: {
  finding: Finding;
  link: LinkContext;
  compact?: boolean;
}) {
  const style = SEVERITY_STYLES[finding.severity];
  const hasDetails = !!(finding.detail || finding.fix || finding.evidence?.length || finding.caveat);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3
          className={`inline-flex min-w-0 items-start gap-1.5 font-semibold text-white ${
            compact ? 'text-sm' : 'text-base'
          }`}
        >
          <span className="min-w-0">
            <SkillLinkedText text={finding.title} {...link} />
          </span>
          {finding.tip && (
            <HoverTooltip
              content={<p className="max-w-xs text-xs leading-relaxed text-ink-200">{finding.tip}</p>}
              className="mt-1 inline-flex shrink-0"
            >
              <button
                type="button"
                className="inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full text-[10px] font-semibold leading-none text-ink-400 ring-1 ring-inset ring-ink-500 transition hover:text-ink-200 hover:ring-ink-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                aria-label="More about this finding"
              >
                i
              </button>
            </HoverTooltip>
          )}
        </h3>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style.chip}`}>
          {style.label}
        </span>
      </div>

      <p className={`mt-2 leading-relaxed text-ink-200 ${compact ? 'text-xs' : 'text-sm'}`}>
        <SkillLinkedText text={finding.summary} {...link} />
      </p>

      {finding.metrics && finding.metrics.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-4">
          {finding.metrics.map((metric) => (
            <MetricBar key={metric.label} metric={metric} link={link} />
          ))}
        </div>
      )}

      {finding.insights && finding.insights.length > 0 && (
        <div className="mt-3 space-y-2">
          {finding.insights.map((insight) => (
            <div key={insight.title} className="rounded-lg bg-ink-800/80 p-3 ring-1 ring-inset ring-ink-700">
              <h4 className="text-xs font-semibold tracking-wide text-ink-400 uppercase">
                <SkillLinkedText text={insight.title} {...link} />
              </h4>
              <p className="mt-1 text-sm leading-relaxed text-ink-200">
                <SkillLinkedText text={insight.summary} {...link} />
              </p>
              {insight.metrics && insight.metrics.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-4">
                  {insight.metrics.map((metric) => (
                    <MetricBar key={metric.label} metric={metric} link={link} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {hasDetails && (
        <details className={`group ${compact ? 'mt-2' : 'mt-3'}`}>
          <summary
            className={`flex cursor-pointer list-none items-center gap-1.5 font-medium text-brand-400 hover:text-brand-500 [&::-webkit-details-marker]:hidden ${
              compact ? 'text-xs' : 'text-sm'
            }`}
          >
            <DropdownChevron />
            <span className="group-open:hidden">Show details</span>
            <span className="hidden group-open:inline">Hide details</span>
          </summary>

          <div className={`space-y-3 border-l-2 border-ink-700 pl-4 ${compact ? 'mt-2' : 'mt-3'}`}>
            {finding.detail && (
              <p className={`leading-relaxed text-ink-400 ${compact ? 'text-xs' : 'text-sm'}`}>
                <SkillLinkedText text={finding.detail} {...link} />
              </p>
            )}

            {finding.fix && (
              <div>
                <h4 className="text-xs font-semibold tracking-wide text-ink-400 uppercase">What to do</h4>
                <p className={`mt-1 leading-relaxed text-ink-200 ${compact ? 'text-xs' : 'text-sm'}`}>
                  <SkillLinkedText text={finding.fix} {...link} />
                </p>
              </div>
            )}

            {finding.evidence && finding.evidence.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold tracking-wide text-ink-400 uppercase">From the log</h4>
                <ul className="mt-1 space-y-1">
                  {finding.evidence.map((item, index) => (
                    <li key={`${item.time}-${index}`} className={`flex gap-3 ${compact ? 'text-xs' : 'text-sm'}`}>
                      {item.time > 0 && (
                        <span className="shrink-0 font-mono text-xs text-ink-400">{timestamp(item.time)}</span>
                      )}
                      <span className="text-ink-200">
                        <SkillLinkedText text={item.label} {...link} />
                        {item.detail && (
                          <span className="text-ink-400">
                            {' '}
                            — <SkillLinkedText text={item.detail} {...link} />
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {finding.caveat && (
              <p className="rounded-lg bg-ink-800 p-3 text-xs leading-relaxed text-ink-400">
                <span className="font-semibold text-ink-200">Caveat: </span>
                <SkillLinkedText text={finding.caveat} {...link} />
              </p>
            )}
          </div>
        </details>
      )}
    </>
  );
}

function PatchTopPanel({
  patchTop,
  prompt,
  link,
}: {
  patchTop: PatchTopInsights;
  prompt: PatchTopPrompt;
  link: LinkContext;
}) {
  const [open, setOpen] = useState(false);
  const dps = Math.round(patchTop.meta.dps).toLocaleString();
  const subtitle = `${patchTop.meta.playerName ? `${patchTop.meta.playerName} · ` : ''}${
    patchTop.meta.profession
  } · ${dps} dps`;
  // Inner panel snaps to its final width; the aside animates and clips — so text never reflows mid-move.
  const widthClass = open ? 'md:w-80' : prompt === 'full' ? 'md:w-56' : 'md:w-10';

  return (
    <aside
      className={`w-full overflow-hidden border-t border-ink-700 bg-ink-900/30 transition-[width] duration-[125ms] ease-out md:shrink-0 md:border-t-0 md:border-l ${widthClass}`}
    >
      <div className={`flex h-full flex-col ${widthClass}`}>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          title={open ? 'Hide patch-top reference insights' : 'Compare with patch-top log'}
          aria-label={open ? 'Hide patch-top reference insights' : 'Compare with patch-top log'}
          className={`cursor-pointer text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400 ${
            open
              ? 'flex items-start justify-between gap-2 px-3 py-3 hover:bg-ink-800/50'
              : prompt === 'full'
                ? 'flex min-h-24 flex-1 flex-col items-start justify-center gap-1 px-4 py-3 hover:bg-ink-800/50'
                : 'flex min-h-11 flex-1 items-center justify-center gap-2 px-3 py-2.5 text-ink-400 hover:bg-ink-800/50 hover:text-brand-400 md:flex-col md:gap-3 md:px-0 md:py-4'
          }`}
        >
          {open ? (
            <>
              <div className="min-w-0">
                <p className="truncate text-[10px] font-semibold tracking-wide whitespace-nowrap text-ink-400 uppercase">
                  With patch top as reference
                </p>
                <p className="mt-0.5 truncate text-xs whitespace-nowrap text-ink-400">{subtitle}</p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 pt-0.5 text-xs font-medium text-ink-400">
                <DropdownChevron open />
              </span>
            </>
          ) : prompt === 'full' ? (
            <>
              <span className="text-[10px] font-semibold tracking-wide text-ink-400 uppercase">Patch top</span>
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-400">
                Get insights from this log
                <DropdownChevron open={false} />
              </span>
              <span className="text-xs text-ink-400">
                {patchTop.meta.profession} · {dps} dps
              </span>
            </>
          ) : (
            <>
              <DropdownChevron open={false} className="md:order-2" />
              <span className="text-[11px] font-medium tracking-wide uppercase md:hidden">vs top</span>
              <span
                className="hidden text-[11px] font-medium tracking-wide uppercase md:inline"
                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
              >
                vs top
              </span>
            </>
          )}
        </button>

        <div
          aria-hidden={!open}
          className={`grid transition-[grid-template-rows,opacity] duration-[125ms] ease-out ${
            open ? 'grid-rows-[1fr] opacity-100' : 'pointer-events-none grid-rows-[0fr] opacity-0'
          }`}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="space-y-3 border-t border-ink-700/80 px-3 py-3">
              <a
                href={patchTop.meta.permalink}
                target="_blank"
                rel="noreferrer"
                tabIndex={open ? 0 : -1}
                className="inline-block text-xs text-brand-400 hover:underline"
              >
                Open top log
              </a>

              <div className="max-h-80 space-y-3 overflow-auto md:max-h-none">
                {patchTop.findings.length === 0 ? (
                  <p className="text-xs leading-relaxed text-ink-400">
                    Comparing against the patch-top log did not add reference insights for this finding.
                  </p>
                ) : (
                  patchTop.findings.map((finding, index) => (
                    <div
                      key={`${finding.id}-${index}`}
                      className="rounded-lg bg-ink-850/80 p-3 ring-1 ring-inset ring-ink-700"
                    >
                      <FindingBody finding={finding} link={link} compact />
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

export function FindingCard({
  finding,
  skills,
  build,
  reference,
  patchTop,
  patchTopPrompt = 'full',
}: {
  finding: Finding;
  patchTop?: PatchTopInsights;
  patchTopPrompt?: PatchTopPrompt;
} & LinkContext) {
  const style = SEVERITY_STYLES[finding.severity];
  const link: LinkContext = { skills, build, reference };

  return (
    <article
      id={findingAnchorId(finding.id)}
      className="scroll-mt-6 overflow-hidden rounded-xl border border-ink-700 bg-ink-850/70 transition-[box-shadow]"
    >
      <div className={`h-0.5 w-full ${style.bar}`} />
      <div className={patchTop ? 'flex flex-col md:flex-row' : undefined}>
        <div className="min-w-0 flex-1 p-4">
          <FindingBody finding={finding} link={link} />
        </div>
        {patchTop && <PatchTopPanel patchTop={patchTop} prompt={patchTopPrompt} link={link} />}
      </div>
    </article>
  );
}
