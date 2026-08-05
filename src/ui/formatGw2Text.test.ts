import { describe, expect, it } from 'vitest';
import { formatGw2Text } from './formatGw2Text.ts';

describe('formatGw2Text', () => {
  it('strips ArenaNet markup and keeps readable text', () => {
    expect(
      formatGw2Text(
        '<c=@abilitytype>Shatter</c> skills deal more damage.<br><c=@reminder>Only once.</c>',
      ),
    ).toBe('Shatter skills deal more damage.\nOnly once.');
  });
});
