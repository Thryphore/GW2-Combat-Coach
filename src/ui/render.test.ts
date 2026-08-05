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
      const html = renderToStaticMarkup(createElement(FindingCard, { finding: found }));
      expect(html).toContain(found.title.replace(/&/g, '&amp;'));
    }
  });

  it('renders the timeline with a row per boon', () => {
    const html = renderToStaticMarkup(createElement(Timeline, { log, player }));
    expect(html).toContain('Alacrity');
    expect(html).toContain('Casts');
  });

  it('renders the observed build next to a reference build', () => {
    const reference = referenceBuildFromChatCode(
      '[&DQcBHRgaQiojDyMP3RrdGmkBaQFlAYUB5RrtEgAAAAAAAAAAAAAAAAAAAAADLwBaAAkBAA==]',
      skills,
      { name: 'Power Virtuoso' },
    );
    const html = renderToStaticMarkup(createElement(BuildPanel, { build, reference }));
    expect(html).toContain('Signet of the Ether');
    expect(html).toContain('Power Virtuoso');
    expect(html).toContain('Infinite Forge');
  });
});
