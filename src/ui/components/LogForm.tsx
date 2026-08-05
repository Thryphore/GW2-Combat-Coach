import { useState, type FormEvent } from 'react';
import { CURATED_BUILDS } from '../../api/metabattle.ts';
import type { ReferenceBuildSelection } from '../analysisRunner.ts';

export interface FormValues {
  logInput: string;
  referenceLogInput: string;
  referenceBuild: ReferenceBuildSelection;
}

interface Props {
  initial: FormValues;
  busy: boolean;
  onSubmit: (values: FormValues) => void;
}

const inputClass =
  'w-full rounded-xl border border-ink-700 bg-ink-900 px-4 py-3 text-sm text-white placeholder:text-ink-600';

export function LogForm({ initial, busy, onSubmit }: Props) {
  const [logInput, setLogInput] = useState(initial.logInput);
  const [referenceLogInput, setReferenceLogInput] = useState(initial.referenceLogInput);
  const [buildChoice, setBuildChoice] = useState<string>(
    initial.referenceBuild.kind === 'metabattle' ? initial.referenceBuild.page : 'none',
  );
  const [customBuild, setCustomBuild] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    let referenceBuild: ReferenceBuildSelection = { kind: 'none' };
    if (buildChoice === 'custom') {
      const value = customBuild.trim();
      if (value.startsWith('[&')) referenceBuild = { kind: 'chat-code', code: value };
      else if (value) referenceBuild = { kind: 'metabattle', page: value };
    } else if (buildChoice !== 'none') {
      referenceBuild = { kind: 'metabattle', page: buildChoice };
    }
    onSubmit({ logInput: logInput.trim(), referenceLogInput: referenceLogInput.trim(), referenceBuild });
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border border-ink-700 bg-ink-850/70 p-5">
      <label htmlFor="log-input" className="block text-sm font-medium text-white">
        Log link
      </label>
      <p className="mt-1 text-xs text-ink-400">
        Paste a dps.report permalink. Upload your arcdps log there first; nothing is uploaded from this page.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <input
          id="log-input"
          value={logInput}
          onChange={(event) => setLogInput(event.target.value)}
          placeholder="https://dps.report/abcd-20260804-120000_boss"
          className={`${inputClass} min-w-64 flex-1`}
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={busy || !logInput.trim()}
          className="rounded-xl bg-brand-500 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Analyzing…' : 'Analyze'}
        </button>
      </div>

      <details className="group mt-4">
        <summary className="cursor-pointer list-none text-sm font-medium text-brand-400 hover:text-brand-500">
          <span className="group-open:hidden">Compare against a reference</span>
          <span className="hidden group-open:inline">Hide reference options</span>
        </summary>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="reference-log" className="block text-sm font-medium text-white">
              Reference log
            </label>
            <p className="mt-1 text-xs text-ink-400">
              A second log to diff against, such as a benchmark or a run you were happy with.
            </p>
            <input
              id="reference-log"
              value={referenceLogInput}
              onChange={(event) => setReferenceLogInput(event.target.value)}
              placeholder="https://dps.report/…"
              className={`${inputClass} mt-3`}
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          <div>
            <label htmlFor="reference-build" className="block text-sm font-medium text-white">
              Reference build
            </label>
            <p className="mt-1 text-xs text-ink-400">
              Compares your traits, skills and weapons against a published build.
            </p>
            <select
              id="reference-build"
              value={buildChoice}
              onChange={(event) => setBuildChoice(event.target.value)}
              className={`${inputClass} mt-3`}
            >
              <option value="none">None</option>
              {CURATED_BUILDS.map((build) => (
                <option key={build.id} value={build.page}>
                  {build.label} — {build.content} (MetaBattle)
                </option>
              ))}
              <option value="custom">Custom MetaBattle page or chat code…</option>
            </select>
            {buildChoice === 'custom' && (
              <input
                value={customBuild}
                onChange={(event) => setCustomBuild(event.target.value)}
                placeholder="https://metabattle.com/wiki/Build:… or [&DQcBHRga…]"
                className={`${inputClass} mt-3`}
                spellCheck={false}
                autoComplete="off"
              />
            )}
          </div>
        </div>
      </details>
    </form>
  );
}
