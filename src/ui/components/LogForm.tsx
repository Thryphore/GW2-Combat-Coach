import { useState, type FormEvent } from 'react';

export interface FormValues {
  logInput: string;
  referenceLogInput: string;
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

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit({ logInput: logInput.trim(), referenceLogInput: referenceLogInput.trim() });
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border border-ink-700 bg-ink-850/70 p-5">
      <label htmlFor="log-input" className="block text-sm font-medium text-white">
        Log link
      </label>
      <p className="mt-1 text-xs text-ink-400">
        Paste a dps.report or GW2 Wingman permalink. Nothing is uploaded from this page. A MetaBattle raid build is
        chosen automatically for comparison.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <input
          id="log-input"
          value={logInput}
          onChange={(event) => setLogInput(event.target.value)}
          placeholder="https://dps.report/… or https://gw2wingman.nevermindcreations.de/log/…"
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
          <span className="group-open:hidden">Compare against a reference log</span>
          <span className="hidden group-open:inline">Hide reference log</span>
        </summary>

        <div className="mt-4">
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
            placeholder="https://dps.report/… or Wingman log…"
            className={`${inputClass} mt-3`}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      </details>
    </form>
  );
}
