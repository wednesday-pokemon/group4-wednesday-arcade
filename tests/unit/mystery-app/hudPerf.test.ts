// Perf guards (event-critical, weak laptops): the minimap / compass skip a redraw when their content key is unchanged,
// and the React HUD skips a setState when nothing it shows changed. Both keys must still change for every visible
// change (position ≥ 0.1 m, heading ≥ 0.5°, odds, animations).
import { describe, expect, it } from 'vitest';
import { mapFeedKey, type FeedKeyOptions } from '../../../src/app/mystery/hud/navFeed.ts';
import { hudRenderKey, type MysteryHudModel } from '../../../src/app/mystery/hudModel.ts';
import { mapGeometry, type PublicMapState } from '../../../src/ui/mystery/map/mapData.ts';
import { textWidth, textWidthCacheSize, textWidthFor } from '../../../src/ui/mystery/map/mapRender.ts';
import { buildIsland } from '../../../src/mystery/data/island.ts';
import { CASES } from '../../../src/mystery/data/cases.ts';
import type { LiveForecasts } from '../../../src/mystery/analytics/types.ts';
import type { InvestigationState } from '../../../src/mystery/types.ts';

const island = buildIsland(CASES.midnight_signal);
const inv = (over: Partial<InvestigationState> = {}): InvestigationState => ({
  checkedClueSites: [], knownClueSites: {}, checkedEggSites: [], eggSeenAt: null, traces: [], examined: [], passageOpen: false,
  hydeEmerged: true, hydeEmergedAt: 0, hydeEmergesInS: null, lastHydeSighting: null, ...over,
});
const forecasts = (p: number): LiveForecasts => ({
  detection: null, extraction: { p: 0.8, source: 'ml', label: 'ML estimate' },
  egg: { sites: [{ siteId: 'e1', areaId: 'a', label: 'Shed', x: 0, z: 0, p, prevP: null, ruledOut: false }, { siteId: 'e2', areaId: 'b', label: 'Yard', x: 1, z: 1, p: 1 - p, prevP: null, ruledOut: false }], label: 'Bayesian estimate', lastChange: null },
  clueAreas: null,
  hyde: { phase: 'active', label: 'Bayesian estimate', zones: [] },
});
function state(over: Partial<PublicMapState> = {}): PublicMapState {
  return {
    t: 40.2, geometry: mapGeometry(island), world: island.world!, investigation: inv(), forecasts: forecasts(0.5), cluesFound: [], objective: 'find_clues',
    player: { x: 10, z: 20, yaw: -0.5, stance: 'walk', crouched: false, noiseRadiusM: 7, noiseBand: 'audible' },
    eggState: 'resting', eggMarker: null, hyde: null, openWalls: [], seenHazards: [], leverSeen: false, showSwitch: false,
    hint: { level: 0, areaId: null, target: null }, target: null, route: null, visitedAreas: [], areaDoneAt: {}, flashes: [], ...over,
  };
}
const O: FeedKeyOptions = { heardHydeBearing: null, heardCrackBearing: null, showPredictions: true, highContrast: false, reducedMotion: false };

describe('minimap / compass content key', () => {
  it('stable under sub-pixel motion and new-but-equal forecast / investigation objects', () => {
    const a = mapFeedKey(state(), O);
    expect(mapFeedKey(state({ t: 40.25, player: { ...state().player, x: 10.03, z: 20.02, yaw: -0.5 + 0.002 } }), O)).toBe(a);
    expect(mapFeedKey(state({ forecasts: forecasts(0.501), investigation: inv() }), O)).toBe(a);
  });

  it('changes for every visible change: 0.1 m, 0.5°, odds, stance, Hyde, target, settings, a heard bearing', () => {
    const a = mapFeedKey(state(), O);
    const p = state().player;
    expect(mapFeedKey(state({ player: { ...p, x: 10.12 } }), O)).not.toBe(a);
    expect(mapFeedKey(state({ player: { ...p, yaw: -0.5 + (0.6 * Math.PI) / 180 } }), O)).not.toBe(a);
    expect(mapFeedKey(state({ forecasts: forecasts(0.6) }), O)).not.toBe(a);
    expect(mapFeedKey(state({ player: { ...p, crouched: true, stance: 'crouch' } }), O)).not.toBe(a);
    expect(mapFeedKey(state({ hyde: { x: 3, z: 4, mode: 'visible' } }), O)).not.toBe(a);
    expect(mapFeedKey(state({ target: { x: 1, z: 2, label: 'Shed' } }), O)).not.toBe(a);
    expect(mapFeedKey(state({ investigation: inv({ checkedEggSites: ['e1'] }) }), O)).not.toBe(a);
    expect(mapFeedKey(state(), { ...O, showPredictions: false })).not.toBe(a);
    expect(mapFeedKey(state(), { ...O, heardHydeBearing: 90 })).not.toBe(a);
  });

  it('animations carry a 30 Hz time bucket; a still scene still refreshes once per second', () => {
    const fading = (t: number) => state({ t, investigation: inv({ lastHydeSighting: { t: 39, x: 1, z: 1 } }) });
    expect(mapFeedKey(fading(40.2), O)).not.toBe(mapFeedKey(fading(40.25), O));
    const flash = (t: number) => state({ t, flashes: [{ kind: 'reveal', x: 0, z: 0, t0: 40 }] });
    expect(mapFeedKey(flash(40.2), O)).not.toBe(mapFeedKey(flash(40.25), O));
    expect(mapFeedKey(state({ t: 40.2 }), O)).toBe(mapFeedKey(state({ t: 40.9 }), O));
    expect(mapFeedKey(state({ t: 40.9 }), O)).not.toBe(mapFeedKey(state({ t: 41.05 }), O));
  });
});

describe('React HUD render key', () => {
  // the loop keeps ONE odds object between its 1 Hz rebuilds (keyed by identity)
  const ODDS: MysteryHudModel['odds'] = { phase: 'hidden', rows: [], footer: [] };
  const ab = (key: 'F' | 'Q', cd = 0) => ({ key, name: 'X', art: '', ready: cd === 0, cooldownLeftS: cd, cooldownS: 20, activeLeftS: 0, loud: false, denied: null, aimed: false });
  const model = (over: Partial<MysteryHudModel> = {}): MysteryHudModel => ({
    t: 30, status: 'playing', hp: 100, maxHp: 100, catches: 0, stance: 'walk', hidden: false, tooClose: false,
    noise: { level: 0.31, band: 'audible', radiusM: 7.1 },
    hyde: { mode: 'PATROL', suspicion: 0.1, level: 0, canSee: false, effect: null, bearing: { angle: 1.2, distanceM: 20.2 }, edge: false, edgeAt: null, emerged: true, emergesInS: null },
    objective: 'find_clues', objectiveText: 'Find 3 clues.', clues: { found: [], total: 3, order: [] },
    egg: { state: 'resting', tier: null, points: 0, security: 100, seenLabel: null },
    power: ab('F'), move: ab('Q', 11.6), prompt: null, examineToast: null, clueCard: null, stack: { log: null, card: null },
    captions: [], toast: null, catchFlashSeq: 0, hintCooldownS: 0, hintLevel: 0, risk: null,
    odds: ODDS, areaName: null, crack: null, banner: null, cursedLeftS: null, threatEdge: null,
    ...over,
  } as MysteryHudModel);

  it('ignores sim time and changes below what the HUD shows', () => {
    const a = hudRenderKey(model());
    expect(hudRenderKey(model({ t: 30.3 }))).toBe(a);
    expect(hudRenderKey(model({ noise: { level: 0.33, band: 'audible', radiusM: 7.2 } }))).toBe(a); // still 3 segments, "7 m"
    expect(hudRenderKey(model({ move: ab('Q', 11.1) }))).toBe(a); // still "12 s"
  });

  it('changes when a shown value changes', () => {
    const a = hudRenderKey(model());
    expect(hudRenderKey(model({ noise: { level: 0.42, band: 'audible', radiusM: 7.1 } }))).not.toBe(a);
    expect(hudRenderKey(model({ move: ab('Q', 10.9) }))).not.toBe(a);
    expect(hudRenderKey(model({ hp: 64.6 }))).not.toBe(a);
    expect(hudRenderKey(model({ objectiveText: 'Find the egg.' }))).not.toBe(a);
    expect(hudRenderKey(model({ odds: { phase: 'hidden', rows: [], footer: [] } }))).not.toBe(a); // a rebuilt Odds view re-renders
    expect(hudRenderKey(model({ prompt: { kind: 'clue', id: 'c', label: 'Search', progress: 0.5, warning: null, standStill: false } }))).not.toBe(a);
  });
});

describe('text width cache', () => {
  it('measures each (font, text) once, without reading the font back per lookup', () => {
    let calls = 0;
    const ctx = { font: '600 15px X', measureText: (t: string) => ({ width: t.length * 7 + (calls++, 0) }) } as unknown as CanvasRenderingContext2D;
    const n0 = textWidthCacheSize();
    expect(textWidthFor(ctx, '600 15px X', 'PIER')).toBe(28);
    expect(textWidthFor(ctx, '600 15px X', 'PIER')).toBe(28);
    expect(textWidth(ctx, 'PIER')).toBe(28);
    expect(calls).toBe(1);
    expect(textWidthCacheSize()).toBe(n0 + 1);
  });
});
