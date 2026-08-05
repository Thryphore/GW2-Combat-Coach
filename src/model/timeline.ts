export interface Interval {
  start: number;
  end: number;
}

export function intervalLength(interval: Interval): number {
  return Math.max(0, interval.end - interval.start);
}

export function overlap(a: Interval, b: Interval): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

/**
 * Elite Insights encodes buff status as `[time, stacks]` pairs where each entry
 * holds until the next one. This wraps that representation with the queries the
 * analysis checks need.
 */
export class StackTimeline {
  private readonly times: number[];
  private readonly stacks: number[];

  constructor(
    states: readonly (readonly number[])[],
    readonly endTime: number,
  ) {
    const times: number[] = [];
    const stacks: number[] = [];
    for (const state of states) {
      const time = state[0] ?? 0;
      const value = state[1] ?? 0;
      // Guard against duplicated timestamps, which would create zero-width segments.
      if (times.length > 0 && times[times.length - 1] === time) {
        stacks[stacks.length - 1] = value;
        continue;
      }
      times.push(time);
      stacks.push(value);
    }
    this.times = times;
    this.stacks = stacks;
  }

  static empty(endTime: number): StackTimeline {
    return new StackTimeline([], endTime);
  }

  get isEmpty(): boolean {
    return this.times.length === 0;
  }

  stacksAt(time: number): number {
    if (this.times.length === 0) return 0;
    let low = 0;
    let high = this.times.length - 1;
    if (time < this.times[0]) return 0;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (this.times[mid] <= time) low = mid;
      else high = mid - 1;
    }
    return this.stacks[low];
  }

  /** Segments of the timeline clipped to `window`, as `[start, end, stacks]`. */
  segments(window?: Interval): { start: number; end: number; stacks: number }[] {
    const from = window?.start ?? 0;
    const to = window?.end ?? this.endTime;
    const result: { start: number; end: number; stacks: number }[] = [];
    if (to <= from) return result;
    if (this.times.length === 0) {
      result.push({ start: from, end: to, stacks: 0 });
      return result;
    }

    if (from < this.times[0]) {
      result.push({ start: from, end: Math.min(to, this.times[0]), stacks: 0 });
    }
    for (let i = 0; i < this.times.length; i += 1) {
      const start = Math.max(from, this.times[i]);
      const end = Math.min(to, i + 1 < this.times.length ? this.times[i + 1] : this.endTime);
      if (end > start) result.push({ start, end, stacks: this.stacks[i] });
    }
    return result;
  }

  /** Milliseconds with at least `minStacks` applied. */
  uptimeMs(window?: Interval, minStacks = 1): number {
    let total = 0;
    for (const segment of this.segments(window)) {
      if (segment.stacks >= minStacks) total += segment.end - segment.start;
    }
    return total;
  }

  uptimeRatio(window?: Interval, minStacks = 1): number {
    const from = window?.start ?? 0;
    const to = window?.end ?? this.endTime;
    const span = to - from;
    if (span <= 0) return 0;
    return this.uptimeMs(window, minStacks) / span;
  }

  averageStacks(window?: Interval): number {
    const from = window?.start ?? 0;
    const to = window?.end ?? this.endTime;
    const span = to - from;
    if (span <= 0) return 0;
    let weighted = 0;
    for (const segment of this.segments(window)) {
      weighted += segment.stacks * (segment.end - segment.start);
    }
    return weighted / span;
  }

  /** Windows where the buff was missing for at least `minGapMs`. */
  gaps(minGapMs: number, window?: Interval, minStacks = 1): Interval[] {
    const gaps: Interval[] = [];
    let open: Interval | null = null;
    for (const segment of this.segments(window)) {
      if (segment.stacks < minStacks) {
        if (open && open.end === segment.start) open.end = segment.end;
        else {
          if (open && intervalLength(open) >= minGapMs) gaps.push(open);
          open = { start: segment.start, end: segment.end };
        }
      } else if (open) {
        if (intervalLength(open) >= minGapMs) gaps.push(open);
        open = null;
      }
    }
    if (open && intervalLength(open) >= minGapMs) gaps.push(open);
    return gaps;
  }

  /** Windows where the buff was present, useful for "was X up when I cast Y" checks. */
  activeWindows(window?: Interval, minStacks = 1): Interval[] {
    const windows: Interval[] = [];
    for (const segment of this.segments(window)) {
      if (segment.stacks < minStacks) continue;
      const last = windows[windows.length - 1];
      if (last && last.end === segment.start) last.end = segment.end;
      else windows.push({ start: segment.start, end: segment.end });
    }
    return windows;
  }
}
