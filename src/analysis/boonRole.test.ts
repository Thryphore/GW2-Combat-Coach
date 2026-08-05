import { describe, expect, it } from 'vitest';
import { normalizeLog, pickDefaultPlayer } from '../model/normalize.ts';
import type { ReferenceBuild } from '../model/build.ts';
import { fixtureSource, virtuosoLogFixture } from './__fixtures__/virtuosoLog.ts';
import { boonsForRole, isSupportBuildName, isSupportRole } from './boonRole.ts';
import { runAnalysis } from './engine.ts';

describe('boon role detection', () => {
  it('treats MetaBattle support page names as support', () => {
    expect(isSupportBuildName('Firebrand - Quickness Support Healer')).toBe(true);
    expect(isSupportBuildName('Chronomancer - Boon Support Power DPS')).toBe(true);
    expect(isSupportBuildName('Dragonhunter - Power DPS')).toBe(false);
  });

  it('hides chronoboons for a DPS log without support generation', () => {
    const log = normalizeLog(virtuosoLogFixture(), fixtureSource);
    const player = pickDefaultPlayer(log)!;
    expect(isSupportRole(log, player)).toBe(false);
    expect(boonsForRole(log, player)).toEqual(['Fury', 'Might']);
  });

  it('shows the full upkeep set when the reference build is a support page', () => {
    const log = normalizeLog(virtuosoLogFixture(), fixtureSource);
    const player = pickDefaultPlayer(log)!;
    const referenceBuild = {
      name: 'Virtuoso - Quickness Support Power DPS',
      source: 'metabattle',
      profession: 'Mesmer',
      eliteSpec: 'Virtuoso',
      weapons: [],
      utilities: [],
      specializations: [],
    } satisfies ReferenceBuild;

    expect(isSupportRole(log, player, referenceBuild)).toBe(true);
    expect(boonsForRole(log, player, referenceBuild)).toEqual([
      'Alacrity',
      'Quickness',
      'Fury',
      'Might',
    ]);

    const result = runAnalysis({
      log,
      player,
      window: log.fullFight,
      referenceBuild,
    });
    expect(result.findings.some((finding) => finding.id === 'boon-uptime/alacrity')).toBe(true);
  });

  it('detects supports from squad chronoboon generation', () => {
    const raw = virtuosoLogFixture();
    raw.players![0].squadBuffs = [{ id: 1187, buffData: [{ generation: 24 }] }];
    const log = normalizeLog(raw, fixtureSource);
    const player = pickDefaultPlayer(log)!;

    expect(isSupportRole(log, player)).toBe(true);
    expect(boonsForRole(log, player)).toContain('Quickness');
  });
});
