import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { SkillIndex, type ProfessionSnapshot } from '../api/gw2.ts';
import { runAnalysis } from '../analysis/engine.ts';
import type { AnalysisResult } from '../analysis/types.ts';
import { fixtureSource, virtuosoLogFixture } from '../analysis/__fixtures__/virtuosoLog.ts';
import mesmerSnapshot from '../data/gw2/mesmer.json';
import { inferBuild, type InferredBuild } from '../model/build.ts';
import { referenceBuildFromChatCode } from '../model/chatCode.ts';
import { normalizeLog, pickDefaultPlayer, type NormalizedLog, type NormalizedPlayer } from '../model/normalize.ts';
import { BuildPanel } from './components/BuildPanel.tsx';
import { FindingCard } from './components/FindingCard.tsx';
import { SummaryHeader } from './components/SummaryHeader.tsx';
import { Timeline } from './components/Timeline.tsx';

const skills = new SkillIndex(mesmerSnapshot as unknown as ProfessionSnapshot);

let log: NormalizedLog;
let player: NormalizedPlayer;
let build: InferredBuild;
let result: AnalysisResult;

beforeAll(() => {
  log = normalizeLog(virtuosoLogFixture(), fixtureSource);
  player = pickDefaultPlayer(log)!;
  build = inferBuild(log, player, skills);
  result = runAnalysis({ log, player, window: log.fullFight, skills, build });
});

describe('result components', () => {
  it('renders the summary header', () => {
    const html = renderToStaticMarkup(
      createElement(SummaryHeader, {
        log,
        player,
        score: result.score,
        players: log.players,
        onSelectPlayer: () => {},
      }),
    );
    expect(html).toContain('Practice Golem');
    expect(html).toContain('Blade Dancer');
  });

  it('renders every finding the engine produced', () => {
    for (const found of result.findings) {
      const html = renderToStaticMarkup(
        createElement(FindingCard, { finding: found, skills, build }),
      );
      // Skill chips may inject a keybind badge mid-title; strip those before comparing.
      const plain = html
        .replace(/<span[^>]*font-mono[^>]*>[\s\S]*?<\/span>/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&');
      expect(plain).toContain(found.title);
    }
  });

  it('marks skill names in finding prose as hover targets', () => {
    const html = renderToStaticMarkup(
      createElement(FindingCard, {
        finding: {
          id: 'rotation-test',
          checkId: 'rotation-compare',
          severity: 'warning',
          title: 'Skill priority differs from the reference',
          summary:
            'The largest difference is Flying Cutter: 77.4 casts per minute against 83.9.',
        },
        skills,
        build,
      }),
    );
    expect(html).toContain('Flying Cutter');
    expect(html).toContain('rounded-lg bg-ink-800');
    // Weapon_1 → keybind 1
    expect(html).toContain('>1<');
  });

  it('renders a hover tip icon when a finding has a tip', () => {
    const html = renderToStaticMarkup(
      createElement(FindingCard, {
        finding: {
          id: 'auto-attack-chain/dropped',
          checkId: 'auto-attack-chain',
          severity: 'warning',
          title: '3 auto-attack chains restarted before finishing',
          summary: 'You completed 7 of 10 chains.',
          tip: 'Auto-attacks advance through a fixed skill chain. A restart means the next auto was the first step again before the final hit landed — usually because another skill broke the auto queue, so when autos resumed they started over.',
        },
        skills,
        build,
      }),
    );
    expect(html).toContain('More about this finding');
    expect(html).toContain('>i<');
    // Tip content is portal/hover-only, so it should not appear in the static markup.
    expect(html).not.toContain('broke the auto queue');
  });

  it('renders the timeline without support chronoboons on a DPS log', () => {
    const html = renderToStaticMarkup(createElement(Timeline, { log, player, build, skills }));
    // Support boons are only listed as rows for support roles; the footnote may still mention them.
    expect(html).not.toMatch(/>Alacrity</);
    expect(html).not.toMatch(/>Quickness</);
    expect(html).not.toMatch(/>Fury</);
    expect(html).not.toMatch(/>Might</);
    expect(html).toContain('Blades');
    expect(html).toContain('Casts');
  });

  it('renders the observed build next to a reference build and alternatives', () => {
    const reference = referenceBuildFromChatCode(
      '[&DQcBHRgaQiojDyMP3RrdGmkBaQFlAYUB5RrtEgAAAAAAAAAAAAAAAAAAAAADLwBaAAkBAA==]',
      skills,
      { name: 'Power Virtuoso' },
    );
    const html = renderToStaticMarkup(
      createElement(BuildPanel, {
        build,
        reference,
        skills,
        consumables: [
          {
            id: 57409,
            name: 'Cilantro and Cured Meat Flatbread',
            kind: 'food',
            time: -5,
            durationMs: 1_800_000,
          },
          {
            id: 33836,
            name: 'Writ of Masterful Malice',
            kind: 'utility',
            time: -4,
            durationMs: 1_800_000,
          },
        ],
        alternatives: [
          {
            page: 'Build:Virtuoso - Condi DPS',
            eliteSpec: 'Virtuoso',
            variant: 'Condi DPS',
            score: 120,
          },
        ],
      }),
    );
    expect(html).toContain('Signet of the Ether');
    expect(html).toContain('Power Virtuoso');
    expect(html).toContain('Infinite Forge');
    expect(html).toContain('Auto-chosen MetaBattle raid build');
    expect(html).toContain('Condi DPS');
    expect(html).toContain('Consumables');
    expect(html).toContain('Food');
    expect(html).toContain('Utility');
    expect(html).toContain('Writ of Masterful Malice');
    expect(html).toContain('Cilantro and Cured Meat Flatbread');
    expect(html).toContain('Heal / utility / elite');
    // Default keybinds: heal=6, utilities=7–9, elite=0
    expect(html).toContain('>6<');
    expect(html).toContain('>0<');
  });
});

