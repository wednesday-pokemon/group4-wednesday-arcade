// Compass + minimap math (UX_OVERHAUL §2/§3) against the contract yaw convention (yaw 0 faces −Z = north,
// forward = (−sin yaw, −cos yaw), positive yaw turns LEFT), the hidden-until-justified map rules, and a source scan that
// the HUD / map code never reads the session's hidden truth (map.clues, map.eggSpawn, the SessionLayout).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bearingDeg, clampToRim, fitView, headingDeg, northScreenAngle, relBearingDeg, screenToWorld, worldToScreen, type MapView,
} from '../../../src/ui/mystery/map/mapRender.ts';
import { buildMapLayers, mapGeometry, type PublicMapState } from '../../../src/ui/mystery/map/mapData.ts';
import { CompassClamp, heardBearing, layoutCompass, type CompassMarkerIn } from '../../../src/app/mystery/hud/compass.ts';
import { buildIsland } from '../../../src/mystery/data/island.ts';
import { CASES } from '../../../src/mystery/data/cases.ts';
import type { InvestigationState, Vec2 } from '../../../src/mystery/types.ts';

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);
const fwd = (yaw: number): Vec2 => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });

describe('compass bearings (contract yaw)', () => {
  it('heading = −yaw in degrees: yaw 0 → N, −π/2 → E, π → S, +π/2 → W (positive yaw turns left)', () => {
    close(headingDeg(0), 0);
    close(headingDeg(-Math.PI / 2), 90);
    close(headingDeg(Math.PI), 180);
    close(headingDeg(Math.PI / 2), 270);
    // the facing direction's bearing equals the heading for any yaw
    for (const yaw of [0.3, -1.2, 2.9, -3.1]) close(bearingDeg({ x: 0, z: 0 }, fwd(yaw)), headingDeg(yaw), 1e-6);
  });

  it('bearing from → to: north (−Z) 0°, east (+X) 90°, south 180°, west 270°', () => {
    const o = { x: 3, z: 4 };
    close(bearingDeg(o, { x: 3, z: -10 }), 0);
    close(bearingDeg(o, { x: 13, z: 4 }), 90);
    close(bearingDeg(o, { x: 3, z: 14 }), 180);
    close(bearingDeg(o, { x: -7, z: 4 }), 270);
    // relative: + right, − left, facing north
    close(relBearingDeg(0, o, { x: 13, z: 4 }), 90);
    close(relBearingDeg(0, o, { x: -7, z: 4 }), -90);
    close(relBearingDeg(-Math.PI / 2, o, { x: 13, z: 4 }), 0); // facing east, target east → ahead
  });

  it('a heard Hyde: relative angle (+ left, radians) → absolute bearing rounded to 22.5°', () => {
    expect(heardBearing(0, 0)).toBe(0);
    expect(heardBearing(0, Math.PI / 2)).toBe(270); // on your left while facing north = west
    expect(heardBearing(-Math.PI / 2, 0.1)).toBe(90); // ≈ east
    expect(heardBearing(0, -0.5)).toBe(22.5); // 28.6° right → 22.5
  });
});

describe('compass strip layout (150° arc, clamping)', () => {
  const W = 464;
  const m = (id: string, kind: CompassMarkerIn['kind'], bearing: number, lantern = false, extra: Partial<CompassMarkerIn> = {}): CompassMarkerIn => ({ id, kind, bearing, distanceM: 58, lantern, ...extra });

  it('facing north centres N; ±75° visible at ≈ 3.09 px/°', () => {
    const L = layoutCompass(0, [], W, new CompassClamp());
    const n = L.letters.find((l) => l.text === 'N')!;
    close(n.x, W / 2);
    close(L.pxPerDeg, W / 150);
    expect(L.letters.map((l) => l.text).sort()).toEqual(['N', 'NE', 'NW']);
    expect(L.ticks.length).toBe(11); // −75 … +75 every 15°
    expect(L.ticks.filter((t) => t.major).length).toBe(3); // NW, N, NE
  });

  it('a lantern objective behind clamps at an edge on the side of the shortest turn, with its distance', () => {
    const clamp = new CompassClamp();
    const L = layoutCompass(0, [m('obj', 'objective', 120, true)], W, clamp);
    expect(L.markers[0]!.clamped).toBe('right');
    expect(L.markers[0]!.x).toBe(W - 8);
    expect(L.markers[0]!.label).toBe('58 m');
    const L2 = layoutCompass(0, [m('obj', 'objective', 240, true)], W, new CompassClamp());
    expect(L2.markers[0]!.clamped).toBe('left');
    expect(L2.markers[0]!.x).toBe(8);
    // non-lantern markers off the arc simply hide
    expect(layoutCompass(0, [m('a', 'area', 120)], W, new CompassClamp()).markers).toHaveLength(0);
  });

  it('15° hysteresis near 180°: the clamp side does not flip while the target is within 165–195°', () => {
    const clamp = new CompassClamp();
    expect(layoutCompass(0, [m('obj', 'objective', 170, true)], W, clamp).markers[0]!.clamped).toBe('right');
    expect(layoutCompass(0, [m('obj', 'objective', 185, true)], W, clamp).markers[0]!.clamped).toBe('right'); // kept
    expect(layoutCompass(0, [m('obj', 'objective', 200, true)], W, clamp).markers[0]!.clamped).toBe('left'); // past 195°
  });

  it('a marker within 12 px of a letter hides the letter; area names only within ±10° of the centre', () => {
    const L = layoutCompass(0, [m('t', 'tower', 2)], W, new CompassClamp());
    expect(L.letters.find((l) => l.text === 'N')!.hidden).toBe(true);
    const far = layoutCompass(0, [m('a', 'area', 30, false, { name: 'Greenhouse Annex' })], W, new CompassClamp());
    expect(far.markers[0]!.label).toBeNull();
    const near = layoutCompass(0, [m('a', 'area', 6, false, { name: 'Greenhouse Annex' })], W, new CompassClamp());
    expect(near.markers[0]!.label).toBe('Greenhouse Annex · 58 m');
  });

  it('labels never overlap: the objective wins, a colliding lower-priority label is dropped', () => {
    const L = layoutCompass(0, [
      m('obj', 'objective', 1, true),
      m('t', 'tower', 3, false, { name: 'Iago Tower' }),
      m('a', 'area', 5, false, { name: 'Records Crypt' }),
    ], W, new CompassClamp());
    const labels = L.markers.filter((x) => x.label).map((x) => x.id);
    expect(labels).toContain('obj');
    const spans = L.markers.filter((x) => x.label).map((x) => {
      const w = x.label!.length * 7.2;
      return x.labelSide === 'right' ? [x.x + 10, x.x + 10 + w] : [x.x - 10 - w, x.x - 10];
    });
    for (let i = 0; i < spans.length; i++) for (let j = i + 1; j < spans.length; j++) {
      const [a, b] = spans[i]!;
      const [c, d] = spans[j]!;
      expect(a < d && b > c).toBe(false);
    }
  });
});

describe('minimap transforms', () => {
  const view = (yaw: number): MapView => ({ center: { x: 10, z: 20 }, rotation: yaw, pxPerM: 4, size: { w: 224, h: 224 }, shape: 'circle' });

  it('heading-up: the facing direction is screen-up and the right-hand side is screen-right for any yaw', () => {
    for (const yaw of [0, 0.7, -1.3, Math.PI / 2, 3]) {
      const v = view(yaw);
      const f = fwd(yaw);
      const up = worldToScreen(v, { x: 10 + f.x * 10, z: 20 + f.z * 10 });
      close(up.x, 112, 1e-9);
      close(up.y, 112 - 40, 1e-9);
      const r = { x: Math.cos(yaw), z: -Math.sin(yaw) }; // right vector
      const right = worldToScreen(v, { x: 10 + r.x * 10, z: 20 + r.z * 10 });
      close(right.x, 112 + 40, 1e-9);
      close(right.y, 112, 1e-9);
    }
  });

  it('north-up (rotation 0): north (−Z) is up, east (+X) is right; screenToWorld inverts worldToScreen', () => {
    const v = view(0);
    const n = worldToScreen(v, { x: 10, z: 10 });
    expect([n.x, n.y]).toEqual([112, 72]);
    const e = worldToScreen(v, { x: 20, z: 20 });
    expect([e.x, e.y]).toEqual([152, 112]);
    for (const yaw of [0, 1.1, -2.4]) {
      const vv = view(yaw);
      const p = { x: -3.5, z: 41.25 };
      const back = screenToWorld(vv, worldToScreen(vv, p));
      close(back.x, p.x, 1e-9);
      close(back.z, p.z, 1e-9);
    }
  });

  it('the N notch rides the rim at the north bearing: up when facing north, left when facing east', () => {
    const dir = (r: number) => [Math.cos(northScreenAngle({ rotation: r })), Math.sin(northScreenAngle({ rotation: r }))];
    const [ux, uy] = dir(0);
    close(ux, 0);
    close(uy, -1); // up
    const [lx, ly] = dir(-Math.PI / 2); // facing east → north is on the left
    close(lx, -1);
    close(ly, 0);
  });

  it('28 m radius at 4 px/m fills ⌀224; Tab fit is north-up over the whole island', () => {
    expect(28 * 4 * 2).toBe(224);
    const f = fitView({ minX: -45, maxX: 45, minZ: -60, maxZ: 60 }, { w: 456, h: 608 });
    close(f.pxPerM, Math.min(456 / 90, 608 / 120));
    expect(f.rotation).toBe(0);
    const c = clampToRim({ size: { w: 224, h: 224 }, shape: 'circle' }, { x: 112, y: -500 }, 8);
    close(c.x, 112, 1e-9);
    close(c.y, 8, 1e-9);
  });
});

// ------------------------------------------------------------------------------------------- hidden until justified

const island = buildIsland(CASES.poisoned_archive);
const world = island.world!;
const inv = (over: Partial<InvestigationState> = {}): InvestigationState => ({
  checkedClueSites: [], knownClueSites: {}, checkedEggSites: [], eggSeenAt: null, traces: [], examined: [], passageOpen: false,
  hydeEmerged: true, hydeEmergedAt: 0, hydeEmergesInS: null, lastHydeSighting: null, ...over,
});
function state(over: Partial<PublicMapState> = {}): PublicMapState {
  return {
    t: 100, geometry: mapGeometry(island), world, investigation: inv(), forecasts: null, cluesFound: [], objective: 'find_clues',
    player: { x: 0, z: 54, yaw: 0, stance: 'walk', crouched: false, noiseRadiusM: 7, noiseBand: 'audible' },
    eggState: 'resting', eggMarker: null, hyde: null, openWalls: [], seenHazards: [], leverSeen: false, showSwitch: false,
    hint: { level: 0, areaId: null, target: null }, target: null, route: null, visitedAreas: [], areaDoneAt: {}, flashes: [], ...over,
  };
}

describe('map layers: hidden until justified (§3)', () => {
  const group = world.clueSites[0]!;
  const site = group.sites[0]!;
  const area = world.areas.find((a) => a.id === site.areaId)!;

  it('the geometry type carries no hidden truth', () => {
    const g = mapGeometry(island) as unknown as Record<string, unknown>;
    expect('clues' in g).toBe(false);
    expect('eggSpawn' in g).toBe(false);
  });

  it('candidate clue sites appear only near their area, at hint L2, or (Tab) in visited areas', () => {
    expect(buildMapLayers(state()).clueSites.some((s) => s.id === site.id)).toBe(false);
    const near = state({ player: { ...state().player, x: area.x, z: area.z } });
    expect(buildMapLayers(near).clueSites.some((s) => s.id === site.id)).toBe(true);
    const hinted = state({ hint: { level: 2, areaId: area.id, target: { x: area.x, z: area.z, label: area.name } } });
    expect(buildMapLayers(hinted).clueSites.some((s) => s.id === site.id)).toBe(true);
    const visited = state({ visitedAreas: [area.id] });
    expect(buildMapLayers(visited, 'mini').clueSites.some((s) => s.id === site.id)).toBe(false);
    expect(buildMapLayers(visited, 'full').clueSites.some((s) => s.id === site.id)).toBe(true);
  });

  it('exact clue pins only for observed (known) sites or the L3 hint; found clues leave the map', () => {
    expect(buildMapLayers(state()).cluePins).toHaveLength(0);
    const known = buildMapLayers(state({ investigation: inv({ knownClueSites: { [group.clueId]: site.id } }) }));
    expect(known.cluePins).toEqual([{ x: site.x, z: site.z, id: site.id }]);
    const found = buildMapLayers(state({ cluesFound: [group.clueId], investigation: inv({ knownClueSites: { [group.clueId]: site.id } }) }));
    expect(found.cluePins).toHaveLength(0);
    expect(found.clueSites.some((s) => s.clueId === group.clueId)).toBe(false);
  });

  it('a checked-empty candidate shows ✕; the egg pin needs seen / dropped / a reveal', () => {
    const near = { ...state().player, x: area.x, z: area.z };
    const L = buildMapLayers(state({ player: near, investigation: inv({ checkedClueSites: [site.id] }) }));
    expect(L.clueSites.find((s) => s.id === site.id)?.state).toBe('checked');
    expect(buildMapLayers(state()).eggPin).toBeNull();
    const egg = world.eggSites[0]!;
    expect(buildMapLayers(state({ investigation: inv({ eggSeenAt: egg.id }) })).eggPin).toEqual({ x: egg.x, z: egg.z, kind: 'seen' });
    expect(buildMapLayers(state({ eggMarker: { x: 1, z: 2, kind: 'revealed' } })).eggPin).toEqual({ x: 1, z: 2, kind: 'revealed' });
  });

  it('the Hyde point only while visible / chasing; otherwise a fading outline at the last sighting (8 s)', () => {
    expect(buildMapLayers(state()).hyde).toBeNull();
    expect(buildMapLayers(state({ hyde: { x: 5, z: 5, mode: 'chase' } })).hyde).toMatchObject({ kind: 'chase', alpha: 1 });
    const fading = buildMapLayers(state({ t: 104, investigation: inv({ lastHydeSighting: { t: 100, x: 3, z: 3 } }) })).hyde!;
    expect(fading.kind).toBe('last');
    close(fading.alpha, 0.5);
    expect(buildMapLayers(state({ t: 109, investigation: inv({ lastHydeSighting: { t: 100, x: 3, z: 3 } }) })).hyde).toBeNull();
  });

  it('hazards only once seen; the lever only once seen; the passage wall drawn as a wall until it opens', () => {
    expect(buildMapLayers(state()).hazards).toHaveLength(0);
    const hz = world.hazards[0];
    if (hz) expect(buildMapLayers(state({ seenHazards: [hz.id] })).hazards).toHaveLength(1);
    if (world.passage) {
      expect(buildMapLayers(state()).lever).toBeNull();
      expect(buildMapLayers(state({ leverSeen: true })).lever).toEqual({ x: world.passage.leverX, z: world.passage.leverZ });
      const closed = buildMapLayers(state()).dynamicWalls.find((d) => d.id === world.passage!.wallId);
      expect(closed).toMatchObject({ style: 'wall', open: false });
      const open = buildMapLayers(state({ investigation: inv({ passageOpen: true }) })).dynamicWalls.find((d) => d.id === world.passage!.wallId);
      expect(open?.open).toBe(true);
    }
  });

  it('the power switch only for duos with power_switch; the tower is lantern while delivering', () => {
    expect(buildMapLayers(state()).powerSwitch).toBeNull();
    expect(buildMapLayers(state({ showSwitch: true })).powerSwitch).not.toBeNull();
    expect(buildMapLayers(state()).tower.objective).toBe(false);
    expect(buildMapLayers(state({ objective: 'deliver_egg' })).tower.objective).toBe(true);
  });
});

describe('source guard: HUD / map / loop never read hidden truth', () => {
  const ROOT = join(__dirname, '../../..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f)) files.push(p);
    }
  };
  walk(join(ROOT, 'src/ui/mystery/map'));
  walk(join(ROOT, 'src/ui/mystery/hud'));
  walk(join(ROOT, 'src/app/mystery/hud'));
  for (const f of ['src/ui/mystery/MysteryHud.tsx', 'src/app/mystery/useMysteryLoop.ts', 'src/app/mystery/hudModel.ts', 'src/app/mystery/PlayView.tsx']) files.push(join(ROOT, f));

  it.each(files.map((f) => [f.slice(ROOT.length + 1)]))('%s', (rel) => {
    const src = readFileSync(join(ROOT, rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1'); // comments may NAME the rule; code may not break it
    expect(src).not.toMatch(/\bmap\.clues\b|\.map\.clues\b/);
    expect(src).not.toMatch(/eggSpawn/);
    expect(src).not.toMatch(/\.layout\b/);
    expect(src).not.toMatch(/SessionLayout/);
  });
});
