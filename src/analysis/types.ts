import type { SkillIndex } from '../api/gw2.ts';
import type { NormalizedLog, NormalizedPlayer } from '../model/normalize.ts';
import type { Interval } from '../model/timeline.ts';
import type { InferredBuild, ReferenceBuild } from '../model/build.ts';

export type Severity = 'critical' | 'warning' | 'info' | 'good';

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
  good: 3,
};

export interface Evidence {
  /** ms from log start. */
  time: number;
  label: string;
  detail?: string;
}

export interface Metric {
  label: string;
  /** Pre-formatted for display; `value` stays numeric for bars and sorting. */
  display: string;
  value: number;
  target?: number;
  /** Defaults to true; set false when a lower number is better. */
  higherIsBetter?: boolean;
}

export interface Finding {
  id: string;
  checkId: string;
  severity: Severity;
  title: string;
  summary: string;
  detail?: string;
  fix?: string;
  /** Where the analysis is approximate, say so on the finding itself. */
  caveat?: string;
  metrics?: Metric[];
  evidence?: Evidence[];
  /** Points deducted from the execution score, 0-100. */
  impact?: number;
}

export interface AnalysisContext {
  log: NormalizedLog;
  player: NormalizedPlayer;
  /** Window the analysis covers, normally the full fight. */
  window: Interval;
  skills?: SkillIndex;
  build?: InferredBuild;
  referenceBuild?: ReferenceBuild;
  reference?: {
    log: NormalizedLog;
    player: NormalizedPlayer;
  };
}

export interface Check {
  id: string;
  name: string;
  /** One-line explanation shown in the "what was checked" list. */
  description: string;
  /** Elite specialization or profession names this check is limited to. */
  professions?: string[];
  /** Returns a reason string when the check cannot run against this log. */
  applicable?: (context: AnalysisContext) => string | undefined;
  run: (context: AnalysisContext) => Finding[];
}

export interface AnalysisResult {
  findings: Finding[];
  /** 0-100 execution score derived from finding impacts. */
  score: number;
  checksRun: Check[];
  checksSkipped: { check: Check; reason: string }[];
}
