import { describe, expect, it } from 'vitest';
import { findingAnchorId, resolveFindingTarget } from './findingNav.ts';

describe('findingNav', () => {
  it('builds stable DOM ids', () => {
    expect(findingAnchorId('auto-attack-chain/dropped')).toBe('finding-auto-attack-chain-dropped');
  });

  it('resolves exact matches before prefixes', () => {
    const ids = ['auto-attack-chain/dropped', 'auto-attack-chain/clean', 'downtime/idle'];
    expect(resolveFindingTarget(ids, ['auto-attack-chain/clean', 'auto-attack-chain'])).toBe(
      'auto-attack-chain/clean',
    );
    expect(resolveFindingTarget(ids, ['auto-attack-chain'])).toBe('auto-attack-chain/dropped');
    expect(resolveFindingTarget(ids, ['missing'])).toBeUndefined();
  });
});
