import { describe, expect, it } from 'vitest';
import { StackTimeline } from './timeline.ts';

// Alacrity on for 10s, off for 5s, on until the end of a 30s fight.
const timeline = new StackTimeline(
  [
    [0, 1],
    [10_000, 0],
    [15_000, 1],
  ],
  30_000,
);

describe('StackTimeline', () => {
  it('reports stacks at a point in time', () => {
    expect(timeline.stacksAt(0)).toBe(1);
    expect(timeline.stacksAt(9999)).toBe(1);
    expect(timeline.stacksAt(10_000)).toBe(0);
    expect(timeline.stacksAt(14_999)).toBe(0);
    expect(timeline.stacksAt(29_999)).toBe(1);
  });

  it('treats time before the first state as empty', () => {
    const late = new StackTimeline([[5000, 3]], 10_000);
    expect(late.stacksAt(0)).toBe(0);
    expect(late.stacksAt(5000)).toBe(3);
  });

  it('computes uptime and ratio over the whole log', () => {
    expect(timeline.uptimeMs()).toBe(25_000);
    expect(timeline.uptimeRatio()).toBeCloseTo(25 / 30);
  });

  it('clips to a window', () => {
    expect(timeline.uptimeMs({ start: 5000, end: 20_000 })).toBe(10_000);
    expect(timeline.uptimeRatio({ start: 5000, end: 20_000 })).toBeCloseTo(10 / 15);
  });

  it('finds gaps above a minimum length', () => {
    expect(timeline.gaps(1000)).toEqual([{ start: 10_000, end: 15_000 }]);
    expect(timeline.gaps(6000)).toEqual([]);
  });

  it('merges adjacent windows where the buff was present', () => {
    const stacked = new StackTimeline(
      [
        [0, 1],
        [1000, 5],
        [2000, 3],
        [3000, 0],
      ],
      4000,
    );
    expect(stacked.activeWindows()).toEqual([{ start: 0, end: 3000 }]);
    // Only the segment at five stacks counts when a minimum is given.
    expect(stacked.uptimeMs(undefined, 5)).toBe(1000);
  });

  it('weights average stacks by duration', () => {
    const might = new StackTimeline(
      [
        [0, 10],
        [5000, 20],
      ],
      10_000,
    );
    expect(might.averageStacks()).toBe(15);
  });

  it('handles an empty timeline', () => {
    const empty = StackTimeline.empty(10_000);
    expect(empty.isEmpty).toBe(true);
    expect(empty.uptimeMs()).toBe(0);
    expect(empty.gaps(1)).toEqual([{ start: 0, end: 10_000 }]);
  });
});
