import type { Severity } from '../../analysis/types.ts';

export const SEVERITY_STYLES: Record<Severity, { label: string; chip: string; bar: string; text: string }> = {
  critical: {
    label: 'Costly',
    chip: 'bg-crit-500/15 text-crit-500 ring-crit-500/30',
    bar: 'bg-crit-500',
    text: 'text-crit-500',
  },
  warning: {
    label: 'Worth fixing',
    chip: 'bg-warn-500/15 text-warn-500 ring-warn-500/30',
    bar: 'bg-warn-500',
    text: 'text-warn-500',
  },
  info: {
    label: 'Worth a look',
    chip: 'bg-info-500/15 text-info-500 ring-info-500/30',
    bar: 'bg-info-500',
    text: 'text-info-500',
  },
  good: {
    label: 'Done well',
    chip: 'bg-good-500/15 text-good-500 ring-good-500/30',
    bar: 'bg-good-500',
    text: 'text-good-500',
  },
};
