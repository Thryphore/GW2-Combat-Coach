import { describe, expect, it } from 'vitest';
import { sanitizeModelReply } from './sanitizeModelReply.ts';

describe('sanitizeModelReply', () => {
  it('removes markdown bold/headers and nested plus bullets', () => {
    const raw = [
      '**How was the healing?**',
      '',
      '* Your healing was not effective.',
      '',
      '**Top priorities:**',
      '* **1. Critical: idle**',
      '\t+ What: lots of idle',
      '\t+ Priority weight: 20 (not DPS)',
    ].join('\n');

    const cleaned = sanitizeModelReply(raw);
    expect(cleaned).not.toContain('**');
    expect(cleaned).not.toContain('\t+');
    expect(cleaned).toContain('How was the healing?');
    expect(cleaned).toContain('- Your healing was not effective.');
    expect(cleaned).toContain('- 1. Critical: idle');
    expect(cleaned).toContain('- What: lots of idle');
  });
});
