import { timestamp } from '../../analysis/format.ts';
import type { Finding, Metric } from '../../analysis/types.ts';
import { SEVERITY_STYLES } from './severity.ts';

function MetricBar({ metric }: { metric: Metric }) {
  const higherIsBetter = metric.higherIsBetter ?? true;
  const target = metric.target;
  const fill =
    target && target > 0
      ? Math.max(0, Math.min(100, higherIsBetter ? (metric.value / target) * 100 : (target / Math.max(metric.value, 0.001)) * 100))
      : undefined;

  return (
    <div className="min-w-36 flex-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-ink-400">{metric.label}</span>
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

export function FindingCard({ finding }: { finding: Finding }) {
  const style = SEVERITY_STYLES[finding.severity];
  const hasDetails = !!(finding.detail || finding.fix || finding.evidence?.length || finding.caveat);

  return (
    <article className="overflow-hidden rounded-xl border border-ink-700 bg-ink-850/70">
      <div className={`h-0.5 w-full ${style.bar}`} />
      <div className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h3 className="text-base font-semibold text-white">{finding.title}</h3>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style.chip}`}>
            {style.label}
          </span>
        </div>

        <p className="mt-2 text-sm leading-relaxed text-ink-200">{finding.summary}</p>

        {finding.metrics && finding.metrics.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-4">
            {finding.metrics.map((metric) => (
              <MetricBar key={metric.label} metric={metric} />
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
              {finding.detail && <p className="text-sm leading-relaxed text-ink-400">{finding.detail}</p>}

              {finding.fix && (
                <div>
                  <h4 className="text-xs font-semibold tracking-wide text-ink-400 uppercase">What to do</h4>
                  <p className="mt-1 text-sm leading-relaxed text-ink-200">{finding.fix}</p>
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
                          {item.label}
                          {item.detail && <span className="text-ink-400"> — {item.detail}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {finding.caveat && (
                <p className="rounded-lg bg-ink-800 p-3 text-xs leading-relaxed text-ink-400">
                  <span className="font-semibold text-ink-200">Caveat: </span>
                  {finding.caveat}
                </p>
              )}
            </div>
          </details>
        )}
      </div>
    </article>
  );
}
