import { SEVERITY_ORDER, type Finding, type Severity } from '../analysis/types.ts';
import type { ReferenceBuild, InferredBuild } from '../model/build.ts';
import type { NormalizedLog, NormalizedPlayer } from '../model/normalize.ts';

const MAX_FINDINGS = 12;

export interface AiContextInput {
  log: Pick<NormalizedLog, 'fightName' | 'isCM' | 'durationMs' | 'success'>;
  player: Pick<NormalizedPlayer, 'name' | 'profession' | 'dps' | 'cleaveDps'>;
  score: number;
  findings: Finding[];
  build?: Pick<InferredBuild, 'profession' | 'specializations'>;
  referenceBuild?: Pick<ReferenceBuild, 'name' | 'eliteSpec' | 'profession'>;
  /** Optional patch-top / reference DPS for comparison questions. */
  compare?: { dps: number; cleaveDps: number; label: string };
}

export interface AiContextFinding {
  severity: Severity;
  title: string;
  summary: string;
  detail?: string;
  fix?: string;
  impact?: number;
  metrics?: { label: string; display: string }[];
}

export interface AiContextPacket {
  fight: {
    name: string;
    challengeMode: boolean;
    durationSec: number;
    success: boolean;
  };
  player: {
    name: string;
    profession: string;
    dps: number;
    cleaveDps: number;
  };
  score: number;
  build?: {
    profession: string;
    specializations: string[];
  };
  referenceBuild?: {
    name: string;
    profession: string;
    eliteSpec?: string;
  };
  compare?: {
    label: string;
    dps: number;
    cleaveDps: number;
  };
  findings: AiContextFinding[];
}

function formatDurationSec(ms: number): number {
  return Math.round(ms / 1000);
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function compactFinding(finding: Finding): AiContextFinding {
  const metrics = finding.metrics
    ?.slice(0, 6)
    .map((metric) => ({ label: metric.label, display: metric.display }));
  return {
    severity: finding.severity,
    title: finding.title,
    summary: finding.summary,
    ...(finding.detail ? { detail: truncate(finding.detail, 220) } : {}),
    ...(finding.fix ? { fix: finding.fix } : {}),
    ...(typeof finding.impact === 'number' ? { impact: finding.impact } : {}),
    ...(metrics && metrics.length > 0 ? { metrics } : {}),
  };
}

/** Rank findings for the model: biggest problems first, then goods last. */
export function selectFindingsForAi(findings: Finding[], limit = MAX_FINDINGS): Finding[] {
  return [...findings]
    .sort((a, b) => {
      const severity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (severity !== 0) return severity;
      return (b.impact ?? 0) - (a.impact ?? 0);
    })
    .slice(0, limit);
}

/** Compact packet for WebLLM prompts — no evidence, casts, or buff timelines. */
export function buildAiContext(input: AiContextInput): AiContextPacket {
  const packet: AiContextPacket = {
    fight: {
      name: input.log.fightName,
      challengeMode: input.log.isCM,
      durationSec: formatDurationSec(input.log.durationMs),
      success: input.log.success,
    },
    player: {
      name: input.player.name,
      profession: input.player.profession,
      dps: Math.round(input.player.dps),
      cleaveDps: Math.round(input.player.cleaveDps),
    },
    score: input.score,
    findings: selectFindingsForAi(input.findings).map(compactFinding),
  };

  if (input.build) {
    packet.build = {
      profession: input.build.profession,
      specializations: input.build.specializations,
    };
  }
  if (input.referenceBuild) {
    packet.referenceBuild = {
      name: input.referenceBuild.name,
      profession: input.referenceBuild.profession,
      ...(input.referenceBuild.eliteSpec ? { eliteSpec: input.referenceBuild.eliteSpec } : {}),
    };
  }
  if (input.compare) {
    packet.compare = {
      label: input.compare.label,
      dps: Math.round(input.compare.dps),
      cleaveDps: Math.round(input.compare.cleaveDps),
    };
  }

  return packet;
}

/** Plain-text briefing — small models follow this much better than JSON. */
export function formatAiContextForPrompt(packet: AiContextPacket): string {
  const lines: string[] = [
    'KEY FACTS (use these exact numbers for DPS/score questions):',
    `Target DPS = ${packet.player.dps}`,
    `Cleave DPS = ${packet.player.cleaveDps}`,
    `Execution score = ${packet.score} out of 100`,
    `Fight = ${packet.fight.name}${packet.fight.challengeMode ? ' (CM)' : ''}`,
    `Duration = ${packet.fight.durationSec} seconds (${packet.fight.success ? 'success' : 'fail'})`,
    `Player = ${packet.player.name} (${packet.player.profession})`,
  ];

  if (packet.build) {
    lines.push(`Build: ${packet.build.profession} — ${packet.build.specializations.join(', ') || 'unknown specs'}`);
  }
  if (packet.referenceBuild) {
    const elite = packet.referenceBuild.eliteSpec ? ` (${packet.referenceBuild.eliteSpec})` : '';
    lines.push(`Reference build: ${packet.referenceBuild.name}${elite}`);
  }
  if (packet.compare) {
    lines.push(
      `Compare (${packet.compare.label}): DPS ${packet.compare.dps}, cleave ${packet.compare.cleaveDps}`,
    );
  }

  const improve = packet.findings.filter((f) => f.severity === 'critical' || f.severity === 'warning');
  const notes = packet.findings.filter((f) => f.severity === 'info');
  const goods = packet.findings.filter((f) => f.severity === 'good');

  // Keep findings short for local models — long Detail/metrics get echoed as junk.
  const writeFinding = (finding: AiContextFinding, index: number) => {
    lines.push(`${index}. ${finding.title}`);
    lines.push(`   ${truncate(finding.summary, 160)}`);
    if (finding.fix) lines.push(`   Fix: ${truncate(finding.fix, 160)}`);
  };

  if (improve.length > 0) {
    lines.push('');
    lines.push('PRIORITIES TO IMPROVE (most important first):');
    improve.forEach((finding, index) => writeFinding(finding, index + 1));
  } else {
    lines.push('');
    lines.push('PRIORITIES TO IMPROVE: none flagged as critical/warning.');
  }

  if (notes.length > 0) {
    lines.push('');
    lines.push('OTHER NOTES:');
    notes.forEach((finding, index) => writeFinding(finding, index + 1));
  }

  if (goods.length > 0) {
    lines.push('');
    lines.push('DONE WELL:');
    goods.forEach((finding, index) => writeFinding(finding, index + 1));
  }

  return lines.join('\n');
}
