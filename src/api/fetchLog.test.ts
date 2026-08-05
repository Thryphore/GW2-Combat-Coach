import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EILog } from './eiTypes.ts';
import { parseLogInput } from './logSource.ts';

const cacheGet = vi.fn();
const cacheSet = vi.fn();

vi.mock('./cache.ts', () => ({
  cacheGet: (...args: unknown[]) => cacheGet(...args),
  cacheSet: (...args: unknown[]) => cacheSet(...args),
}));

const minimalLog = {
  players: [{ name: 'Tester', account: 'Tester.1234', profession: 'Elementalist' }],
} as unknown as EILog;

describe('fetchEliteInsightsJson', () => {
  beforeEach(() => {
    cacheGet.mockReset();
    cacheSet.mockReset();
    cacheGet.mockResolvedValue(undefined);
    cacheSet.mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('serves a cached log without hitting the network', async () => {
    cacheGet.mockResolvedValue(minimalLog);
    const { fetchEliteInsightsJson } = await import('./fetchLog.ts');
    const source = parseLogInput('https://dps.report/iIoY-20220529-225311_sloth');
    const stages: string[] = [];

    const log = await fetchEliteInsightsJson(source, {
      onProgress: (progress) => stages.push(progress.stage),
    });

    expect(log).toBe(minimalLog);
    expect(fetch).not.toHaveBeenCalled();
    expect(stages).toEqual(['cached']);
  });

  it('downloads once, then reuses the in-memory cache', async () => {
    const body = JSON.stringify(minimalLog);
    vi.mocked(fetch).mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length) },
      }),
    );

    const { fetchEliteInsightsJson } = await import('./fetchLog.ts');
    const source = parseLogInput('https://dps.report/abcd-20240101-120000_boss');

    const first = await fetchEliteInsightsJson(source);
    const stages: string[] = [];
    const second = await fetchEliteInsightsJson(source, {
      onProgress: (progress) => stages.push(progress.stage),
    });

    expect(first.players).toHaveLength(1);
    expect(second).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cacheSet).toHaveBeenCalledWith(`ei-log:dpsreport:${source.id}`, first, expect.any(Number));
    expect(stages).toEqual(['cached']);
  });
});
