import type { SkillIndex } from '../../api/gw2.ts';
import { timestamp } from '../../analysis/format.ts';
import type { Finding, Metric } from '../../analysis/types.ts';
import type { InferredBuild, ReferenceBuild } from '../../model/build.ts';
import { SkillLinkedText } from './SkillLinkedText.tsx';
import { SEVERITY_STYLES } from './severity.ts';

interface LinkContext {
  skills?: SkillIndex;
  build?: InferredBuild;
  reference?: ReferenceBuild;
}

function MetricBar({ metric, link }: { metric: Metric; link: LinkContext }) {
  const higherIsBetter = metric.higherIsBetter ?? true;
  const target = metric.target;
  const fill =
    target && target > 0
      ? Math.max(0, Math.min(100, higherIsBetter ? (metric.value / target) * 100 : (target / Math.max(metric.value, 0.001)) * 100))
      : undefined;

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
          <div
            className={`h-full rounded-full ${fill >= 95 ? 'bg-good-500' : fill >= 70 ? 'bg-warn-500' : 'bg-crit-500'}`}
            style={{ width: `${fill}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function FindingCard({
  finding,
  skills,
  build,
  reference,
}: {
  finding: Finding;
} & LinkContext) {
  const style = SEVERITY_STYLES[finding.severity];
  const hasDetails = !!(finding.detail || finding.fix || finding.evidence?.length || finding.caveat);
  const link: LinkContext = { skills, build, reference };

  return (
    <article className="overflow-hidden rounded-xl border border-ink-700 bg-ink-850/70">
      <div className={`h-0.5 w-full ${style.bar}`} />
      <div className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h3 className="text-base font-semibold text-white">
            <SkillLinkedText text={finding.title} {...link} />
          </h3>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style.chip}`}>
            {style.label}
          </span>
        </div>

        <p className="mt-2 text-sm leading-relaxed text-ink-200">
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
          <details className="group mt-3">
            <summary className="cursor-pointer list-none text-sm font-medium text-brand-400 hover:text-brand-500">
              <span className="group-open:hidden">Show details</span>
              <span className="hidden group-open:inline">Hide details</span>
            </summary>

            <div className="mt-3 space-y-3 border-l-2 border-ink-700 pl-4">
              {finding.detail && (
                <p className="text-sm leading-relaxed text-ink-400">
                  <SkillLinkedText text={finding.detail} {...link} />
                </p>
              )}

              {finding.fix && (
                <div>
                  <h4 className="text-xs font-semibold tracking-wide text-ink-400 uppercase">What to do</h4>
                  <p className="mt-1 text-sm leading-relaxed text-ink-200">
                    <SkillLinkedText text={finding.fix} {...link} />
                  </p>
                </div>
              )}

              {finding.evidence && finding.evidence.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold tracking-wide text-ink-400 uppercase">From the log</h4>
                  <ul className="mt-1 space-y-1">
                    {finding.evidence.map((item, index) => (
                      <li key={`${item.time}-${index}`} className="flex gap-3 text-sm">
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
      </div>
    </article>
  );
}
