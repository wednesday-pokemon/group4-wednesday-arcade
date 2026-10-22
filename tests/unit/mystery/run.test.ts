import { describe, expect, it } from 'vitest';
import { playEpisode } from '../../../src/mystery/episode.ts';
import { MysteryRun } from '../../../src/mystery/run.ts';
import { input } from './helpers.ts';

describe('MysteryRun API on buildIsland()', () => {
  it('constructs with only { duo, seed } (default island, case, registries, tuning)', () => {
    const run = new MysteryRun({ duo: { characterId: 'enid', pokemonId: 'gengar' }, seed: 's1' });
    expect(run.status).toBe('playing');
    expect(run.map.id).toBe('raven_island_v31:poisoned_archive');
    expect(run.caseDef.id).toBe('poisoned_archive');
    expect(run.card.characterId).toBe('enid');
    expect(run.objective()).toBe('find_clues');
    expect(run.player.roomId).toBe('pier');
    expect(Math.hypot(run.hyde.x - run.player.x, run.hyde.z - run.player.z)).toBeGreaterThanOrEqual(25);
  });

  it('tutorial: Hyde inactive, clock reset at endTutorial, events unlogged until then', () => {
    const run = new MysteryRun({ duo: { characterId: 'enid', pokemonId: 'gengar' }, seed: 's1', tutorial: true });
    const hx = run.hyde.x;
    for (let i = 0; i < 60; i++) run.update(1 / 30, input({ moveZ: 1 }));
    expect(run.hyde.x).toBe(hx);
    expect(run.log).toHaveLength(0);
    run.endTutorial();
    expect(run.t).toBe(0);
    expect(run.status).toBe('playing');
    run.update(0.5, input({ moveZ: 1, sprint: true }));
    expect(run.log.length).toBeGreaterThan(0);
    expect(run.log[0].seq).toBe(1);
  });

  it('look input: yaw += lookYawDelta (left), pitch += lookPitchDelta, clamped', () => {
    const run = new MysteryRun({ duo: { characterId: 'enid', pokemonId: 'gengar' }, seed: 's1' });
    run.update(1 / 60, input({ lookYawDelta: 0.5, lookPitchDelta: 5 }));
    expect(run.player.yaw).toBeCloseTo(0.5);
    expect(run.player.pitch).toBeCloseTo(run.tuning.player.pitchLimit);
  });

  it('pausing (not calling update) never advances time; huge frames are clamped', () => {
    const run = new MysteryRun({ duo: { characterId: 'enid', pokemonId: 'gengar' }, seed: 's1' });
    run.update(10, input());
    expect(run.t).toBeLessThanOrEqual(run.tuning.maxFrameS + 1e-9);
  });

  it('noiseRadiusM / boardAllowed / hydeBearing helpers', () => {
    const run = new MysteryRun({ duo: { characterId: 'enid', pokemonId: 'gengar' }, seed: 's1' });
    expect(run.noiseRadiusM()).toBe(0);
    run.update(0.3, input({ moveZ: 1 }));
    expect(run.noiseRadiusM()).toBeGreaterThan(6);
    run.update(0.3, input({ moveZ: 1, crouch: true }));
    expect(run.noiseRadiusM()).toBeLessThan(3);
    expect(run.boardAllowed()).toBe(true);
    run.hyde.mode = 'CHASE';
    expect(run.boardAllowed()).toBe(false);
    const b = run.hydeBearing();
    expect(b.distanceM).toBeGreaterThan(25);
    expect(Math.abs(b.angle)).toBeLessThanOrEqual(Math.PI);
  });

  it('accuse(null) = leave the case unsolved → not_accused, still scored', () => {
    const ep = playEpisode({ characterId: 'wednesday', pokemonId: 'gengar' }, 'acc-null', { profile: 'stealthy', accuse: 'none' });
    expect(ep.result).toMatchObject({ outcome: 'finished', verdict: 'not_accused', accused: null, correct: false });
    expect(ep.result!.score).not.toBeNull();
    expect(ep.events.find((e) => e.type === 'accusation')).toMatchObject({ suspectId: null, correct: false });
  });

  it('deterministic: same duo + seed + bot → identical log, snapshots and result', () => {
    const a = playEpisode({ characterId: 'bianca', pokemonId: 'froslass' }, 'det-1', { profile: 'careless' });
    const b = playEpisode({ characterId: 'bianca', pokemonId: 'froslass' }, 'det-1', { profile: 'careless' });
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.snapshots).toEqual(b.snapshots);
    expect(a.result).toEqual(b.result);
    const c = playEpisode({ characterId: 'bianca', pokemonId: 'froslass' }, 'det-2', { profile: 'careless' });
    expect(JSON.stringify(c.events)).not.toBe(JSON.stringify(a.events));
  });

  it('log: seq contiguous from 1, t non-decreasing; snapshots carry only present / past state', () => {
    const ep = playEpisode({ characterId: 'ajax', pokemonId: 'dusknoir' }, 'log-1', { profile: 'careless' });
    ep.events.forEach((e, i) => expect(e.seq).toBe(i + 1));
    for (let i = 1; i < ep.events.length; i++) expect(ep.events[i].t).toBeGreaterThanOrEqual(ep.events[i - 1].t);
    expect(ep.snapshots.length).toBeGreaterThan(30);
    for (let i = 1; i < ep.snapshots.length; i++) expect(ep.snapshots[i].t - ep.snapshots[i - 1].t).toBeCloseTo(1, 1);
    const keys = Object.keys(ep.snapshots[0]).sort();
    expect(keys).toEqual(['catches', 'cluesFound', 'eggSecurity', 'eggState', 'hidden', 'hp', 'hydeDistanceM', 'hydeMode', 'hydeOccluded',
      'hydeSuspicion', 'moveReady', 'objective', 'powerReady', 'recentNoise', 'roomId', 'speed', 'stance', 't'].sort());
  });
});
