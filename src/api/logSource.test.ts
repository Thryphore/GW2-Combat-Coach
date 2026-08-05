import { describe, expect, it } from 'vitest';
import { LogInputError, parseLogInput } from './logSource.ts';

describe('parseLogInput', () => {
  it('accepts a dps.report permalink', () => {
    const source = parseLogInput('https://dps.report/iIoY-20220529-225311_sloth');
    expect(source.kind).toBe('dpsreport');
    expect(source.id).toBe('iIoY-20220529-225311_sloth');
    expect(source.jsonUrl).toContain('getJson?permalink=');
  });

  it('keeps the mirror host when one is used', () => {
    const source = parseLogInput('https://b.dps.report/iIoY-20220529-225311_sloth');
    expect(source.permalink).toBe('https://b.dps.report/iIoY-20220529-225311_sloth');
    expect(source.jsonUrl.startsWith('https://b.dps.report/')).toBe(true);
  });

  it('unwraps a getJson link that someone pasted', () => {
    const source = parseLogInput(
      'https://dps.report/getJson?permalink=https%3A%2F%2Fdps.report%2FiIoY-20220529-225311_sloth',
    );
    expect(source.id).toBe('iIoY-20220529-225311_sloth');
  });

  it('accepts a bare log id', () => {
    expect(parseLogInput('iIoY-20220529-225311_sloth').id).toBe('iIoY-20220529-225311_sloth');
  });

  it('explains why Wingman links are not supported', () => {
    expect(() => parseLogInput('https://gw2wingman.nevermindcreations.de/log/20230102-202238_dhuum')).toThrow(
      /different report format/,
    );
  });

  it('rejects unrelated input', () => {
    expect(() => parseLogInput('')).toThrow(LogInputError);
    expect(() => parseLogInput('not a link')).toThrow(LogInputError);
    expect(() => parseLogInput('https://example.com/log')).toThrow(/Unsupported host/);
  });
});
