import { describe, expect, it } from 'vitest';
import {
  matchWingmanBossId,
  pickTopProfessionLog,
  signedBossId,
  topLogPermalink,
  type WingmanBossInfo,
} from './wingmanTopLog.ts';

const bosses: Record<string, WingmanBossInfo> = {
  '15429': {
    name: 'Gorseval the Multifarious',
    displayName: 'Gorseval',
    short: 'gors',
    targetIDs: [15429],
    type: 'raid',
  },
  '15438': {
    name: 'Vale Guardian',
    short: 'vg',
    targetIDs: [15438],
    type: 'raid',
  },
  '16235': {
    name: 'Keep Construct',
    short: 'kc',
    targetIDs: [16235],
    hasCM: true,
    type: 'raid',
  },
  '16088': {
    name: 'Bandit Trio',
    short: 'trio',
    targetIDs: [16088, 16137, 16125],
    type: 'raid',
  },
};

describe('matchWingmanBossId', () => {
  it('matches a direct trigger id', () => {
    expect(matchWingmanBossId(bosses, 15438, 'Vale Guardian')).toBe(15438);
  });

  it('matches a secondary target id from a multi-target fight', () => {
    expect(matchWingmanBossId(bosses, 16137, 'Bandit Trio')).toBe(16088);
  });

  it('falls back to fight name when trigger id is missing', () => {
    expect(matchWingmanBossId(bosses, undefined, 'Gorseval the Multifarious')).toBe(15429);
    expect(matchWingmanBossId(bosses, undefined, 'Gorseval CM')).toBe(15429);
  });

  it('returns undefined for unknown encounters', () => {
    expect(matchWingmanBossId(bosses, undefined, 'Standard Kitty Golem')).toBeUndefined();
  });
});

describe('signedBossId', () => {
  it('negates challenge mode ids', () => {
    expect(signedBossId(16235, false)).toBe(16235);
    expect(signedBossId(16235, true)).toBe(-16235);
    expect(signedBossId(-16235, true)).toBe(-16235);
  });
});

describe('pickTopProfessionLog', () => {
  it('builds a permalink for the profession top-damage record', () => {
    const top = pickTopProfessionLog(
      {
        era: '26-07',
        professions_top: { Virtuoso: 34334 },
        professions_top_Links: { Virtuoso: 'c89b5-20260727-213549_vg_kill' },
        professions_top_Names: { Virtuoso: 'Kajiysor_4357' },
      },
      'Virtuoso',
      15438,
    );

    expect(top).toEqual({
      bossId: 15438,
      profession: 'Virtuoso',
      dps: 34334,
      logId: 'c89b5-20260727-213549_vg_kill',
      playerName: 'Kajiysor_4357',
      permalink: topLogPermalink('c89b5-20260727-213549_vg_kill'),
      era: '26-07',
    });
  });

  it('skips professions with no top record', () => {
    expect(
      pickTopProfessionLog(
        { professions_top: { Virtuoso: 0 }, professions_top_Links: {} },
        'Virtuoso',
        15438,
      ),
    ).toBeUndefined();
  });
});
