import { describe, expect, it } from 'vitest';
import { answerBasicLogQuestion } from './answerBasicQuestion.ts';
import type { AiContextPacket } from './buildAiContext.ts';

const packet: AiContextPacket = {
  fight: {
    name: 'Vale Guardian',
    challengeMode: true,
    durationSec: 125,
    success: true,
  },
  player: {
    name: 'Test',
    profession: 'Virtuoso',
    dps: 33668,
    cleaveDps: 40100,
  },
  score: 72,
  findings: [
    {
      severity: 'critical',
      title: '1m 55s with nothing being cast',
      summary: 'Idle time',
      fix: 'When you have nothing off cooldown, auto-attack.',
      impact: 20,
    },
    {
      severity: 'warning',
      title: 'Wasted casts on Mind Wrath',
      summary: 'Mind Wrath cancelled',
      fix: 'Finish Mind Wrath casts',
      impact: 8,
    },
    {
      severity: 'info',
      title: '4 reference skills were never cast',
      summary:
        "Shielding Hands, Gladiator's Defense were used in the reference build but not in your rotation.",
      fix: 'If slotted, those skills are occupying a slot for free.',
    },
    {
      severity: 'good',
      title: 'Trait selection matches the reference build',
      summary: 'Traits matched',
      fix: 'Keep your traits',
    },
  ],
};

describe('answerBasicLogQuestion', () => {
  it('answers DPS from the packet without inventing impact numbers', () => {
    expect(answerBasicLogQuestion('What was my dps?', packet)).toBe(
      'Your target DPS was 33,668.',
    );
  });

  it('answers score and combined dps/score questions', () => {
    expect(answerBasicLogQuestion('What was my score?', packet)).toBe(
      'Your execution score was 72/100.',
    );
    expect(answerBasicLogQuestion('What was my dps and score?', packet)).toBe(
      'Your target DPS was 33,668. Your execution score was 72/100.',
    );
  });

  it('lists real improvement priorities with fixes', () => {
    const answer = answerBasicLogQuestion('How can I improve my dps?', packet);
    expect(answer).toContain('Top things to improve');
    expect(answer).toContain('1m 55s with nothing being cast');
    expect(answer).toContain('Wasted casts on Mind Wrath');
  });

  it('returns only the top focus when asked for one thing / the most', () => {
    const answer = answerBasicLogQuestion(
      'Tell me one thing I can focus on that would improve my dps the most',
      packet,
    );
    expect(answer).toContain('Biggest DPS lever');
    expect(answer).toContain('1m 55s with nothing being cast');
    expect(answer).toContain('When you have nothing off cooldown, auto-attack.');
    expect(answer).not.toContain('Wasted casts on Mind Wrath');
    expect(answer).not.toContain('Trait selection');
  });

  it('does not answer a one-thing DPS question with the raw DPS number', () => {
    const answer = answerBasicLogQuestion(
      'Give me one specific thing that I could change to increase my dps the most',
      packet,
    );
    expect(answer).toContain('Biggest DPS lever');
    expect(answer).toContain('1m 55s with nothing being cast');
    expect(answer).not.toContain('Your target DPS was');
  });

  it('handles short follow-ups asking for just one thing', () => {
    const history = [
      { role: 'user' as const, content: 'How can I improve?' },
      {
        role: 'assistant' as const,
        content: 'Top things to improve from this log:\n1. Idle\n2. Other',
      },
    ];
    const answer = answerBasicLogQuestion('I just want one thing', packet, history);
    expect(answer).toContain('Biggest DPS lever');
    expect(answer).toContain('1m 55s with nothing being cast');
    expect(answer).not.toContain('[good]');
  });

  it('returns real info/good findings for other interesting insights', () => {
    const answer = answerBasicLogQuestion('other interesting insights', packet);
    expect(answer).toContain('Other noteworthy things');
    expect(answer).toContain('4 reference skills were never cast');
    expect(answer).toContain('Trait selection matches the reference build');
    expect(answer).not.toContain('Execution score =');
    expect(answer).not.toContain('Critical Skills');
    expect(answer).not.toContain('[warning]');
  });

  it('does not repeat the same insights block on “anything else”', () => {
    const history = [
      { role: 'user' as const, content: 'Give me some other interesting insights about this log' },
      {
        role: 'assistant' as const,
        content: answerBasicLogQuestion('Give me some other interesting insights about this log', packet)!,
      },
    ];
    const again = answerBasicLogQuestion('Anything else you can tell me?', packet, history);
    expect(again).not.toContain('Other noteworthy things');
    expect(again).toContain('damage-focused side');
    expect(again).toContain('1m 55s with nothing being cast');
  });

  it('leaves unknown questions unmatched so the local model can handle them', () => {
    expect(answerBasicLogQuestion('What is the meaning of life?', packet)).toBeUndefined();
  });

  it('admits healing is not in the report instead of inventing heal advice', () => {
    const answer = answerBasicLogQuestion('How was the healing?', packet);
    expect(answer).toContain("doesn't analyze healing");
    expect(answer).not.toContain('reference build');
  });

  it('answers movement tips from related findings or admits the gap', () => {
    const withMovement = {
      ...packet,
      findings: [
        ...packet.findings,
        {
          severity: 'warning' as const,
          title: '46 auto-attacks cancelled mid-swing',
          summary: 'Autos interrupted',
          fix: 'These are usually caused by moving or dodging right after pressing 1.',
        },
      ],
    };
    const related = answerBasicLogQuestion('How about movement tips?', withMovement);
    expect(related).toContain("don't analyze pathing");
    expect(related).toContain('46 auto-attacks cancelled mid-swing');
    expect(related).toContain('moving or dodging');
    expect(related).not.toContain('Priorities:');

    const history = [
      { role: 'user' as const, content: 'How can I improve?' },
      {
        role: 'assistant' as const,
        content: 'Top things to improve from this log:\n1. Idle',
      },
    ];
    const unrelated = answerBasicLogQuestion('How about movement tips?', packet, history);
    expect(unrelated).toContain("doesn't include general movement");
    expect(unrelated).not.toContain('Alac Spaghetti');
    expect(unrelated).not.toContain('Priorities:');
  });
});


