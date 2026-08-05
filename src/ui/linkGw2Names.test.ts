import { describe, expect, it } from 'vitest';
import { SkillIndex, type ProfessionSnapshot } from '../api/gw2.ts';
import mesmerSnapshot from '../data/gw2/mesmer.json';
import { splitGw2Names } from './linkGw2Names.ts';

const skills = new SkillIndex(mesmerSnapshot as unknown as ProfessionSnapshot);

describe('splitGw2Names', () => {
  it('links skill names inside finding prose', () => {
    const parts = splitGw2Names(
      'The largest difference is Flying Cutter: 77.4 casts per minute against 83.9.',
      skills,
    );
    expect(parts).toEqual([
      { kind: 'text', value: 'The largest difference is ' },
      expect.objectContaining({ kind: 'skill', name: 'Flying Cutter' }),
      { kind: 'text', value: ': 77.4 casts per minute against 83.9.' },
    ]);
  });

  it('prefers the longest matching name', () => {
    const parts = splitGw2Names('Chaos Storm landed cleanly.', skills);
    expect(parts.some((part) => part.kind === 'skill' && part.name === 'Chaos Storm')).toBe(true);
    expect(parts.some((part) => part.kind === 'skill' && part.name === 'Chaos')).toBe(false);
  });

  it('does not match skill names inside longer words', () => {
    const parts = splitGw2Names('Swapping a specialization changes priority.', skills);
    expect(parts).toEqual([{ kind: 'text', value: 'Swapping a specialization changes priority.' }]);
  });

  it('returns plain text when no skill index is available', () => {
    expect(splitGw2Names('Flying Cutter', undefined)).toEqual([
      { kind: 'text', value: 'Flying Cutter' },
    ]);
  });
});
