// Joseph Crackstone on the HUD / map / compass / odds / stack / spectator board (docs/overhaul/UX_ENEMIES.md) and the
// R4 position rule (ENEMY_CONTRACT): his marker, compass hat and scan ring only while visible / chasing / attacking /
// revealed — checked against the REAL sim (MysteryRun on the fixture world) and against public-state doubles.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { withTuning } from '../../../src/mystery/config.ts';
import { CASES } from '../../../src/mystery/data/cases.ts';
import { THING } from '../../../src/mystery/data/thing.ts';
import { yawTo } from '../../../src/mystery/geometry.ts';
import { MysteryRun } from '../../../src/mystery/run.ts';
import type { ActiveEffects, CrackstoneDef, CrackstoneRuntime, GameEvent, InvestigationState, MapDef, Vec2 } from '../../../src/mystery/types.ts';
import type { LiveForecasts } from '../../../src/mystery/analytics/types.ts';
import {
  AlertLimiter, CRACK_HEAD, CRACK_THREAT, CrackThreatHold, TelegraphTracker, codeOf, crackMapState, crackMarkerKind, crackPillKey, crackstoneOf,
  curseEdgeWanted, encounterStart, type CrackHandle,
} from '../../../src/app/mystery/hud/crackstone.ts';
import { pickThreatEdge, type MysteryHudModel } from '../../../src/app/mystery/hudModel.ts';
import { buildOdds, crackGroup } from '../../../src/app/mystery/hud/oddsModel.ts';
import { compassMarkers } from '../../../src/app/mystery/hud/navFeed.ts';
import { CompassClamp, layoutCompass } from '../../../src/app/mystery/hud/compass.ts';
import { buildMapLayers, crackBand, distToPolygon, mapGeometry, type PublicMapState } from '../../../src/ui/mystery/map/mapData.ts';
import { insetPolygon, textWidth, textWidthCacheSize } from '../../../src/ui/mystery/map/mapRender.ts';
import { MysteryHud } from '../../../src/ui/mystery/MysteryHud.tsx';
import { chasesText, crackOf, curseCounts, kpiRibbon, stationViewFromBoard, stationViewFromLocal } from '../../../src/ui/mystery/stationView.ts';
import { crackBlock } from '../../../src/ui/mystery/investigationView.ts';
import { hold, place } from '../mystery/helpers.ts';
import { fixtureWorldMap, worldRun, WORLD_TUNING } from '../mystery/worldFixture.ts';

const rect = (minX: number, minZ: number, maxX: number, maxZ: number): Vec2[] => [
  { x: minX, z: minZ }, { x: minX, z: maxZ }, { x: maxX, z: maxZ }, { x: maxX, z: minZ },
];
const DEF: CrackstoneDef = {
  areaName: 'Test Yard', polygon: rect(-18, 2, 18, 19.5),
  patrol: [{ x: -10, z: 12 }, { x: 10, z: 12 }, { x: 10, z: 5 }, { x: -10, z: 5 }],
  start: { x: -10, z: 12, yaw: -Math.PI / 2 }, leashM: 12,
};
const NO_FX = { enemiesRevealed: false, enemyRevealRangeM: 0 } as const;

function crackRun(): MysteryRun {
  const m = fixtureWorldMap({ hazards: [] });
  const map: MapDef = { ...m, world: { ...m.world!, crackstone: DEF } };
  // Hyde far away (emerges at 999 s), scans only when forced, he stands still on his loop
  const tuning = withTuning({ hyde: { emergeAfterS: 999 }, crackstone: { scanEveryS: 9999, scanJitterS: 0, speed: { PATROL: 0 } } }, WORLD_TUNING);
  return worldRun({ map, tuning });
}
function placeC(run: MysteryRun, x: number, z: number, face: Vec2): void {
  const c = run.crackstone!;
  c.x = x;
  c.z = z;
  c.yaw = yawTo(x, z, face.x, face.z);
  run.crackstoneBrain!.invalidatePath();
}
const step = (run: MysteryRun) => hold(run, run.tuning.fixedStepS);

function mapState(run: MysteryRun, crack: ReturnType<typeof crackMapState> | null, over: Partial<PublicMapState> = {}): PublicMapState {
  return {
    t: run.t, geometry: mapGeometry(run.map), world: run.map.world ?? null, investigation: run.investigation(), forecasts: null, cluesFound: [],
    objective: 'find_clues', player: { x: run.player.x, z: run.player.z, yaw: run.player.yaw, stance: 'walk', crouched: false, noiseRadiusM: 0, noiseBand: 'quiet' },
    eggState: 'resting', eggMarker: null, hyde: null, openWalls: [], seenHazards: [], leverSeen: false, showSwitch: false,
    hint: { level: 0, areaId: null, target: null }, target: null, route: null, visitedAreas: [], areaDoneAt: {}, flashes: [], crack, ...over,
  };
}

// ------------------------------------------------------------------------------------------------- R4 (real sim)

describe('R4: Crackstone position only while visible / chasing / attacking / revealed (real MysteryRun)', () => {
  it('behind a wall in PATROL: no marker, no compass hat, no scan ring — even while a scan is pending', () => {
    const run = crackRun();
    const c = crackstoneOf(run)!;
    expect(c).not.toBeNull();
    place(run, -10, -8, 0); // north of the stone wall z = 0 (x −20…−2)
    placeC(run, -10, 8, { x: -10, z: -8 }); // south of it, facing the player through the wall
    step(run);
    expect(run.crackstoneVisible()).toBe(false);
    expect(crackMarkerKind(c, run.effects(), run.player)).toBeNull();
    run.crackstoneBrain!.nextScanAt = run.t; // force a scan warning (a PUBLIC telegraph)
    step(run);
    expect(run.crackstone!.scan?.phase).toBe('warning');
    const slice = crackMapState(c, run.effects(), run.player, null);
    expect(slice.marker).toBeNull();
    expect(slice.scan).toBeNull(); // the ring would give his position away
    const L = buildMapLayers(mapState(run, slice), 'mini');
    expect(L.crack?.marker).toBeNull();
    expect(L.crack?.scan).toBeNull();
    expect(compassMarkers(mapState(run, slice), L, { heardHydeBearing: null, showPredictions: true, forecasts: null }).some((m) => m.kind === 'crack_seen')).toBe(false);
    // the area itself is public
    expect(L.crack?.area.name).toBe('Test Yard');
  });

  it('in line of sight: hat + cone (+ the scan ring with it); then behind the wall again → an 8 s fading outline only', () => {
    const run = crackRun();
    const c = crackstoneOf(run)!;
    placeC(run, -10, 12, { x: -10, z: 19 }); // looking south, away from the player
    place(run, 0, 12, Math.PI / 2); // 10 m east of him in the open yard, facing west
    step(run);
    expect(run.crackstoneVisible()).toBe(true);
    run.crackstoneBrain!.nextScanAt = run.t;
    step(run);
    const seen = crackMapState(c, run.effects(), run.player, null);
    expect(seen.marker?.kind).toBe('visible');
    expect(seen.marker?.coneDeg).toBe(run.crackstoneBrain!.cfg.sight.coneDeg);
    expect(seen.scan).not.toBeNull();
    const L = buildMapLayers(mapState(run, seen), 'mini');
    expect(L.crack?.marker?.kind).toBe('visible');
    expect(compassMarkers(mapState(run, seen), L, { heardHydeBearing: null, showPredictions: true, forecasts: null }).some((m) => m.kind === 'crack_seen')).toBe(true);
    // behind the wall: the live marker goes, the last sighting fades over 8 s
    place(run, -10, -8, 0);
    step(run);
    expect(run.crackstoneVisible()).toBe(false);
    const gone = crackMapState(c, run.effects(), run.player, null);
    expect(gone.marker).toBeNull();
    const faded = buildMapLayers(mapState(run, gone, { t: run.t + 4 }), 'mini');
    expect(faded.crack?.marker).toMatchObject({ kind: 'last' });
    expect(faded.crack!.marker!.alpha).toBeGreaterThan(0.4);
    expect(faded.crack!.marker!.alpha).toBeLessThan(0.6);
    expect(buildMapLayers(mapState(run, gone, { t: run.t + 9 }), 'mini').crack?.marker).toBeNull();
  });

  it('CHASE / ATTACK make his position public; an enemy reveal only within its range; inactive (tutorial) never', () => {
    const run = crackRun();
    const c = crackstoneOf(run)!;
    place(run, -10, -8, 0);
    placeC(run, -10, 8, { x: 10, z: 8 });
    step(run);
    run.crackstone!.mode = 'CHASE';
    expect(crackMarkerKind(c, NO_FX, run.player)).toBe('chase');
    run.crackstone!.mode = 'ATTACK';
    expect(crackMarkerKind(c, NO_FX, run.player)).toBe('attack');
    run.crackstone!.mode = 'SEARCH';
    expect(crackMarkerKind(c, NO_FX, run.player)).toBeNull(); // SEARCH is never public
    expect(crackMarkerKind(c, { enemiesRevealed: true, enemyRevealRangeM: 0 }, run.player)).toBe('revealed');
    expect(crackMarkerKind(c, { enemiesRevealed: true, enemyRevealRangeM: 10 }, run.player)).toBeNull(); // 16 m away
    expect(crackMarkerKind(c, { enemiesRevealed: true, enemyRevealRangeM: 20 }, run.player)).toBe('revealed');
    const tut = new MysteryRun({ duo: { characterId: 'enid', pokemonId: 'gengar' }, seed: 's1', caseDef: CASES.crypt_last_witness, tutorial: true });
    const ct = crackstoneOf(tut)!;
    tut.crackstone!.mode = 'CHASE';
    expect(crackMarkerKind(ct, { enemiesRevealed: true, enemyRevealRangeM: 0 }, tut.player)).toBeNull();
  });

  it('a case without Crackstone: no handle, nothing drawn', () => {
    const run = worldRun();
    expect(crackstoneOf(run)).toBeNull();
    expect(buildMapLayers(mapState(run, null)).crack).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------- plaque + banner

function fake(rt: Partial<CrackstoneRuntime>, o: { scan?: 'exposed' | 'covered' | 'out' | null; curse?: 'exposed' | 'covered' | 'out' | null; visible?: boolean } = {}): CrackHandle {
  const full: CrackstoneRuntime = {
    mode: 'PATROL', modeT: 0, x: 0, z: 0, yaw: 0, speed: 0, suspicion: 0, canSeePlayer: false, lastKnown: null, target: null, path: [],
    stunnedUntil: 0, slowedUntil: 0, slowMult: 1, distractedUntil: 0, scan: null, curse: null, ...rt,
  };
  return crackstoneOf({
    crackstone: full, crackstoneDef: { areaName: 'Archive Stacks', polygon: rect(0, 0, 10, 10) },
    crackstoneBrain: { active: true, cfg: { suspicion: { chaseAt: 1 }, sight: { coneDeg: 90 }, scanWarnS: 2.2, scanRadiusM: 10, curseWindupS: 1.4, curseSlowS: 2.5, curseHp: 15 } },
    crackstoneVisible: () => !!o.visible, scanExposure: () => o.scan ?? null, curseExposure: () => o.curse ?? null,
  })!;
}
const FX = { cursed: false } as Pick<ActiveEffects, 'cursed'>;
const ev = (e: GameEvent) => e;

describe('status plaque (§1)', () => {
  it('all 7 states: word + icon; SEES YOU while he sees you; scan in any non-chase mode', () => {
    expect(crackPillKey({ mode: 'PATROL', canSeePlayer: false, scan: null })).toBe('PATROL');
    expect(crackPillKey({ mode: 'PATROL', canSeePlayer: true, scan: null })).toBe('SEES');
    expect(crackPillKey({ mode: 'INVESTIGATE', canSeePlayer: false, scan: null })).toBe('INVESTIGATE');
    expect(crackPillKey({ mode: 'SEARCH', canSeePlayer: false, scan: { phase: 'warning', startedAt: 0, pulseAt: 2, radiusM: 10 } })).toBe('SCAN');
    expect(crackPillKey({ mode: 'CHASE', canSeePlayer: true, scan: null })).toBe('CHASE');
    expect(crackPillKey({ mode: 'ATTACK', canSeePlayer: true, scan: null })).toBe('ATTACK');
    expect(crackPillKey({ mode: 'RETURN', canSeePlayer: false, scan: null })).toBe('RETURN');
    expect(Object.fromEntries(Object.entries(CRACK_THREAT).map(([k, v]) => [k, `${v.icon}:${v.word}`]))).toEqual({
      PATROL: 'eye:Patrolling', SEES: 'eye:SEES YOU', INVESTIGATE: 'eye:Saw movement', SEARCH: 'search:Searching', CHASE: 'hat:HUNTING YOU',
      ATTACK: 'curse:CURSING', RETURN: 'reset:Going back', SCAN: 'scanEye:Scanning',
    });
  });

  it('0.5 s hold; CHASE and ATTACK bypass it', () => {
    const h = new CrackThreatHold();
    expect(h.update('SEES', 0)).toBe('SEES');
    expect(h.update('PATROL', 0.2)).toBe('SEES');
    expect(h.update('PATROL', 0.6)).toBe('PATROL');
    expect(h.update('CHASE', 0.65)).toBe('CHASE');
    expect(h.update('ATTACK', 0.7)).toBe('ATTACK');
  });
});

describe('telegraph banner (§2): exposure-aware copy, countdowns from the runtime, results from events', () => {
  it('scan exposed → "SCAN IN x.x s" + crouching won’t help; covered → "You’re covered"; out → no banner', () => {
    const scan = { phase: 'warning' as const, startedAt: 10, pulseAt: 12.2, radiusM: 10 };
    const tt = new TelegraphTracker();
    const out = tt.update(fake({ scan }, { scan: 'exposed' }), [], FX, 10.4, 0);
    expect(out.banner).toMatchObject({ kind: 'scan', head: 'SCAN IN 1.8 s', text: 'Get behind a wall or hide. Crouching won’t help.', tone: 'danger', leftS: 1.8 });
    expect(out.banner!.frac!).toBeCloseTo(1.8 / 2.2, 3);
    expect(out.announce).toEqual(['Crackstone scan in 2 seconds. Get behind a wall or hide.']);
    expect(tt.update(fake({ scan }, { scan: 'exposed' }), [], FX, 10.5, 0.1).announce).toEqual([]); // once
    const cov = new TelegraphTracker().update(fake({ scan }, { scan: 'covered' }), [], FX, 10.6, 0);
    expect(cov.banner).toMatchObject({ head: 'SCAN IN 1.6 s', text: 'You’re covered. Stay put.', tone: 'calm' });
    expect(cov.announce).toEqual([]);
    expect(new TelegraphTracker().update(fake({ scan }, { scan: 'out' }), [], FX, 10.6, 0).banner).toBeNull();
  });

  it('pulse miss after a shown banner → "Scan passed. Unseen." 1.0 s + the once-only log; hit → SEEN BY THE SCAN 1.2 s', () => {
    const scan = { phase: 'warning' as const, startedAt: 10, pulseAt: 12.2, radiusM: 10 };
    const tt = new TelegraphTracker();
    tt.update(fake({ scan }, { scan: 'covered' }), [], FX, 11, 0);
    const miss = tt.update(fake({}), [ev({ type: 'crackstone_scan', phase: 'pulse', radiusM: 10, hit: false })], FX, 12.2, 1.2);
    expect(miss.banner).toMatchObject({ kind: 'scan_miss', head: 'Scan passed. Unseen.', tone: 'muted' });
    expect(miss.log).toBe('Walls and hiding spots block scans.');
    expect(tt.update(fake({}), [], FX, 13.3, 2.3).banner).toBeNull(); // 1.0 s
    tt.update(fake({ scan: { ...scan, startedAt: 30, pulseAt: 32.2 } }, { scan: 'covered' }), [], FX, 31, 3);
    expect(tt.update(fake({}), [ev({ type: 'crackstone_scan', phase: 'pulse', radiusM: 10, hit: false })], FX, 32.2, 4).log).toBeNull(); // once per run
    const hit = new TelegraphTracker().update(fake({}), [ev({ type: 'crackstone_scan', phase: 'pulse', radiusM: 10, hit: true })], FX, 12.2, 0);
    expect(hit.banner).toMatchObject({ kind: 'scan_hit', head: 'SEEN BY THE SCAN' });
  });

  it('curse: inside → "Step out of the ring!" (assertive once); hit → "CURSED −N HP" from the event + slow seconds from tuning; blocked; miss', () => {
    const curse = { x: 0, z: 0, radiusM: 1.8, startedAt: 20, landsAt: 21.4 };
    const tt = new TelegraphTracker();
    const inside = tt.update(fake({ mode: 'ATTACK', curse }, { curse: 'exposed' }), [], FX, 20.1, 0);
    expect(inside.banner).toMatchObject({ kind: 'curse', head: 'CURSE IN 1.3 s', text: 'Step out of the ring!', tone: 'danger' });
    expect(inside.announce).toEqual(['Curse! Leave the ring.']);
    expect(new TelegraphTracker().update(fake({ mode: 'ATTACK', curse }, { curse: 'out' }), [], FX, 20.1, 0).banner).toMatchObject({ text: 'You’re clear. Keep moving.', tone: 'calm' });
    const hit = tt.update(fake({ mode: 'RETURN' }), [ev({ type: 'curse', phase: 'hit', hpLost: 17, blocked: false })], { cursed: true }, 21.4, 1.3);
    expect(hit.banner).toMatchObject({ kind: 'curse_hit', head: 'CURSED −17 HP', text: 'Slowed for 2.5 s' });
    expect(hit.cursedLeftS).toBe(2.5);
    expect(tt.update(fake({ mode: 'RETURN' }), [], { cursed: true }, 22.4, 2.3).cursedLeftS).toBe(1.5);
    expect(new TelegraphTracker().update(fake({}), [ev({ type: 'curse', phase: 'hit', hpLost: 0, blocked: true })], FX, 21.4, 0).banner).toMatchObject({ head: 'CURSE BLOCKED', text: 'No damage.', tone: 'good', icon: 'shieldCheck' });
    expect(new TelegraphTracker().update(fake({}), [ev({ type: 'curse', phase: 'miss', hpLost: 0, blocked: false })], FX, 21.4, 0).banner).toMatchObject({ head: 'Curse missed', tone: 'muted' });
  });

  it('curse beats scan for the one slot', () => {
    const out = new TelegraphTracker().update(
      fake({ mode: 'ATTACK', scan: { phase: 'warning', startedAt: 0, pulseAt: 2, radiusM: 10 }, curse: { x: 0, z: 0, radiusM: 1.8, startedAt: 0, landsAt: 1.4 } }, { scan: 'exposed', curse: 'exposed' }),
      [], FX, 0.5, 0,
    );
    expect(out.banner?.kind).toBe('curse');
  });

  it('curse edge cue only when the centre is off-screen and the player is inside / within 2 m of the rim', () => {
    const cu = { x: 0, z: 0, radiusM: 1.8 };
    expect(curseEdgeWanted(cu, { x: 1, z: 1 }, 120)).toBe(true);
    expect(curseEdgeWanted(cu, { x: 3, z: 0 }, 10)).toBe(false); // centre on screen
    expect(curseEdgeWanted(cu, { x: 5, z: 0 }, 120)).toBe(false); // 3.2 m outside the rim
    expect(curseEdgeWanted(cu, { x: 0.3, z: 0 }, 0)).toBe(true); // under the camera
  });
});

describe('one threat-edge chevron (§4): Hyde CHASE > Crackstone ATTACK > Crackstone CHASE > Hyde SEARCH', () => {
  const at = { x: 0.1, y: 0.5, rot: 1 };
  const other = { x: 0.9, y: 0.5, rot: -1 };
  it('order + Crackstone SEARCH never gets one', () => {
    expect(pickThreatEdge('CHASE', at, { chase: other, attack: null, curse: null }, 'CHASE')?.enemy).toBe('hyde');
    expect(pickThreatEdge('SEARCH', at, { chase: null, attack: other, curse: null }, 'ATTACK')).toMatchObject({ enemy: 'crack', icon: 'curse' });
    expect(pickThreatEdge('SEARCH', at, { chase: null, attack: other, curse: { x: 0.5, y: 0.96, rot: Math.PI } }, 'ATTACK')?.at.y).toBe(0.96);
    expect(pickThreatEdge('SEARCH', at, { chase: other, attack: null, curse: null }, 'CHASE')).toMatchObject({ enemy: 'crack', icon: 'hat' });
    expect(pickThreatEdge('SEARCH', at, null, null)).toMatchObject({ enemy: 'hyde', strong: false });
    expect(pickThreatEdge('PATROL', null, { chase: null, attack: null, curse: null }, null)).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------- stack limits

describe('ThingStack limits (§6)', () => {
  it('Crackstone P5 ≤ 1 per 20 s; same code ≥ 45 s apart; Hyde + Crackstone alerts ≤ 4 / min; Hyde alerts never dropped', () => {
    const l = new AlertLimiter();
    const crack = (id: string, priority = 5) => ({ id, head: CRACK_HEAD, priority });
    expect(l.allow(crack('crack_chase_saw_player_10'), 0)).toBe(true);
    expect(l.allow(crack('crack_curse_hit_20'), 10)).toBe(false); // P5 within 20 s
    expect(l.allow(crack('crack_curse_hit_21'), 21)).toBe(true);
    expect(l.allow(crack('crack_chase_saw_player_30'), 30)).toBe(false); // same code < 45 s
    expect(l.allow(crack('crack_escape_lost_sight_31', 3), 31)).toBe(true);
    const m = new AlertLimiter();
    for (let i = 0; i < 4; i++) expect(m.allow({ id: `hyde_${i}`, head: 'HYDE ALERT', priority: 5 }, i)).toBe(true);
    expect(m.allow(crack('crack_chase_scan_hit_9'), 5)).toBe(false); // 4 alerts this minute
    expect(m.allow({ id: 'hyde_x', head: 'HYDE ALERT', priority: 5 }, 6)).toBe(true);
    expect(codeOf('crack_chase_saw_player_412')).toBe('crack_chase_saw_player');
  });

  it('encounters start only on CHASE by saw / sensed / scan_hit (not his own curse → chase, not a deferral)', () => {
    expect(encounterStart({ type: 'crackstone_mode', from: 'INVESTIGATE', to: 'CHASE', reason: 'saw_player' })).toBe(true);
    expect(encounterStart({ type: 'crackstone_mode', from: 'PATROL', to: 'CHASE', reason: 'scan_hit' })).toBe(true);
    expect(encounterStart({ type: 'crackstone_mode', from: 'ATTACK', to: 'CHASE', reason: 'curse_missed' })).toBe(false);
    expect(encounterStart({ type: 'crackstone_mode', from: 'CHASE', to: 'SEARCH', reason: 'deferred' })).toBe(false);
  });

  it('the scan / curse warnings and the deferral line exist in the script (the loop filters them out of the stack)', () => {
    expect(THING.crackstone.scanWarn.text.length).toBeGreaterThan(0);
    expect(THING.crackstone.curseWarn.text.length).toBeGreaterThan(0);
    expect(THING.crackstone.deferred.text.length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------------------------------------- odds + map + compass

function forecasts(crack: LiveForecasts['crackstone'] | undefined, phase: 'active' | 'before_emergence' = 'active'): LiveForecasts {
  const zones = [0.4, 0.3, 0.2, 0.1].map((p, i) => ({ zoneId: `z${i}`, name: `Zone ${i}`, p, polygon: rect(i * 10, 0, i * 10 + 10, 10) }));
  return {
    detection: null, extraction: { p: 0.6, source: 'rule', label: 'Rule-based estimate' },
    egg: { sites: [0.5, 0.3, 0.2].map((p, i) => ({ siteId: `e${i}`, areaId: 'a', label: `Egg ${i}`, x: 0, z: 0, p, prevP: null, ruledOut: false })), label: 'Bayesian estimate', lastChange: null },
    clueAreas: { areas: [{ areaId: 'a1', name: 'Greenhouse', x: 0, z: 0, radiusM: 5, p: 0.8 }], label: 'Bayesian estimate' },
    hyde: phase === 'active' ? { phase: 'active', zones, label: 'Bayesian estimate' } : { phase: 'before_emergence', emergesInS: 20, spawns: [0.5, 0.3, 0.2].map((p, i) => ({ spawnId: `s${i}`, name: `Spawn ${i}`, zoneId: 'z0', x: 0, z: 0, p })), label: 'Rule-based estimate' },
    ...(crack !== undefined ? { crackstone: crack } : {}),
  } as LiveForecasts;
}
const CF = (p: number, fact: 'seen' | 'hidden' | 'hunting' | null = null): NonNullable<LiveForecasts['crackstone']> => ({
  cells: [{ x: 2, z: 2, sizeM: 4, p: 0.7 }, { x: 6, z: 2, sizeM: 4, p: 0.2 }, { x: 10, z: 2, sizeM: 4, p: 0.05 }],
  here: { p, fact }, horizonS: 10, label: 'Rule-based estimate', area: { name: 'Archive Stacks', polygon: rect(0, 0, 10, 10) },
});
const INV: InvestigationState = { checkedClueSites: [], knownClueSites: {}, checkedEggSites: [], eggSeenAt: null, traces: [], examined: [], passageOpen: false, hydeEmerged: true, hydeEmergedAt: 0, hydeEmergesInS: null, lastHydeSighting: null };

describe('Odds panel (§5)', () => {
  it('no forecast → no Crackstone row (never invented); p < 5 % and far → hidden; near the area → shown', () => {
    expect(crackGroup(forecasts(undefined), 0)).toBeNull();
    expect(crackGroup(forecasts(CF(0.02)), 40)).toBeNull();
    expect(crackGroup(forecasts(CF(0.02)), 12)?.rows[0]!.cell.text).toBe('<5%');
    const g = crackGroup(forecasts(CF(0.22)), null)!;
    expect(g.rows[0]).toMatchObject({ name: 'Sees this spot · 10 s', cell: { text: '20%', band: 'unlikely' } });
    expect(crackGroup(forecasts(CF(0.9, 'hunting')), null)!.rows[0]!.cell.text).toBe('Hunting you');
    expect(crackGroup(forecasts(CF(0.0, 'hidden')), null)!.rows[0]!.cell.text).toBe('Hidden');
    expect(crackGroup(forecasts(CF(0.9, 'seen')), null)!.rows[0]!.cell.text).toBe('Seen now');
  });

  it('≤ 4 rows: find_clues Hyde 1 + Crackstone + Clue + Egg · find_egg Hyde 1 + Crackstone + Egg 2 · carry Hyde 2 + Crackstone + Tower · dormant Spawns 2 + Crackstone + Clue', () => {
    const shape = (v: ReturnType<typeof buildOdds>) => v.groups.map((g) => `${g.id}${g.rows.length}`).join(' ');
    const f = forecasts(CF(0.3));
    expect(shape(buildOdds('find_clues', f, INV, new Map()))).toBe('hyde1 crack1 clue1 egg1');
    expect(shape(buildOdds('find_egg', f, INV, new Map()))).toBe('hyde1 crack1 egg2');
    expect(shape(buildOdds('carry', f, INV, new Map()))).toBe('hyde2 crack1 tower1');
    expect(shape(buildOdds('dormant', forecasts(CF(0.3), 'before_emergence'), INV, new Map()))).toBe('spawn2 crack1 clue1');
    expect(buildOdds('find_clues', f, INV, new Map()).footer).toEqual(['Bayesian estimate', 'Crackstone · Rule-based estimate']);
    // without him the Hyde keeps its rows
    expect(shape(buildOdds('find_clues', forecasts(undefined), INV, new Map()))).toBe('hyde2 clue1 egg1');
  });

  it('Tab block "Will Crackstone see you?" only in his cases; "Not available yet." without the forecast', () => {
    expect(crackBlock({ forecasts: forecasts(undefined), world: null, investigation: null, cluesFound: [], clueTotal: 3 })).toBeNull();
    const run = crackRun();
    expect(crackBlock({ forecasts: null, world: run.map.world, investigation: null, cluesFound: [], clueTotal: 3 })).toMatchObject({ question: 'Will Crackstone see you?', fact: 'Not available yet.' });
    const b = crackBlock({ forecasts: forecasts(CF(0.45)), world: run.map.world, investigation: null, cluesFound: [], clueTotal: 3 })!;
    expect(b.rows[0]).toMatchObject({ value: '45%', tone: 'crack' });
    expect(b.source).toBe('Rule-based estimate · his patrol route, sight rules, last sighting');
  });
});

describe('minimap layers (§3) + compass (§4)', () => {
  it('stipple bands (p < .10 not drawn), cursed-area label promoted for 30 s / within 10 m, own-cell hat % label, curse pie progress', () => {
    expect([0.05, 0.1, 0.29, 0.3, 0.59, 0.6].map(crackBand)).toEqual([null, 0, 0, 1, 1, 2]);
    const run = crackRun();
    place(run, -10, -12, 0); // 14 m from the area
    const c = fake({ curse: { x: -10, z: -12, radiusM: 1.8, startedAt: 0, landsAt: 1.4 } });
    const slice = { ...crackMapState(c, NO_FX, run.player, null), area: { name: 'Test Yard', polygon: DEF.polygon } };
    const base = mapState(run, slice, { forecasts: forecasts(CF(0.33)), t: 0.7 });
    const L = buildMapLayers(base, 'mini');
    expect(L.crack!.risk.map((r) => r.band)).toEqual([2, 0]);
    expect(L.crack!.curse!.progress).toBeCloseTo(0.5, 3);
    const lab = L.labels.find((l) => l.id === 'crack:area')!;
    expect(lab).toMatchObject({ text: 'CURSED · Test Yard', priority: 2.5, color: 'crack' });
    expect(L.labels.find((l) => l.id === 'crack:here')).toMatchObject({ text: '35%', glyph: 'hat' });
    expect(buildMapLayers(mapState(run, { ...slice, announcedAt: 0 }, { t: 20 }), 'mini').labels.find((l) => l.id === 'crack:area')!.priority).toBe(1);
    place(run, -10, -6, 0); // 8 m from the area
    expect(buildMapLayers(mapState(run, slice), 'mini').labels.find((l) => l.id === 'crack:area')!.priority).toBe(1);
    expect(distToPolygon(DEF.polygon, 0, 10)).toBe(0);
    // inset polygon for the dashed inner line
    expect(insetPolygon(rect(0, 0, 10, 10), 1)).toEqual(expect.arrayContaining([{ x: 1, z: 1 }, { x: 9, z: 9 }]));
  });

  it('compass: CURSED text toward the area (≤ 60 m, outside); enemy glyph collision → the chaser wins, else the nearer', () => {
    const run = crackRun();
    place(run, -10, -12, 0);
    const slice = { ...crackMapState(fake({}), NO_FX, run.player, null), area: { name: 'Test Yard', polygon: DEF.polygon } };
    const s = mapState(run, slice);
    const mk = compassMarkers(s, buildMapLayers(s, 'mini'), { heardHydeBearing: null, heardCrackBearing: 90, showPredictions: true, forecasts: null });
    expect(mk.find((m) => m.kind === 'cursed_area')).toMatchObject({ name: 'CURSED' });
    expect(mk.find((m) => m.kind === 'crack_heard')).toMatchObject({ bearing: 90 });
    place(run, 0, 10, 0); // inside the area → no CURSED marker
    const s2 = mapState(run, slice);
    expect(compassMarkers(s2, buildMapLayers(s2, 'mini'), { heardHydeBearing: null, showPredictions: true, forecasts: null }).some((m) => m.kind === 'cursed_area')).toBe(false);
    const both = layoutCompass(0, [
      { id: 'hyde', kind: 'hyde_seen', bearing: 10, distanceM: 8, lantern: false, chasing: false },
      { id: 'crack', kind: 'crack_seen', bearing: 11, distanceM: 15, lantern: false, chasing: true },
    ], 464, new CompassClamp());
    expect(both.markers.map((m) => m.kind)).toEqual(['crack_seen']);
    const near = layoutCompass(0, [
      { id: 'hyde', kind: 'hyde_seen', bearing: 10, distanceM: 8, lantern: false },
      { id: 'crack', kind: 'crack_seen', bearing: 11, distanceM: 15, lantern: false },
    ], 464, new CompassClamp());
    expect(near.markers.map((m) => m.kind)).toEqual(['hyde_seen']);
  });

  it('P2: label widths are measured once per (font, text)', () => {
    let calls = 0;
    const ctx = { font: '600 15px X', measureText: (t: string) => { calls++; return { width: t.length * 7 } as TextMetrics; } };
    const before = textWidthCacheSize();
    for (let i = 0; i < 30; i++) {
      textWidth(ctx, 'GREENHOUSE');
      textWidth(ctx, '45%');
    }
    expect(calls).toBe(2);
    expect(textWidthCacheSize()).toBe(before + 2);
    ctx.font = '600 21px X';
    textWidth(ctx, '45%');
    expect(calls).toBe(3);
  });
});

// ------------------------------------------------------------------------------------------------- HUD render

describe('HUD render (static)', () => {
  const ability = (key: 'F' | 'Q') => ({ key, name: 'X', art: '', ready: true, cooldownLeftS: 0, cooldownS: 20, activeLeftS: 0, loud: false, denied: null, aimed: false });
  const base: MysteryHudModel = {
    t: 30, status: 'playing', hp: 85, maxHp: 100, catches: 0, stance: 'walk', hidden: false, tooClose: false,
    noise: { level: 0.3, band: 'audible', radiusM: 7 },
    hyde: { mode: 'PATROL', suspicion: 0.1, level: 0, canSee: false, effect: null, bearing: null, edge: false, edgeAt: null, emerged: true, emergesInS: null },
    objective: 'find_clues', objectiveText: 'Find 3 clues.', clues: { found: [], total: 3, order: CASES.poisoned_archive.clues.map((c) => c.id) },
    egg: { state: 'resting', tier: null, points: 0, security: 100, seenLabel: null }, power: ability('F'), move: ability('Q'),
    prompt: null, examineToast: null, clueCard: null, stack: { log: null, card: null }, captions: [], toast: null, catchFlashSeq: 0, hintCooldownS: 0, hintLevel: 0,
    risk: null, odds: { phase: 'hidden', groups: [], footer: [] }, areaName: null, crack: null, banner: null, cursedLeftS: null, threatEdge: null,
  };
  const render = (h: MysteryHudModel) => renderToStaticMarkup(createElement(MysteryHud, { hud: h, tutorial: false, pointerLocked: false, showPredictions: true, nav: () => null }));

  it('crackstone null: the Hyde pill alone, no kicker, no Crackstone UI', () => {
    const html = render(base);
    expect(html).toContain('data-testid="hud-hyde"');
    expect(html).not.toContain('hud-crack');
    expect(html).not.toContain('CRACKSTONE');
    expect(html).not.toContain('mhud-pill__kicker');
  });

  it('plaque with kickers, banner replaces the lock hint and the toast, CURSED row', () => {
    const html = render({
      ...base,
      crack: { key: 'CHASE', word: 'HUNTING YOU', icon: 'hat', meter: 1, effect: null, hunting: true },
      banner: { id: 0, kind: 'scan', head: 'SCAN IN 1.6 s', text: 'You’re covered. Stay put.', tone: 'calm', icon: 'scanEye', leftS: 1.6, frac: 0.7, exposure: 'covered' },
      cursedLeftS: 2.4,
      toast: { id: 1, tone: 'info', icon: 'lock', headline: 'Board locked', sub: null },
    });
    expect(html).toContain('aria-label="Joseph Crackstone"');
    expect(html).toContain('data-state="CHASE"');
    expect(html).toContain('>HYDE<');
    expect(html).toContain('>CRACKSTONE<');
    expect(html).toContain('SCAN IN 1.6 s');
    expect(html).toContain('You’re covered. Stay put.');
    expect(html).not.toContain('Click to look around');
    expect(html).not.toContain('Board locked');
    expect(html).toContain('CURSED · slowed');
    expect(html).toContain('data-enemy="crackstone"'); // his mist while he hunts
  });
});

// ------------------------------------------------------------------------------------------------- spectator

describe('spectator board (§8) + carry-over P4 / P5', () => {
  const live = {
    stationId: 'local', phase: 'investigating' as const, nickname: 'Ada', duo: { characterId: 'enid', pokemonId: 'gengar' }, caseId: 'poisoned_archive' as const,
    clues: 1, egg: { state: 'resting', tier: null, security: 100 }, hp: 85, catches: 0, hydeMode: 'PATROL' as const, risk: null, advice: null, activeTimeS: 60, updatedAt: 1000,
    crackstonePresent: true, crackstoneMode: 'CHASE' as const, chasesHyde: 2, chasesCrack: 1,
  };
  it('Crackstone chip (mode only) + HUNTED + "Chases H2 · C1"; none without him', () => {
    const v = stationViewFromLocal(live as never, 2000);
    expect(v.crack).toMatchObject({ word: 'HUNTING', icon: 'hat', hunting: true });
    expect(v.hunted).toBe(true);
    expect(v.chasesText).toBe('Chases H2 · C1');
    const none = stationViewFromLocal({ ...live, crackstonePresent: false, crackstoneMode: null } as never, 2000);
    expect(none.crack).toBeNull();
    expect(none.chasesText).toBe('Chases 2');
    expect(crackOf(true, 'INVESTIGATE', true)?.word).toBe('Glimpse');
    expect(chasesText(null, true, 1)).toBeNull();
  });

  it('P5: a silent station with no active row reads "No signal", never "Idle"', () => {
    const v = stationViewFromBoard({ stationId: 'station_a', label: 'Station A', row: null, heartbeat: null, lastSeenAt: null, signalLost: true }, 30_000);
    expect(v.phaseText).toBe('No signal');
    expect(v.lost).toBe(true);
    expect(v.notice).toMatch(/cannot see the station/);
    const idle = stationViewFromBoard({ stationId: 'station_a', label: 'Station A', row: null, heartbeat: null, lastSeenAt: 29_000, signalLost: false }, 30_000);
    expect(idle.phaseText).toBe('Idle');
  });

  it('"Curses dodged" KPI: "—" at n = 0, small sample under 10 casts, misses ÷ casts over ended runs', () => {
    const d = { runs: 0, finished: 0, dnf: 0, caseSolvedPctOfFinished: null, extractionPct: null, medianTimeS: null, detectionsPerRun: null };
    expect(kpiRibbon(d).find((k) => k.key === 'curses')).toMatchObject({ label: 'Curses dodged', value: '—', n: 0, small: false });
    const curse = (phase: 'cast' | 'hit' | 'miss') => ({ type: 'curse', phase, hpLost: 0, blocked: false, t: 1, seq: 1 }) as never;
    const c = curseCounts([
      { events: [curse('cast'), curse('miss'), curse('cast'), curse('hit'), curse('cast'), curse('miss')], result: { outcome: 'finished' } },
      { events: [curse('cast'), curse('hit')], result: null }, // still running: not counted
    ]);
    expect(c).toEqual({ cast: 3, hit: 1, miss: 2 });
    expect(kpiRibbon({ ...d, runs: 1, finished: 1 }, c).find((k) => k.key === 'curses')).toMatchObject({ value: '67%', n: 3, small: true });
    // the analytics aggregate's own counts are used when it has them
    expect(kpiRibbon({ ...d, cursesCast: 20, cursesHit: 5 } as never).find((k) => k.key === 'curses')).toMatchObject({ value: '75%', n: 20, small: false });
    expect(kpiRibbon({ ...d, cursesCast: 6, cursesHit: 2, cursesDodgedPct: 50, cursesSmallSample: true } as never, c).find((k) => k.key === 'curses')).toMatchObject({ value: '50%', n: 6, small: true });
    expect(kpiRibbon({ ...d, cursesCast: 0, cursesHit: 0, cursesDodgedPct: null, cursesSmallSample: true } as never).find((k) => k.key === 'curses')).toMatchObject({ value: '—', n: 0, small: false });
  });

  it('P4: "Every finished case was solved." never shows with 0 finished runs', async () => {
    const { DiagnosticLayer } = await import('../../../src/ui/mystery/MysteryDashboard.tsx');
    const agg = { descriptive: { finished: 0 }, diagnostic: { unsolvedRuns: 0, caseFailures: [], failureCauses: [], patterns: [] } } as never;
    const html = renderToStaticMarkup(createElement(DiagnosticLayer, { agg }));
    expect(html).toContain('No finished runs yet.');
    expect(html).not.toContain('Every finished case was solved.');
    const solved = renderToStaticMarkup(createElement(DiagnosticLayer, { agg: { descriptive: { finished: 3 }, diagnostic: { unsolvedRuns: 0, caseFailures: [], failureCauses: [], patterns: [] } } as never }));
    expect(solved).toContain('Every finished case was solved.');
  });
});
