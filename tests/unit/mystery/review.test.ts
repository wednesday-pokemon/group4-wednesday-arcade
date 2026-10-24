// Regression tests for the 2026-10-24 code review of the overhaul sim (one block per finding).
import { describe, expect, it } from 'vitest';
import { withTuning } from '../../../src/mystery/config.ts';
import { CASES } from '../../../src/mystery/data/cases.ts';
import { caseMap } from '../../../src/mystery/defaults.ts';
import { CASE_IDS, type StampedEvent } from '../../../src/mystery/types.ts';
import { hold, makeRun, modeEvents, place, placeHyde } from './helpers.ts';
import { fixtureWorldMap, WORLD_TUNING, worldRun } from './worldFixture.ts';

const WEST = Math.PI / 2;
const IDLE = { moveX: 0, moveZ: 0, lookYawDelta: 0, lookPitchDelta: 0, sprint: false, crouch: false, interact: false, power: false, move: false, hint: false };

describe('review 1: the SEARCH sweep never reveals a properly hidden player', () => {
  it('hiding-spot stand points keep revealM + radius + arrival slack + margin from the spot centre', () => {
    const run = makeRun({ fixture: { hydeStart: { x: -6, z: 12, yaw: WEST }, patrol: [{ x: -6, z: 12 }] } });
    placeHyde(run, -6, 12, WEST);
    const hs = run.map.hidingSpots[0];
    const spots = run.hydeBrain.planSearchSpots(run, { x: -13, z: 12 });
    const atSpot = spots.filter((s) => Math.hypot(s.look.x - hs.x, s.look.z - hs.z) < 0.01);
    expect(atSpot).toHaveLength(1);
    // the Hyde may stop up to 0.6 m short and the player may sit anywhere within the spot radius
    for (const s of spots) expect(Math.hypot(s.at.x - hs.x, s.at.z - hs.z) - 0.6 - hs.radius).toBeGreaterThan(hs.revealM);
  });

  it('a player hidden at the near edge of the alcove (radius 1.0, revealM 1.5) survives repeated searches next to it', () => {
    for (const [sx, sz] of [[-13, 12], [-12, 15], [-15, 11.5]]) {
      const map = makeRun().map;
      map.hidingSpots[0] = { id: 'hs', x: -15, z: 15, radius: 1.0, revealM: 1.5, kind: 'alcove' };
      const run = makeRun({ map, fixture: { hydeStart: { x: -6, z: 10, yaw: WEST }, patrol: [{ x: -6, z: 10 }] } });
      placeHyde(run, -6, 10, WEST);
      // crouched INSIDE the spot but on the side facing the search centre (0.9 m from the centre)
      const dx = sx + 15;
      const dz = sz - 15;
      const l = Math.hypot(dx, dz);
      place(run, -15 + (dx / l) * 0.9, 15 + (dz / l) * 0.9);
      hold(run, 0.2, { crouch: true });
      expect(run.player.hidden).toBe(true);
      run.hydeBrain.setMode(run, 'INVESTIGATE_SOUND', 'heard_noise');
      run.hyde.target = { x: sx, z: sz };
      for (let i = 0; i < 14 * 60 && run.status === 'playing'; i++) {
        hold(run, 1 / 60, { crouch: true });
        expect(run.hyde.mode, `search centre ${sx},${sz} at t=${run.t.toFixed(2)}`).not.toBe('CHASE');
      }
      expect(run.log.some((e) => e.type === 'hyde_mode' && e.to === 'SEARCH')).toBe(true);
    }
  });
});

describe('review 2: opening a wall invalidates the Hyde plan (no false "reached_target")', () => {
  it('an investigation in progress keeps walking to its goal after the passage opens', () => {
    const run = worldRun({ tuning: withTuning({ hyde: { emergeAfterS: 0 } }, WORLD_TUNING) });
    place(run, -15, 17); // far away, quiet
    run.step();
    expect(run.hydeEmerged).toBe(true);
    placeHyde(run, -12, -6, 0);
    run.hydeBrain.setMode(run, 'INVESTIGATE_SOUND', 'heard_noise');
    run.hyde.target = { x: 15, z: -16 };
    hold(run, 0.2); // it plans and starts walking
    expect(run.hyde.path.length).toBeGreaterThan(0);
    run.openWallPermanently('w_passage');
    const ev = hold(run, 0.2);
    expect(modeEvents(ev)).toEqual([]);
    expect(run.hyde.mode).toBe('INVESTIGATE_SOUND');
    expect(run.hyde.path.length).toBeGreaterThan(0);
  });

  it('a patrolling Hyde does not skip its waypoint when the timed gate opens / closes under it', () => {
    const run = makeRun({ fixture: { hydeStart: { x: -12, z: -10, yaw: 0 }, patrol: [{ x: -12, z: -10 }, { x: 12, z: -10 }] } });
    placeHyde(run, -12, -10, 0);
    place(run, -15, 17);
    hold(run, 0.3);
    const idx = run.hydeBrain.patrolIndex;
    run.world.setWallOpen('gate', true);
    run.hydeBrain.invalidatePath();
    hold(run, 0.05);
    expect(run.hydeBrain.patrolIndex).toBe(idx);
    expect(run.hyde.path.length).toBeGreaterThan(0);
  });
});

describe('review 3: cover search spots look at the hiding place behind the cover, from the side', () => {
  it('stand point ≠ look point, with a clear (crouch-height) line between them', () => {
    const run = makeRun({ fixture: { hydeStart: { x: -6, z: 12, yaw: WEST }, patrol: [{ x: -6, z: 12 }] } });
    placeHyde(run, -6, 12, WEST);
    const spots = run.hydeBrain.planSearchSpots(run, { x: -13, z: 12 });
    const pillar = spots.find((s) => Math.hypot(s.look.x + 10, s.look.z - 8) < 2.5 && Math.hypot(s.look.x + 15, s.look.z - 15) > 0.01)!;
    expect(pillar).toBeTruthy();
    expect(Math.hypot(pillar.at.x - pillar.look.x, pillar.at.z - pillar.look.z)).toBeGreaterThan(1.5);
    expect(run.world.lineOfSight(pillar.at.x, pillar.at.z, pillar.look.x, pillar.look.z, true)).toBe(true);
    // the look point is behind the pillar as seen from the search centre
    expect(run.world.lineOfSight(-13, 12, pillar.look.x, pillar.look.z)).toBe(false);
  });

  it('a crouching (not hidden) player behind the pillar is found by the sweep', () => {
    const run = makeRun({ fixture: { hydeStart: { x: -16, z: 14, yaw: 0 }, patrol: [{ x: -16, z: 14 }] } });
    placeHyde(run, -16, 14, Math.PI);
    place(run, -8.9, 6.6);
    hold(run, 0.2, { crouch: true });
    expect(run.player.hidden).toBe(false);
    run.hydeBrain.setMode(run, 'INVESTIGATE_SOUND', 'heard_noise');
    run.hyde.target = { x: -13, z: 12 };
    const ev = hold(run, 12, { crouch: true });
    expect(ev.some((e) => e.type === 'hyde_sighted')).toBe(true);
  });
});

describe('review 4: examine and lever set player.interacting', () => {
  it('examine: {target: examine} with progress, cleared on completion and when walking away', () => {
    const run = worldRun();
    place(run, -8, 13.2);
    hold(run, 0.5, { interact: true });
    expect(run.player.interacting).toMatchObject({ target: 'examine', id: 'ex_vial' });
    expect(run.player.interacting!.progress).toBeGreaterThan(0.2);
    hold(run, run.tuning.player.examineS);
    expect(run.player.interacting).toBeNull();
    place(run, 8, 13.2);
    hold(run, 0.2, { interact: true });
    expect(run.player.interacting).toMatchObject({ target: 'examine', id: 'ex_books' });
    place(run, 8, 9);
    hold(run, 0.05);
    expect(run.player.interacting).toBeNull();
  });

  it('lever: {target: lever}, cleared when the passage opens', () => {
    const run = worldRun();
    place(run, 17, 3.6);
    hold(run, 0.3, { interact: true });
    expect(run.player.interacting).toMatchObject({ target: 'lever', id: 'p_east' });
    hold(run, run.tuning.player.leverS);
    expect(run.investigation().passageOpen).toBe(true);
    expect(run.player.interacting).toBeNull();
  });
});

describe('review 5: noisy-floor announcements do not leak from the tutorial', () => {
  it('no hazard_triggered in the tutorial; the first loud step on the floor after endTutorial announces it', () => {
    const run = worldRun({ tutorial: true });
    run.player.x = 5;
    run.player.z = 7;
    run.player.yaw = WEST;
    const tut: StampedEvent[] = [];
    for (let i = 0; i < 30; i++) tut.push(...run.update(1 / 60, { ...IDLE, moveZ: 1 }));
    expect(tut.some((e) => e.type === 'noise' && e.source === 'footstep')).toBe(true);
    expect(tut.filter((e) => e.type === 'hazard_triggered')).toEqual([]);
    run.endTutorial();
    const ev = hold(run, 0.8, { moveZ: 1 });
    expect(ev.filter((e) => e.type === 'hazard_triggered')).toEqual([expect.objectContaining({ hazardId: 'hz_glass' })]);
  });
});

describe('review 6: carrying the egg inside the tower, deposit beats every other prompt', () => {
  it('a clue within reach inside the tower radius does not steal the deposit', () => {
    const map = fixtureWorldMap();
    map.clues[0] = { ...map.clues[0], x: 1.2, z: -16.2 };
    const run = worldRun({ map, layout: null });
    place(run, 0, -17);
    expect(run.interactable()?.kind).toBe('clue'); // not carrying: the clue
    run.egg.state = 'carried';
    expect(run.interactable()).toMatchObject({ kind: 'tower' });
    const ev = hold(run, run.tuning.egg.depositS + 0.2, { interact: true });
    expect(ev.some((e) => e.type === 'clue_search_start')).toBe(false);
    expect(run.status).toBe('accusing');
  });

  it("no candidate site, examine or lever of any case lies within the tower radius + interact range", () => {
    for (const id of CASE_IDS) {
      const m = caseMap(id);
      const w = m.world!;
      const reach = m.tower.radius + 1.8;
      const pts = [
        ...w.clueSites.flatMap((g) => g.sites.map((s) => [s.id, s.x, s.z] as const)),
        ...w.eggSites.map((s) => [s.id, s.x, s.z] as const),
        ...w.examines.map((e) => [e.id, e.x, e.z] as const),
        ...(w.passage ? [[w.passage.id, w.passage.leverX, w.passage.leverZ] as const] : []),
      ];
      for (const [pid, x, z] of pts) expect(Math.hypot(x - m.tower.x, z - m.tower.z), `${CASES[id].number} ${pid}`).toBeGreaterThan(reach);
    }
  });
});
