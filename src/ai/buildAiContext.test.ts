import { describe, expect, it } from 'vitest';
import type { Finding } from '../analysis/types.ts';
import { buildAiContext, formatAiContextForPrompt, selectFindingsForAi } from './buildAiContext.ts';

function finding(partial: Partial<Finding> & Pick<Finding, 'id' | 'severity' | 'title'>): Finding {
  return {
    checkId: 'test',
    summary: 'summary',
    ...partial,
  };
}

describe('selectFindingsForAi', () => {
  it('orders by severity then impact and caps the list', () => {
    const findings = [
      finding({ id: 'g', severity: 'good', title: 'Good', impact: 0 }),
      finding({ id: 'c2', severity: 'critical', title: 'Crit low', impact: 5 }),
      finding({ id: 'c1', severity: 'critical', title: 'Crit high', impact: 20 }),
      finding({ id: 'w', severity: 'warning', title: 'Warn', impact: 10 }),
    ];
    const selected = selectFindingsForAi(findings, 3);
    expect(selected.map((f) => f.id)).toEqual(['c1', 'c2', 'w']);
  });
});

describe('buildAiContext', () => {
  it('includes score, fight, player, and compact findings without evidence', () => {
    const packet = buildAiContext({
      log: {
        fightName: 'Vale Guardian',
        isCM: true,
        durationMs: 125_000,
        success: true,
      },
      player: {
        name: 'Test',
        profession: 'Virtuoso',
        dps: 32_450.6,
        cleaveDps: 40_100.2,
      },
      score: 78,
      findings: [
        finding({
          id: 'down',
          severity: 'warning',
          title: 'Downtime',
          summary: 'You idled too long',
          fix: 'Queue the next skill',
          impact: 8,
          tip: 'long tip ignored',
          caveat: 'approx',
          evidence: [{ time: 1000, label: 'idle' }],
          metrics: [
            { label: 'Idle', display: '4.2s', value: 4200 },
            { label: 'Extra', display: '1', value: 1 },
          ],
          insights: [{ title: 'nested', summary: 'should not appear at top level' }],
        }),
      ],
      build: { profession: 'Mesmer', specializations: ['Virtuoso', 'Dueling'] },
      referenceBuild: {
        name: 'Power Virtuoso',
        profession: 'Mesmer',
        eliteSpec: 'Virtuoso',
      },
      compare: { label: 'top log', dps: 38_000, cleaveDps: 45_000 },
    });

    expect(packet.fight).toEqual({
      name: 'Vale Guardian',
      challengeMode: true,
      durationSec: 125,
      success: true,
    });
    expect(packet.player).toEqual({
      name: 'Test',
      profession: 'Virtuoso',
      dps: 32451,
      cleaveDps: 40100,
    });
    expect(packet.score).toBe(78);
    expect(packet.build).toEqual({
      profession: 'Mesmer',
      specializations: ['Virtuoso', 'Dueling'],
    });
    expect(packet.referenceBuild).toEqual({
      name: 'Power Virtuoso',
      profession: 'Mesmer',
      eliteSpec: 'Virtuoso',
    });
    expect(packet.compare).toEqual({ label: 'top log', dps: 38000, cleaveDps: 45000 });
    expect(packet.findings).toHaveLength(1);
    expect(packet.findings[0]).toEqual({
      severity: 'warning',
      title: 'Downtime',
      summary: 'You idled too long',
      fix: 'Queue the next skill',
      impact: 8,
      metrics: [
        { label: 'Idle', display: '4.2s' },
        { label: 'Extra', display: '1' },
      ],
    });
    expect(packet.findings[0]).not.toHaveProperty('evidence');
    expect(packet.findings[0]).not.toHaveProperty('insights');
    expect(packet.findings[0]).not.toHaveProperty('tip');
    expect(JSON.stringify(packet)).not.toContain('nested');
  });

  it('formats a plain-text briefing with priorities and fixes', () => {
    const text = formatAiContextForPrompt(
      buildAiContext({
        log: {
          fightName: 'Vale Guardian',
          isCM: false,
          durationMs: 60_000,
          success: true,
        },
        player: { name: 'Test', profession: 'Virtuoso', dps: 30_000, cleaveDps: 35_000 },
        score: 70,
        findings: [
          finding({
            id: 'wasted',
            severity: 'critical',
            title: 'Wasted casts on Mind Wrath',
            summary: 'Mind Wrath was cancelled often',
            fix: 'Finish the auto chain before casting Mind Wrath',
            impact: 12,
          }),
          finding({
            id: 'good',
            severity: 'good',
            title: 'Blade economy solid',
            summary: 'Blades were spent on time',
          }),
        ],
      }),
    );

    expect(text).toContain('Target DPS = 30000');
    expect(text).toContain('PRIORITIES TO IMPROVE');
    expect(text).toContain('Wasted casts on Mind Wrath');
    expect(text).toContain('Fix: Finish the auto chain before casting Mind Wrath');
    expect(text).toContain('DONE WELL:');
    expect(text).toContain('Blade economy solid');
    expect(text).not.toContain('Priority weight:');
    expect(text).not.toContain('Detail:');
    expect(text).not.toContain('{');
  });
});

