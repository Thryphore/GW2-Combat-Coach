import type { AiContextFinding, AiContextPacket } from './buildAiContext.ts';

export interface BasicChatTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

function normalizeQuestion(question: string): string {
  return question.toLowerCase().replace(/[?!.,]+$/g, '').trim();
}

function improvementFindings(packet: AiContextPacket) {
  return packet.findings.filter(
    (finding) => finding.severity === 'critical' || finding.severity === 'warning',
  );
}

function formatFindingLine(finding: AiContextFinding, index?: number): string {
  const prefix = index == null ? '' : `${index}. `;
  const fix = finding.fix ? ` — ${finding.fix}` : '';
  return `${prefix}${finding.title}${fix}`;
}

function formatTopFocus(packet: AiContextPacket): string {
  const top = improvementFindings(packet)[0];
  if (!top) {
    return 'No critical or warning findings on this log — nothing major stood out to fix.';
  }
  const fix = top.fix ? `\nFocus on this: ${top.fix}` : '';
  return `Biggest DPS lever from this log:\n${top.title}${fix}`;
}

function formatImproveList(packet: AiContextPacket): string {
  const items = improvementFindings(packet);
  if (items.length === 0) {
    return 'No critical or warning findings on this log — nothing major stood out to fix.';
  }
  return [
    'Top things to improve from this log:',
    ...items.slice(0, 6).map((finding, index) => formatFindingLine(finding, index + 1)),
  ].join('\n');
}

function formatOverview(packet: AiContextPacket): string {
  const lines = [
    `${packet.player.name} on ${packet.fight.name}${packet.fight.challengeMode ? ' (CM)' : ''}`,
    `Target DPS ${packet.player.dps.toLocaleString('en-US')} · cleave ${packet.player.cleaveDps.toLocaleString('en-US')} · score ${packet.score}/100 · ${packet.fight.durationSec}s`,
  ];

  const improve = improvementFindings(packet).slice(0, 5);
  if (improve.length > 0) {
    lines.push('', 'Priorities:');
    for (const [index, finding] of improve.entries()) {
      lines.push(formatFindingLine(finding, index + 1));
    }
  }

  const goods = packet.findings.filter((finding) => finding.severity === 'good').slice(0, 3);
  if (goods.length > 0) {
    lines.push('', 'Done well:');
    for (const finding of goods) {
      lines.push(`• ${finding.title}`);
    }
  }

  return lines.join('\n');
}

/** Info + good findings — the “other interesting stuff” beyond main DPS priorities. */
function formatOtherInsights(packet: AiContextPacket): string {
  const infos = packet.findings.filter((finding) => finding.severity === 'info');
  const goods = packet.findings.filter((finding) => finding.severity === 'good');

  if (infos.length === 0 && goods.length === 0) {
    return [
      'No extra info/good findings beyond the main priorities.',
      'Ask “How can I improve?” for the damage-focused list.',
    ].join('\n');
  }

  const lines = ['Other noteworthy things from this log (not inventing new issues):'];

  if (infos.length > 0) {
    lines.push('', 'Worth a look:');
    for (const finding of infos.slice(0, 8)) {
      lines.push(`• ${finding.title}`);
      lines.push(`  ${finding.summary}`);
      if (finding.fix) lines.push(`  ${finding.fix}`);
    }
  }

  if (goods.length > 0) {
    lines.push('', 'Done well:');
    for (const finding of goods.slice(0, 6)) {
      lines.push(`• ${finding.title}`);
      lines.push(`  ${finding.summary}`);
    }
  }

  return lines.join('\n');
}

function formatMatchedFinding(finding: AiContextFinding): string {
  const parts = [finding.title, finding.summary];
  if (finding.detail) parts.push(finding.detail);
  if (finding.fix) parts.push(`Fix: ${finding.fix}`);
  if (finding.metrics?.length) {
    parts.push(`Metrics: ${finding.metrics.map((m) => `${m.label} ${m.display}`).join('; ')}`);
  }
  return parts.join('\n');
}

/** Prefer the longest title that appears in the question so short words do not false-match. */
function findingMentionedInQuestion(
  q: string,
  packet: AiContextPacket,
): AiContextFinding | undefined {
  const ranked = [...packet.findings].sort((a, b) => b.title.length - a.title.length);
  for (const finding of ranked) {
    const title = finding.title.toLowerCase();
    if (title.length >= 12 && q.includes(title)) return finding;
    const words = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 3);
    if (words.length >= 3) {
      const hit = words.filter((word) => q.includes(word)).length;
      if (hit >= Math.min(4, words.length) && hit / words.length >= 0.6) return finding;
    }
  }
  return undefined;
}

function asksForSingleFocus(q: string): boolean {
  return (
    // "one thing", "one specific thing", "one concrete change", etc.
    /\bone(?:\s+\w+){0,4}\s+(thing|focus|tip|change|fix|priority)\b/.test(q) ||
    /\b(single thing|just one|only one)\b/.test(q) ||
    /\b(the )?(most important|biggest|top|main|primary) (thing|priority|issue|problem|fix|focus)\b/.test(
      q,
    ) ||
    /\b(improve|improvement|increase|help|raise|boost).{0,48}\bthe most\b/.test(q) ||
    /\b(dps|damage).{0,24}\bthe most\b/.test(q) ||
    /\bfocus on (first|the most)\b/.test(q) ||
    /^(just one|one|the first( one)?|number one|#1)$/.test(q)
  );
}

function asksForImproveList(q: string): boolean {
  return (
    /\b(improve|improvement|increase|fix|better|wrong|priorities|should i (work|focus)|how (do|can|should) i)\b/.test(
      q,
    ) ||
    /\b(critical skills?|biggest (issues?|problems?|losses?)|top findings)\b/.test(q) ||
    /^(what('s| is) (wrong|bad)|summarize( the)? (top )?findings)\b/.test(q)
  );
}

function asksForOverview(q: string): boolean {
  return (
    /\b(summarize|summary|overview|recap|rundown|review)\b/.test(q) ||
    /\b(tell me about|how did i do|how was my|rate my)\b/.test(q) ||
    /\b(my (log|fight|performance|run))\b/.test(q)
  );
}

function asksForOtherInsights(q: string): boolean {
  return (
    /\b(insight|insights|noteworthy|interesting|other (findings?|notes?|things?|stuff)|side notes?)\b/.test(
      q,
    ) || /\b(done well|what went well|positives?|good (things?|findings?))\b/.test(q)
  );
}

/** Vague “more please” follow-ups — should not repeat the last answer. */
function asksForMore(q: string): boolean {
  return (
    /\b(anything else|what else|tell me more|more details|another thing|something else)\b/.test(q) ||
    /^(and\??|more\??|else\??)$/.test(q)
  );
}

function asksForMovement(q: string): boolean {
  return /\b(movement|moving|positioning|dodge|dodges|kiting|strafe|strafing)\b/.test(q);
}

function asksForHealing(q: string): boolean {
  return /\b(heal|healing|heals|healer|hps|outh)\b/.test(q);
}

function findingText(finding: AiContextFinding): string {
  return [finding.title, finding.summary, finding.detail, finding.fix]
    .filter(Boolean)
    .join(' ');
}

function formatMovementTips(packet: AiContextPacket): string {
  const related = packet.findings.filter((finding) =>
    /\b(mov(?:e|ing|ement)?|dodge|position|strafe|kite)\b/i.test(findingText(finding)),
  );

  if (related.length === 0) {
    return [
      "This report doesn't include general movement or positioning tips (pathing, boss mechs, when to dodge).",
      'Closest combat notes are usually downtime and cancelled autos — ask “How can I improve?” for those.',
    ].join('\n');
  }

  return [
    "We don't analyze pathing or boss mechanics, but these findings mention movement:",
    ...related.slice(0, 5).map((finding) => {
      const advice = finding.fix ?? finding.summary;
      return `• ${finding.title}\n  ${advice}`;
    }),
  ].join('\n');
}

function looksLikeCoaching(q: string): boolean {
  return /\b(skill|skills|cast|casts|cooldown|downtime|auto-?attack|rotation|focus|finding|findings|trait|boon|advice|tips?|help|priority|idle|cancelled|cleave|phantasm|blade)\b/.test(
    q,
  );
}

type AnswerKind = 'insights' | 'improve' | 'overview' | 'focus' | 'stats';

function classifyAssistantReply(content: string): AnswerKind | undefined {
  if (/other noteworthy things/i.test(content)) return 'insights';
  if (/top things to improve/i.test(content)) return 'improve';
  if (/biggest dps lever/i.test(content)) return 'focus';
  if (/priorities:/i.test(content) || / · score \d+\/100 · /i.test(content)) return 'overview';
  if (/your target dps was|your cleave dps was|your execution score was/i.test(content)) {
    return 'stats';
  }
  if (/^\d+\.\s/m.test(content)) return 'improve';
  return undefined;
}

function recentAnswerKinds(history: BasicChatTurn[] | undefined): Set<AnswerKind> {
  const kinds = new Set<AnswerKind>();
  if (!history?.length) return kinds;
  for (const turn of history.slice(-8)) {
    if (turn.role !== 'assistant') continue;
    const kind = classifyAssistantReply(turn.content);
    if (kind) kinds.add(kind);
  }
  return kinds;
}

function recentImproveContext(history: BasicChatTurn[] | undefined): boolean {
  const kinds = recentAnswerKinds(history);
  return kinds.has('improve') || kinds.has('focus') || kinds.has('overview') || kinds.has('insights');
}

/** Next uncovered section, or a short “that’s all” wrap-up. */
function formatNextUnseen(packet: AiContextPacket, history: BasicChatTurn[] | undefined): string {
  const seen = recentAnswerKinds(history);
  const hasImprove = improvementFindings(packet).length > 0;
  const hasInsights = packet.findings.some(
    (finding) => finding.severity === 'info' || finding.severity === 'good',
  );

  if (!seen.has('improve') && hasImprove) {
    return `Here's the damage-focused side next:\n\n${formatImproveList(packet)}`;
  }
  if (!seen.has('insights') && hasInsights) {
    return formatOtherInsights(packet);
  }
  if (!seen.has('overview')) {
    return `Quick recap of the whole fight:\n\n${formatOverview(packet)}`;
  }
  if (!seen.has('focus') && hasImprove) {
    return formatTopFocus(packet);
  }

  return [
    "That's most of what this report can add without repeating itself.",
    `Headline numbers: target DPS ${packet.player.dps.toLocaleString('en-US')}, score ${packet.score}/100, ${packet.fight.durationSec}s on ${packet.fight.name}.`,
    'Ask about a specific finding title from the cards above if you want detail on one item.',
  ].join('\n');
}

/**
 * Answer common factual / coaching questions from the compiled packet without
 * calling the local LLM. Tiny models often garble these.
 */
export function answerBasicLogQuestion(
  question: string,
  packet: AiContextPacket,
  history?: BasicChatTurn[],
): string | undefined {
  const q = normalizeQuestion(question);
  if (!q) return undefined;

  const matched = findingMentionedInQuestion(q, packet);
  if (
    matched &&
    !asksForOverview(q) &&
    !asksForImproveList(q) &&
    !asksForSingleFocus(q) &&
    !asksForOtherInsights(q)
  ) {
    if (!/^(what('s| is)|how much|was my)?\s*(my )?(target )?dps\b/.test(q)) {
      return formatMatchedFinding(matched);
    }
  }

  const single = asksForSingleFocus(q);
  const improve = asksForImproveList(q);
  const overview = asksForOverview(q);
  const insights = asksForOtherInsights(q);
  const more = asksForMore(q);
  const followUpOne = single && recentImproveContext(history);
  const seen = recentAnswerKinds(history);

  // "one thing" / "the most" always wins over a raw DPS readout.
  if (single || followUpOne) {
    return formatTopFocus(packet);
  }

  if (asksForMovement(q)) {
    return formatMovementTips(packet);
  }

  if (asksForHealing(q)) {
    return [
      "This report doesn't analyze healing.",
      'It covers execution, damage, and build match for the selected player — not heal output or heal skill priority.',
    ].join('\n');
  }

  // "Anything else?" or repeating an insights ask → advance to unseen content.
  if (more || (insights && seen.has('insights'))) {
    return formatNextUnseen(packet, history);
  }

  if (insights) {
    return formatOtherInsights(packet);
  }

  if (overview) {
    return formatOverview(packet);
  }

  if (improve) {
    return formatImproveList(packet);
  }

  const asksScore = /\b(score|execution score|rating)\b/.test(q);
  const asksCleave = /\bcleave\b/.test(q);
  const asksDps = /\bdps\b/.test(q) || /\bdamage per second\b/.test(q);
  const asksDuration = /\b(duration|how long|fight length|fight time)\b/.test(q);
  const asksFight = /\b(fight|boss|encounter)\b/.test(q) && /\b(name|was it|which)\b/.test(q);

  const parts: string[] = [];

  if (asksDps && asksCleave) {
    parts.push(
      `Target DPS was ${packet.player.dps.toLocaleString('en-US')}; cleave DPS was ${packet.player.cleaveDps.toLocaleString('en-US')}.`,
    );
  } else if (asksCleave && !looksLikeCoaching(q)) {
    parts.push(`Your cleave DPS was ${packet.player.cleaveDps.toLocaleString('en-US')}.`);
  } else if (asksDps && !looksLikeCoaching(q)) {
    parts.push(`Your target DPS was ${packet.player.dps.toLocaleString('en-US')}.`);
  } else if (asksDps && looksLikeCoaching(q)) {
    return formatImproveList(packet);
  }

  if (asksScore) {
    parts.push(`Your execution score was ${packet.score}/100.`);
  }

  if (asksDuration) {
    parts.push(`The fight lasted ${packet.fight.durationSec} seconds.`);
  }

  if (asksFight) {
    parts.push(
      `The encounter was ${packet.fight.name}${packet.fight.challengeMode ? ' (CM)' : ''}.`,
    );
  }

  if (parts.length > 0) return parts.join(' ');

  // Leave truly unmatched questions to the selected local model.
  return undefined;
}
