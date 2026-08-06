import { useState, type ReactNode } from 'react';
import { DropdownChevron } from './DropdownChevron.tsx';

/** Card-style disclosure: stable header, chevron by the title, animated body. */
export function CollapsiblePanel({
  title,
  blurb,
  children,
  className = '',
  defaultOpen = false,
}: {
  title: string;
  blurb?: ReactNode;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`rounded-2xl border border-ink-700 bg-ink-850/70 ${className}`.trim()}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full cursor-pointer items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-ink-800/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400"
      >
        <DropdownChevron open={open} className="mt-1 text-brand-400" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold tracking-wide text-ink-400 uppercase">{title}</h2>
          {blurb !== undefined && blurb !== null && blurb !== false && (
            <div className="mt-1 text-sm text-ink-200">{blurb}</div>
          )}
        </div>
      </button>

      <div
        aria-hidden={!open}
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
          open ? 'grid-rows-[1fr] opacity-100' : 'pointer-events-none grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-ink-700 px-5 py-4">{children}</div>
        </div>
      </div>
    </section>
  );
}
