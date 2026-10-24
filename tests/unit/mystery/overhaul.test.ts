// Overhaul sim rules on the fixture world (docs/overhaul/OVERHAUL_CONTRACT.md "Sim rules" 2–9): Bayesian site checks,
// egg traces, examine + lever interactables (and their priority), hazards, Hyde emergence + spawn rule, the player
// seeing the Hyde, reveal powers as exact observations, the calm window and the spot-based SEARCH.
import { describe, expect, it } from 'vitest';
import { Bot } from '../../../src/mystery/bot.ts';
import { withTuning } from '../../../src/mystery/config.ts';
import { searchlightEtaS, searchlightYaw, type SearchlightHazard } from '../../../src/mystery/hazards.ts';
import { playEpisode } from '../../../src/mystery/episode.ts';
import { hidingSafeM } from '../../../src/mystery/hyde.ts';
import { drawHydeSpawn, drawLayout, traceSiteFor } from '../../../src/mystery/layout.ts';
import { pathLength } from '../../../src/mystery/nav.ts';
import { HYDE_ABSENT_DISTANCE_M } from '../../../src/mystery/run.ts';
import { NIGHTSHADE_IDS as NIGHTSHADES, type HazardDef, type SessionLayout, type StampedEvent } from '../../../src/mystery/types.ts';
import { hold, makeRun, modeEvents, neutralRegistries, place, placeHyde } from './helpers.ts';
import { fixtureWorldMap, GLASS, LIGHT, WORLD_TUNING, worldRun } from './worldFixture.ts';

const of = <K extends StampedEvent['type']>(ev: StampedEvent[], type: K) => ev.filter((e): e is Extract<StampedEvent, { type: K }> => e.type === type);
const WEST = Math.PI / 2; // forward (−1, 0)

describe('site checks (Bayesian evidence)', () => {
  it('an empty candidate within siteCheckM + LOS → checkedClueSites + site_checked{found:false}; the true one → known', () => {
    const run = worldRun();
    const R = run.tuning.investigation.siteCheckM;
    place(run, 15 - (R - 0.5), 10);
    let ev = hold(run, 0.1);
    expect(of(ev, 'site_checked')).toEqual([expect.objectContaining({ site: 'clue', siteId: 's_ft_b', found: false })]);
    expect(run.investigation().checkedClueSites).toEqual(['s_ft_b']);
    place(run, -15 + (R - 0.5), 10);
    ev = hold(run, 0.1);
    expect(of(ev, 'site_checked')).toEqual([expect.objectContaining({ site: 'clue', siteId: 's_ft_a', found: true })]);
    const inv = run.investigation();
    expect(inv.knownClueSites).toEqual({ falsified_transfer: 's_ft_a' });
    expect(inv.checkedClueSites).toEqual(['s_ft_b']);
    // never re-checked
    expect(of(hold(run, 0.5), 'site_checked')).toEqual([]);
  });

  it('a wall between, or being out of range, checks nothing', () => {
    const run = worldRun();
    const R = run.tuning.investigation.siteCheckM;
    place(run, -16, 0.8); // e_c (−16, −3) is 3.8 m away behind w_left
    expect(Math.hypot(-16 + 16, 0.8 + 3)).toBeLessThanOrEqual(R);
    expect(of(hold(run, 0.3), 'site_checked')).toEqual([]);
    place(run, 15, 10 + R + 0.6);
    expect(of(hold(run, 0.3), 'site_checked')).toEqual([]);
    expect(run.investigation()).toMatchObject({ checkedClueSites: [], checkedEggSites: [], knownClueSites: {}, eggSeenAt: null });
  });

  it('egg sites: an empty one → checkedEggSites; the true one → eggSeenAt (stays set after pickup)', () => {
    const run = worldRun();
    const R = run.tuning.investigation.siteCheckM;
    place(run, -10, -15 + (R - 0.5));
    expect(of(hold(run, 0.1), 'site_checked')).toEqual([expect.objectContaining({ site: 'egg', siteId: 'e_b', found: false })]);
    place(run, 10, -15 + (R - 0.5));
    expect(of(hold(run, 0.1), 'site_checked')).toEqual([expect.objectContaining({ site: 'egg', siteId: 'e_a', found: true })]);
    expect(run.investigation()).toMatchObject({ checkedEggSites: ['e_b'], eggSeenAt: 'e_a' });
    place(run, 10, -14);
    hold(run, run.tuning.egg.pickupS + 0.2, { interact: true });
    expect(run.egg.state).toBe('carried');
    expect(run.investigation().eggSeenAt).toBe('e_a');
  });

  it('searching with E always counts as a check (even with a tiny siteCheckM); so does starting the egg pickup', () => {
    const run = worldRun({ tuning: withTuning({ investigation: { siteCheckM: 0.1 } }, WORLD_TUNING) });
    place(run, -15, 11.2);
    expect(of(hold(run, 0.2), 'site_checked')).toEqual([]);
    const ev = hold(run, 0.1, { interact: true });
    expect(ev.map((e) => e.type)).toEqual(expect.arrayContaining(['clue_search_start', 'site_checked']));
    expect(run.investigation().knownClueSites).toEqual({ falsified_transfer: 's_ft_a' });
    place(run, 10, -13.8);
    hold(run, 0.05); // walking away pauses the clue search
    hold(run, 0.1, { interact: true });
    expect(run.investigation().eggSeenAt).toBe('e_a');
  });

  it('the public state never exposes the hidden layout before it is observed', () => {
    const run = worldRun({ layout: { clueSites: { falsified_transfer: 's_ft_b', access_ledger: 's_al_b', botanical_residue: 's_br' }, eggSiteId: 'e_c' } });
    const inv = run.investigation();
    expect(JSON.stringify(inv)).not.toMatch(/s_ft_b|s_al_b|e_c|s_br/);
  });
});

describe('egg traces', () => {
  it('a found clue yields one trace_found whose target is traceSiteFor(world, truth, seed, clueId)', () => {
    for (const seed of ['tr-1', 'tr-2', 'tr-3', 'tr-4']) {
      const run = worldRun({ seed });
      place(run, -15, 11.2);
      const ev = hold(run, 2.5, { interact: true });
      const found = of(ev, 'clue_found');
      expect(found).toHaveLength(1);
      const tr = of(ev, 'trace_found');
      const want = traceSiteFor(run.map.world!, 'e_a', seed, 'falsified_transfer');
      expect(tr).toEqual([expect.objectContaining({ sourceId: 'falsified_transfer', siteId: want })]);
      expect(ev.indexOf(tr[0])).toBeGreaterThan(ev.indexOf(found[0]));
      expect(run.investigation().traces).toEqual([{ sourceId: 'falsified_transfer', siteId: want, t: tr[0].t }]);
    }
  });
});

describe('examine and lever interactables', () => {
  it('examine: E prompt with the label, examineS × interactTimeMult, search-like noise, once, trace when givesTrace', () => {
    const run = worldRun({ seed: 'ex-1' });
    place(run, -8, 13.2);
    expect(run.interactable()).toMatchObject({ kind: 'examine', id: 'ex_vial', label: 'Examine the vial', progress: 0 });
    const ev = hold(run, run.tuning.player.examineS + 0.1, { interact: true });
    expect(of(ev, 'noise').filter((n) => n.source === 'interact')[0]).toMatchObject({ loudness: run.tuning.noise.clueSearch });
    expect(of(ev, 'examined')).toEqual([expect.objectContaining({ examineId: 'ex_vial' })]);
    expect(of(ev, 'trace_found')).toEqual([expect.objectContaining({ sourceId: 'ex_vial', siteId: traceSiteFor(run.map.world!, 'e_a', 'ex-1', 'ex_vial') })]);
    expect(run.interactable()).toBeNull(); // examined once only
    expect(run.investigation().examined).toEqual(['ex_vial']);
    place(run, 8, 13.2);
    const ev2 = hold(run, run.tuning.player.examineS + 0.1, { interact: true });
    expect(of(ev2, 'examined')).toHaveLength(1);
    expect(of(ev2, 'trace_found')).toHaveLength(0); // ex_books gives no trace
  });

  it('examine time scales with interactTimeMult', () => {
    const reg = neutralRegistries();
    reg.nightshades.wednesday.mods.interactTimeMult = 2;
    const run = worldRun({ registries: reg });
    place(run, -8, 13.2);
    expect(of(hold(run, run.tuning.player.examineS + 0.1, { interact: true }), 'examined')).toHaveLength(0);
    expect(of(hold(run, run.tuning.player.examineS + 0.1), 'examined')).toHaveLength(1);
  });

  it('lever: opens the passage wall for good (collision, LOS, nav incl. the gate-closed grid) with a lever noise', () => {
    const run = worldRun();
    const from = { x: 17, z: 6 };
    const to = { x: 17, z: -6 };
    const before = pathLength(from, run.playerNav().findPath(from, to)!);
    expect(run.world.lineOfSight(17, 2, 17, -2)).toBe(false);
    place(run, 17, 3.6);
    expect(run.interactable()).toMatchObject({ kind: 'lever', id: 'p_east', label: 'Pull the rusty lever' });
    const ev = hold(run, run.tuning.player.leverS + 0.1, { interact: true });
    expect(of(ev, 'passage_opened')).toEqual([expect.objectContaining({ passageId: 'p_east' })]);
    expect(of(ev, 'noise').at(-1)).toMatchObject({ source: 'interact', x: 17, z: 3, loudness: run.tuning.noise.lever });
    expect(run.isWallOpen('w_passage')).toBe(true);
    expect(run.world.lineOfSight(17, 2, 17, -2)).toBe(true);
    expect(run.investigation().passageOpen).toBe(true);
    const after = pathLength(from, run.playerNav().findPath(from, to)!);
    expect(after).toBeLessThan(before - 10);
    expect(pathLength(from, run.playerNav(true).findPath(from, to)!)).toBeCloseTo(after, 0);
    expect(run.hydeNav().reachable(from, to)).toBe(true);
    expect(run.interactable()?.kind).not.toBe('lever');
    hold(run, 3);
    expect(run.isWallOpen('w_passage')).toBe(true);
  });

  it('priority when several are in reach: clue > egg > lever > examine > switch > set-down', () => {
    const map = fixtureWorldMap();
    const w = map.world!;
    w.examines[0] = { ...w.examines[0], x: 16.4, z: 3.6 };
    map.clues[0] = { ...map.clues[0], x: 17.6, z: 4.4 };
    map.eggSpawn = { x: 16.6, z: 4.6 };
    map.powerSwitch = { id: 'sw', x: 17.3, z: 4.8, gateWallId: 'w_right', openS: 5 };
    const run = worldRun({ map, layout: null });
    place(run, 17, 4);
    expect(run.interactable()?.kind).toBe('clue');
    run.cluesFound.push('falsified_transfer');
    expect(run.interactable()?.kind).toBe('egg');
    run.egg.state = 'carried';
    expect(run.interactable()?.kind).toBe('lever');
    run.inv.passageOpen = true;
    expect(run.interactable()?.kind).toBe('examine');
    run.inv.examined.push('ex_vial');
    expect(run.interactable()?.kind).toBe('switch');
    delete run.map.powerSwitch;
    expect(run.interactable()).toMatchObject({ kind: 'egg', label: 'Hold E to set the egg down' });
  });
});

describe('hazards', () => {
  it('searchlightYaw = phase + 2π·t / periodS (wrapped), negative period turns clockwise; ETA to the beam', () => {
    const h = LIGHT as SearchlightHazard;
    expect(searchlightYaw(h, 0)).toBeCloseTo(0);
    expect(searchlightYaw(h, 2)).toBeCloseTo(Math.PI / 2);
    expect(Math.abs(searchlightYaw(h, 4))).toBeCloseTo(Math.PI);
    expect(searchlightYaw({ ...h, phase: 1, periodS: -8 }, 2)).toBeCloseTo(1 - Math.PI / 2);
    expect(searchlightEtaS(h, 0, 0, -12)).toBe(0); // on the beam now
    expect(searchlightEtaS(h, 0, -4, -8)).toBeCloseTo(2 - 8 * (20 / 360), 5); // yaw π/2 = west, cone half 20°
  });

  it('noisy floor: walking adds loudnessAdd to each footstep (one hazard_triggered per entry); crouching does not', () => {
    const add = (GLASS as Extract<HazardDef, { kind: 'noisy_floor' }>).loudnessAdd;
    const run = worldRun();
    place(run, 5, 7, WEST);
    const ev = hold(run, 1.2, { moveZ: 1 });
    const steps = of(ev, 'noise').filter((n) => n.source === 'footstep');
    expect(steps.length).toBeGreaterThanOrEqual(2);
    for (const s of steps) expect(s.loudness).toBeCloseTo(run.tuning.noise.walk + add, 3);
    expect(of(ev, 'hazard_triggered')).toEqual([expect.objectContaining({ hazardId: 'hz_glass' })]);
    const crouch = worldRun();
    place(crouch, 5, 7, WEST);
    const ce = hold(crouch, 1.5, { moveZ: 1, crouch: true });
    for (const s of of(ce, 'noise').filter((n) => n.source === 'footstep')) expect(s.loudness).toBeCloseTo(crouch.tuning.noise.crouch, 3);
    expect(of(ce, 'hazard_triggered')).toEqual([]);
    const off = worldRun();
    place(off, 5, 15, WEST);
    for (const s of of(hold(off, 1, { moveZ: 1 }), 'noise').filter((n) => n.source === 'footstep')) expect(s.loudness).toBeCloseTo(off.tuning.noise.walk, 3);
  });

  it('searchlight: in the beam → hazard_triggered + a hazard noise at the player, then at most once per cooldown', () => {
    const run = worldRun();
    place(run, 0, -12);
    const ev = hold(run, 9);
    const hits = of(ev, 'hazard_triggered');
    expect(hits.map((h) => h.hazardId)).toEqual(['hz_light', 'hz_light']);
    expect(hits[0].t).toBe(0);
    expect(hits[1].t).toBeCloseTo(8 * (1 - 20 / 360), 1);
    const noises = of(ev, 'noise').filter((n) => n.source === 'hazard');
    expect(noises).toHaveLength(2);
    expect(noises[0]).toMatchObject({ x: 0, z: -12, loudness: 0.6 });
  });

  it('searchlight: not when hidden, not through a wall', () => {
    const slow = { kind: 'searchlight', id: 'hz_slow', name: 'Slow', x: -15, z: 11, rangeM: 8, coneDeg: 60, periodS: 1000, phase: Math.PI, loudness: 0.6, cooldownS: 1 } as const;
    const hidden = worldRun({ hazards: [slow] });
    place(hidden, -15, 15);
    expect(of(hold(hidden, 1, { crouch: true }), 'hazard_triggered')).toEqual([]);
    expect(hidden.player.hidden).toBe(true);
    expect(of(hold(hidden, 0.2), 'hazard_triggered')).toHaveLength(1); // stood up: seen
    const wall = worldRun({ hazards: [{ ...slow, id: 'hz_wall', x: -5, z: -4 }] });
    place(wall, -5, 1.5);
    expect(of(hold(wall, 1), 'hazard_triggered')).toEqual([]);
  });
});

describe('Hyde emergence', () => {
  const fast = withTuning({ hyde: { emergeAfterS: 3 } }, WORLD_TUNING);

  it('absent before emergeAfterS: no movement, no hearing, snapshot reports 999 m; then one hyde_emerged at the drawn spawn', () => {
    const run = worldRun({ tuning: fast, seed: 'em-1' });
    expect(run.hydeEmerged).toBe(false);
    const hx = run.hyde.x;
    expect(run.snapshot()).toMatchObject({ hydeEmerged: false, hydeVisible: false, hydeDistanceM: HYDE_ABSENT_DISTANCE_M, hydeOccluded: true });
    expect(run.hydeBearing().distanceM).toBe(HYDE_ABSENT_DISTANCE_M);
    expect(run.investigation()).toMatchObject({ hydeEmerged: false, hydeEmergedAt: null, hydeEmergesInS: 3 });
    place(run, 0, -6, WEST);
    const ev = hold(run, 2.5, { moveZ: 1, sprint: true });
    expect(of(ev, 'hyde_heard')).toEqual([]);
    expect(run.hyde.x).toBe(hx);
    expect(run.investigation().hydeEmergesInS).toBeCloseTo(0.5, 1);
    place(run, 0, 17);
    const at = { x: 0, z: 17 };
    const ev2 = hold(run, 1);
    const em = of(ev2, 'hyde_emerged');
    expect(em).toHaveLength(1);
    expect(em[0].t).toBeCloseTo(3, 1);
    const spawn = drawHydeSpawn(run.map.world!, 'em-1', at, run.tuning.hyde.minSpawnM)!;
    expect(em[0].spawnId).toBe(spawn.id);
    expect(Math.hypot(em[0].x - spawn.x, em[0].z - spawn.z)).toBeLessThan(1);
    expect(Math.hypot(em[0].x - at.x, em[0].z - at.z)).toBeGreaterThanOrEqual(run.tuning.hyde.minSpawnM - 1);
    expect(run.hydeEmerged).toBe(true);
    expect(run.investigation()).toMatchObject({ hydeEmerged: true, hydeEmergedAt: em[0].t, hydeEmergesInS: null });
    expect(run.snapshot().hydeEmerged).toBe(true);
    const before = { x: run.hyde.x, z: run.hyde.z };
    hold(run, 2);
    expect(Math.hypot(run.hyde.x - before.x, run.hyde.z - before.z)).toBeGreaterThan(1); // patrols
  });

  it('no spawn ≥ minSpawnM from the player → the farthest spawn', () => {
    const run = worldRun({ tuning: fast });
    place(run, 0, 0);
    const em = of(hold(run, 3.2), 'hyde_emerged');
    expect(em[0].spawnId).toBe('sp_w');
  });

  it('spawns follow the renormalised weights across seeds (player at the start: sp_n .5 / sp_w .3 / sp_e .2)', () => {
    const counts: Record<string, number> = {};
    const n = 300;
    for (let i = 0; i < n; i++) {
      const run = worldRun({ tuning: withTuning({ hyde: { emergeAfterS: 0 } }, WORLD_TUNING), seed: `sp-${i}` });
      run.step();
      const e = of(run.log, 'hyde_emerged')[0];
      counts[e.spawnId] = (counts[e.spawnId] ?? 0) + 1;
    }
    expect(Math.abs(counts.sp_n / n - 0.5)).toBeLessThan(0.1);
    expect(Math.abs(counts.sp_w / n - 0.3)).toBeLessThan(0.1);
    expect(Math.abs(counts.sp_e / n - 0.2)).toBeLessThan(0.1);
  });

  it('tutorial: the countdown starts at endTutorial; Hyde-targeted powers are denied before emergence', () => {
    const run = worldRun({ tuning: fast, tutorial: true, duo: { characterId: 'ajax', pokemonId: 'aegislash' } });
    for (let i = 0; i < 300; i++) run.update(1 / 60, { moveX: 0, moveZ: 0, lookYawDelta: 0, lookPitchDelta: 0, sprint: false, crouch: false, interact: false, power: false, move: false, hint: false });
    expect(run.hydeEmerged).toBe(false);
    run.endTutorial();
    expect(run.investigation().hydeEmergesInS).toBe(3);
    const ev = hold(run, 0.1, { power: true });
    expect(of(ev, 'ability_denied')).toEqual([expect.objectContaining({ key: 'F', reason: 'no_target' })]);
    expect(of(hold(run, 3), 'hyde_emerged')).toHaveLength(1);
  });

  it('fixture maps without spawns keep the Hyde from t = 0 (legacy, no event)', () => {
    const run = makeRun();
    expect(run.hydeEmerged).toBe(true);
    expect(run.hydeSpawnId).toBe('start');
    expect(run.investigation().hydeEmergesInS).toBeNull();
  });
});

describe('the player sees the Hyde', () => {
  it('hydeVisible = emerged ∧ LOS ∧ distance ≤ playerSeesHydeM; lastHydeSighting follows', () => {
    const run = worldRun();
    run.emergeHyde();
    run.hydeBrain.stun(run, 30); // frozen where we put it
    place(run, -6, 12);
    placeHyde(run, -6, 4, 0); // 8 m away on the same side of the wall, clear line
    hold(run, 1 / 60);
    expect(run.snapshot().hydeVisible).toBe(true);
    expect(run.investigation().lastHydeSighting).toMatchObject({ x: -6, z: 4 });
    placeHyde(run, -6, -4, 0); // behind w_left
    hold(run, 1 / 60);
    expect(run.snapshot().hydeVisible).toBe(false);
    expect(run.investigation().lastHydeSighting).toMatchObject({ x: -6, z: 4 });
    place(run, 0, 17);
    placeHyde(run, 0, 17 - run.tuning.sight.playerSeesHydeM - 1, 0);
    hold(run, 1 / 60);
    expect(run.snapshot().hydeVisible).toBe(false);
  });
});

describe('reveal powers are exact observations', () => {
  it("Wednesday's vision: the revealed clue's site becomes known; nearer candidate sites of other clues are checked empty; the egg in range is seen", () => {
    const layout: SessionLayout = { clueSites: { falsified_transfer: 's_ft_b', access_ledger: 's_al_a', botanical_residue: 's_br' }, eggSiteId: 'e_a' };
    const run = worldRun({ layout, duo: { characterId: 'wednesday', pokemonId: 'aegislash' } });
    place(run, -10, 12);
    const ev = hold(run, 0.1, { power: true });
    expect(of(ev, 'ability_used')).toHaveLength(1);
    expect(run.effects().revealedClues).toEqual(['access_ledger']);
    const inv = run.investigation();
    expect(inv.knownClueSites).toEqual({ access_ledger: 's_al_a' });
    expect(inv.checkedClueSites).toEqual(['s_ft_a']); // 5.4 m, nearer than the revealed clue (22.6 m)
    expect(inv.eggSeenAt).toBe('e_a'); // within the 35 m range
  });

  it('fewer clues in range than the magnitude → every unfound candidate within range is empty; a reveal missing the egg checks egg sites in range', () => {
    // truth: ft at (15, 10), al at (−5, −10), br at (15, −10), egg e_a (10, −15) — none within 12 m of (−15, 4)
    const run = worldRun({ layout: { clueSites: { falsified_transfer: 's_ft_b', access_ledger: 's_al_b', botanical_residue: 's_br' }, eggSiteId: 'e_a' } });
    place(run, -15, 4);
    run.inv.revealed(run, [], 12, 1); // s_ft_a (6 m) is empty; s_al_a (14 m) is out of range
    expect(run.investigation().checkedClueSites).toEqual(['s_ft_a']);
    run.inv.eggNotRevealed(run, 12); // e_c (7.1 m) is empty; e_b (19.6 m) out of range
    expect(run.investigation().checkedEggSites).toEqual(['e_c']);
  });
});

describe('Hyde polish: calm window and spot-based search', () => {
  const SOUTH_FACING = Math.PI;

  it('when a chase ends the calm window starts (reduced hearing for calmAfterChaseS); the Hyde returns to its patrol', () => {
    const run = makeRun({ fixture: { hydeStart: { x: 0, z: -12, yaw: SOUTH_FACING }, patrol: [{ x: 0, z: -12 }, { x: 8, z: -12 }] } });
    placeHyde(run, 0, -12, SOUTH_FACING);
    place(run, 0, -5, Math.PI);
    hold(run, 1.2);
    expect(run.hyde.mode).toBe('CHASE');
    expect(run.hydeBrain.isCalm(run.t)).toBe(false);
    place(run, -15, 17);
    const ev = hold(run, 20);
    const modes = modeEvents(ev);
    const lost = modes.find((e) => e.from === 'CHASE')!;
    expect(lost).toMatchObject({ to: 'SEARCH', reason: 'lost_sight' });
    expect(run.hydeBrain.calmUntil).toBeCloseTo(lost.t + run.tuning.hyde.calmAfterChaseS, 1);
    expect(modes.map((e) => e.to)).toEqual(expect.arrayContaining(['SEARCH', 'COOLDOWN', 'PATROL']));
    // during the window (SEARCH): calm hearing; in COOLDOWN the stronger reduction wins
    expect(Math.min(run.tuning.hyde.calmHearingMult, run.tuning.noise.cooldownHearingMult)).toBeLessThan(1);
    expect(Math.hypot(run.hyde.x - 0, run.hyde.z + 12) < 9).toBe(true); // back on its loop
  });

  it('calm window: a walk-loud noise 6 m away is not heard; after it, the same noise is', () => {
    const run = makeRun({ fixture: { hydeStart: { x: 0, z: -12, yaw: 0 }, patrol: [{ x: 0, z: -12 }] } });
    placeHyde(run, 0, -12, 0);
    run.hydeBrain.calmUntil = run.t + 5;
    run.noise('footstep', 0, -6, run.tuning.noise.walk);
    expect(run.log.some((e) => e.type === 'hyde_heard')).toBe(false);
    run.hydeBrain.calmUntil = -Infinity;
    run.noise('footstep', 0, -6, run.tuning.noise.walk);
    expect(run.log.some((e) => e.type === 'hyde_heard')).toBe(true);
  });

  it('SEARCH plans hiding-spot and behind-cover spots near the centre, never inside a reveal radius', () => {
    const run = makeRun({ fixture: { hydeStart: { x: -6, z: 12, yaw: WEST }, patrol: [{ x: -6, z: 12 }] } });
    placeHyde(run, -6, 12, WEST);
    const spots = run.hydeBrain.planSearchSpots(run, { x: -13, z: 12 });
    expect(spots.length).toBeGreaterThanOrEqual(2);
    expect(spots.length).toBeLessThanOrEqual(run.tuning.hyde.searchSpotsMax);
    const hs = run.map.hidingSpots[0];
    expect(spots.some((s) => Math.hypot(s.at.x - hs.x, s.at.z - hs.z) < hidingSafeM(hs) + 0.6)).toBe(true); // checks the alcove
    for (const s of spots) expect(Math.hypot(s.at.x - hs.x, s.at.z - hs.z)).toBeGreaterThanOrEqual(hidingSafeM(hs));
    expect(spots.some((s) => Math.hypot(s.look.x + 10, s.look.z - 8) < 2.5)).toBe(true); // looks behind the pillar
    for (const s of spots) expect(run.hydeNav().walkable(s.at.x, s.at.z)).toBe(true);
  });

  it('a player hidden in the alcove survives a search right next to it (and the Hyde does come to look)', () => {
    const run = makeRun({ fixture: { hydeStart: { x: -6, z: 10, yaw: WEST }, patrol: [{ x: -6, z: 10 }] } });
    placeHyde(run, -6, 10, WEST);
    place(run, -15, 15);
    hold(run, 0.2, { crouch: true });
    expect(run.player.hidden).toBe(true);
    run.hydeBrain.setMode(run, 'INVESTIGATE_SOUND', 'heard_noise');
    run.hyde.target = { x: -13, z: 12 };
    let closest = Infinity;
    for (let i = 0; i < 12 * 60 && run.status === 'playing'; i++) {
      hold(run, 1 / 60, { crouch: true });
      closest = Math.min(closest, Math.hypot(run.hyde.x + 15, run.hyde.z - 15));
      expect(run.hyde.mode).not.toBe('CHASE');
    }
    expect(closest).toBeLessThan(hidingSafeM(run.map.hidingSpots[0]) + 0.8);
    expect(run.log.some((e) => e.type === 'hyde_mode' && e.to === 'SEARCH')).toBe(true);
  });
});

describe('the bot plays from public knowledge', () => {
  it('two sessions that differ only in a hidden clue site play identically until an observation tells them apart', () => {
    const base: SessionLayout = { clueSites: { falsified_transfer: 's_ft_a', access_ledger: 's_al_a', botanical_residue: 's_br' }, eggSiteId: 'e_b' };
    const other: SessionLayout = { ...base, clueSites: { ...base.clueSites, falsified_transfer: 's_ft_b' } };
    const play = (layout: SessionLayout) => playEpisode({ characterId: 'enid', pokemonId: 'gengar' }, 'nocheat', { profile: 'stealthy' }, {
      map: fixtureWorldMap(), layout, tuning: WORLD_TUNING, registries: neutralRegistries(),
    });
    const a = play(base).events;
    const b = play(other).events;
    let k = 0;
    while (k < a.length && k < b.length && JSON.stringify(a[k]) === JSON.stringify(b[k])) k++;
    expect(k).toBeLessThan(Math.min(a.length, b.length));
    expect(a[k]).toMatchObject({ type: 'site_checked', site: 'clue' });
    expect(b[k]).toMatchObject({ type: 'site_checked', site: 'clue', siteId: (a[k] as { siteId: string }).siteId });
    expect((a[k] as { found: boolean }).found).not.toBe((b[k] as { found: boolean }).found);
  });

  it('finds every clue and the egg across drawn layouts (checks empty sites on the way, uses traces / the lever)', () => {
    // investigation policy only: the 40 m arena is too small for fair stealth, so the Hyde stays absent here (the real
    // islands are covered by botDuos.<case>.test.ts)
    const map = fixtureWorldMap();
    const noHyde = withTuning({ hyde: { emergeAfterS: 1e6 } }, WORLD_TUNING);
    const stats = { finished: 0, emptyChecks: 0, traces: 0, levers: 0, examines: 0 };
    for (let i = 0; i < 12; i++) {
      const ep = playEpisode({ characterId: NIGHTSHADES[i % 7], pokemonId: 'gengar' }, `fx-bot-${i}`, { profile: 'stealthy' }, {
        map, layout: drawLayout(map.world!, `fx-bot-${i}`), tuning: noHyde, registries: neutralRegistries(),
      });
      expect(ep.timedOut).toBe(false);
      if (ep.result?.outcome === 'finished') {
        stats.finished++;
        expect(ep.result.cluesFound).toHaveLength(3);
      }
      stats.emptyChecks += ep.events.filter((e) => e.type === 'site_checked' && !e.found).length;
      stats.traces += ep.events.filter((e) => e.type === 'trace_found').length;
      stats.levers += ep.events.filter((e) => e.type === 'passage_opened').length;
      stats.examines += ep.events.filter((e) => e.type === 'examined').length;
    }
    console.log('fixture-world bot', JSON.stringify(stats));
    expect(stats.finished).toBe(12);
    expect(stats.emptyChecks).toBeGreaterThan(0);
    expect(stats.traces).toBeGreaterThan(0);
  });
});

describe('bot extras', () => {
  function drive(run: ReturnType<typeof worldRun>, bot: Bot, seconds: number, until: () => boolean): void {
    const every = Math.max(1, Math.round(1 / (bot.o.decisionHz * run.tuning.fixedStepS)));
    let input = bot.decide();
    for (let i = 0; i < seconds * 60 && run.status === 'playing' && !until(); i++) {
      if (i % every === 0) {
        input = bot.decide();
        run.applyLook(input);
        run.setInput(input);
      }
      run.step();
      input = { ...input, interact: false, power: false, move: false, hint: false };
      run.setInput(input);
    }
  }

  it('pulls the passage lever when lever + passage beats the current route by ≥ 6 m', () => {
    const run = worldRun({ tuning: withTuning({ hyde: { emergeAfterS: 1e6 } }, WORLD_TUNING) });
    run.cluesFound.push('falsified_transfer', 'access_ledger'); // only the planter (15, −10) is left
    place(run, 16, 8);
    const bot = new Bot(run, { profile: 'stealthy', startDelayMaxS: 0 }, 'lever');
    drive(run, bot, 20, () => run.investigation().passageOpen);
    expect(run.investigation().passageOpen).toBe(true);
    drive(run, bot, 20, () => run.cluesFound.length === 3);
    expect(run.cluesFound).toHaveLength(3);
  });

  it('stealthy bots wait for searchlight beams: fewer alarms than hazard-blind bots over 16 beam phases, little time lost', () => {
    const play = (avoid: boolean) => {
      let hits = 0;
      let time = 0;
      for (let k = 0; k < 16; k++) {
        const light = { kind: 'searchlight', id: 'hz_sweep', name: 'Sweep', x: 0, z: 6, rangeM: 6, coneDeg: 50, periodS: 12, phase: (k / 16) * 2 * Math.PI, loudness: 0.6, cooldownS: 2 } as const;
        const run = worldRun({
          hazards: [light], tuning: withTuning({ hyde: { emergeAfterS: 0 } }, WORLD_TUNING),
          layout: { clueSites: { falsified_transfer: 's_ft_b', access_ledger: 's_al_a', botanical_residue: 's_br' }, eggSiteId: 'e_a' },
        });
        run.step();
        run.hydeBrain.stun(run, 60); // emerged (beams matter) but harmless
        run.cluesFound.push('access_ledger', 'botanical_residue'); // the last clue is east, across the beam
        place(run, -14, 9, WEST);
        const bot = new Bot(run, { profile: 'stealthy', startDelayMaxS: 0, avoidHazards: avoid, crouchNearHydeM: 0, crouchAtSuspicion: 2 }, 'beam');
        drive(run, bot, 40, () => run.cluesFound.length === 3);
        expect(run.cluesFound).toHaveLength(3);
        hits += run.log.filter((e) => e.type === 'hazard_triggered' && e.hazardId === 'hz_sweep').length;
        time += run.t;
      }
      return { hits, time };
    };
    const blind = play(false);
    const careful = play(true);
    console.log('searchlight hits blind / careful', JSON.stringify({ blind, careful }));
    expect(careful.hits).toBeLessThan(blind.hits);
    expect(careful.time - blind.time).toBeLessThan(16 * 2); // < 2 s per crossing on average
  });
});
