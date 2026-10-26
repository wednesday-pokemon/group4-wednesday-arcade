// Joseph Crackstone analytics (enemy contract): the RULE-BASED risk (monotonic sanity, sighting conditioning, the scan
// rule), the live messages and their rate limits, Crackstone-aware prescriptive feasibility, descriptive counts vs raw
// events on real bot episodes, rule-verified diagnostic causes, telemetry (crackstone_risk forecasts accepted by the
// server parser) and the heartbeat fields.
import { describe, expect, it } from 'vitest';
import { parseMysteryAppend } from '../../../supabase/functions/_shared/mystery-validation.ts';
import { crackstoneTargetable } from '../../../src/mystery/abilities.ts';
import { Bot } from '../../../src/mystery/bot.ts';
import { encounterSpawnsFor } from '../../../src/mystery/director.ts';
import { CASES } from '../../../src/mystery/data/cases.ts';
import { FIXED_SOLUTIONS as CASE_SOLUTIONS } from '../mystery/fixedSolutions.ts';
import { MysteryRun } from '../../../src/mystery/run.ts';
import { CASE_IDS, type CaseId, type Duo, type StampedEvent } from '../../../src/mystery/types.ts';
import { pathLength } from '../../../src/mystery/nav.ts';
import { stanceSpeed } from '../../../src/mystery/player.ts';
import { CRACK_HORIZON_S, CrackstoneTracker, type CrackSample, type CrackstoneRiskModel } from '../../../src/mystery/analytics/crackstoneRisk.ts';
import { crackstoneRiskFor, type CrackFrameFacts } from '../../../src/mystery/analytics/crackstoneLive.ts';
import { aggregateSessions, crackstoneReport, describeSession } from '../../../src/mystery/analytics/descriptive.ts';
import { diagnoseCauses } from '../../../src/mystery/analytics/diagnostic.ts';
import { CRACK_P5_GAP_S, ENEMY_ALERTS_PER_MINUTE, EventRules, MessageGate, P, TITLES, type MessageCandidate } from '../../../src/mystery/analytics/liveMessages.ts';
import { PrescriptiveService } from '../../../src/mystery/analytics/prescriptive.ts';
import { createMysteryAnalytics } from '../../../src/mystery/analytics/index.ts';
import { thingItemText } from '../../../src/mystery/analytics/thingCodes.ts';
import { heartbeatFrom } from '../../../src/app/mystery/liveRun.ts';
import { parseHeartbeat } from '../../../src/lib/supabase/mysteryWire.ts';
import { episode, recordOf, stamp } from './helpers.ts';

const DUO: Duo = { characterId: 'wednesday', pokemonId: 'gengar' };
const FAR = { x: 9999, z: 9999 };

function freshRun(caseId: CaseId, seed = 'crack-unit', duo: Duo = DUO): MysteryRun {
  return new MysteryRun({ duo, seed, tutorial: false, caseDef: CASES[caseId] });
}

/** A run with Crackstone ON the map (final: the encounter director brings him in at firstSpawnS; tests spawn him now). */
function activeRun(caseId: CaseId, seed = 'crack-unit', duo: Duo = DUO): MysteryRun {
  const run = freshRun(caseId, seed, duo);
  if (run.crackstoneBrain && !run.crackstoneBrain.active) {
    const spawn = encounterSpawnsFor(run.map.world!, 'crackstone')[0];
    if (spawn) run.director.spawnAt(run, 'crackstone', spawn);
  }
  return run;
}

function base(model: CrackstoneRiskModel, t: number, over: Partial<CrackSample> = {}): CrackSample {
  return {
    t, active: true, mode: 'PATROL', pose: null, canSeePlayer: false, player: { x: FAR.x, z: FAR.z, crouched: false, hidden: false },
    hydeChasing: false, perceptionOffS: 0, scanWarning: null, ...over,
  };
  void model;
}

function tv(pi: Float64Array): number {
  const K = pi.length;
  let s = 0;
  for (let k = 0; k < K; k++) s += Math.abs(pi[k] - 1 / K);
  return s / 2;
}

describe('Crackstone risk — rule-based tables and belief', () => {
  it('monotonic sanity per case: cells hidden from his whole loop ≈ 0, cells on his loop high', () => {
    for (const caseId of CASE_IDS) {
      const run = freshRun(caseId);
      const m = crackstoneRiskFor(run)!;
      expect(m.K).toBeGreaterThan(40);
      expect(m.C).toBeGreaterThan(20);
      const tr = new CrackstoneTracker(m, 0);
      tr.sample(base(m, 1));
      const f = tr.forecast(base(m, 1));
      expect(f.basis).toBe('patrol');
      // never seen and never scanned from any phase → 0 (static and live)
      const hidden: number[] = [];
      for (let c = 0; c < m.C; c++) {
        let any = false;
        for (let k = 0; k < m.K && !any; k++) any = m.vis[k * m.C + c] === 1 || m.scan[k * m.C + c] === 1;
        if (!any) hidden.push(c);
      }
      expect(hidden.length, `${caseId}: some leash cells are behind walls from his whole loop`).toBeGreaterThan(0);
      for (const c of hidden) {
        expect(m.staticP[c]).toBe(0);
        expect(f.cells[c]).toBeLessThan(1e-9);
      }
      // the cells of his waypoints: he walks through them, so a player standing there is very likely seen within 10 s
      const loopCells = [...new Set(m.def.patrol.map((w) => m.cellAt(w.x, w.z)).filter((c) => c >= 0))];
      expect(loopCells.length).toBeGreaterThan(2);
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
      const loopMean = mean(loopCells.map((c) => f.cells[c]));
      // uniform phase prior: a waypoint cell is seen within 10 s from a large share of his loop (relative to the disc)
      expect(loopMean, caseId).toBeGreaterThan(0.3);
      expect(loopMean, caseId).toBeGreaterThan(mean([...f.cells]) + 0.1);
      // seen just before he arrives at a waypoint: that waypoint's cell is (nearly) certain within 10 s
      const wi = 1;
      const kArr = m.arrival[wi];
      const kBefore = (kArr - 6 + m.K) % m.K;
      const sb = m.states[kBefore];
      const tc = new CrackstoneTracker(m, 0);
      tc.sample(base(m, 1, { pose: { x: sb.x, z: sb.z, yaw: sb.yaw } }));
      const wc = m.cellAt(m.def.patrol[wi].x, m.def.patrol[wi].z);
      expect(tc.forecast(base(m, 1)).cells[wc], caseId).toBeGreaterThan(0.9);
      for (const p of f.cells) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    }
  });

  it('a public sighting collapses the phase, advances at his pace and relaxes to uniform over ~a loop', () => {
    const run = freshRun('poisoned_archive');
    const m = crackstoneRiskFor(run)!;
    const tr = new CrackstoneTracker(m, 0);
    const k0 = m.states.findIndex((s, i) => i > 4 && s.sweep === 0);
    const s0 = m.states[k0];
    tr.sample(base(m, 1, { pose: { x: s0.x, z: s0.z, yaw: s0.yaw } }));
    let near = 0;
    for (let d = -5; d <= 5; d++) near += tr.pi[(k0 + d + m.K) % m.K];
    expect(near).toBeGreaterThan(0.8);
    const f = tr.forecast(base(m, 1));
    // cells the windows of k0 − 3 … k0 + 3 all see → high; cells none of them sees → below the static route (no scan due)
    let hi = 0;
    let lo = 0;
    const around = (c: number) => [-3, -2, -1, 0, 1, 2, 3].map((d) => m.win[((k0 + d + m.K) % m.K) * m.C + c]);
    for (let c = 0; c < m.C; c++) {
      const w = around(c);
      if (w.every((x) => x === 1)) {
        expect(f.cells[c]).toBeGreaterThan(0.6);
        hi++;
      } else if (w.every((x) => x === 0) && m.staticP[c] > 0.3) {
        expect(f.cells[c]).toBeLessThan(m.staticP[c]);
        lo++;
      }
    }
    expect(hi).toBeGreaterThan(0);
    expect(lo).toBeGreaterThan(0);
    // 5 s later (no observation, player far away): the mode moved ≈ 10 states (0.5 s each)
    for (let t = 2; t <= 6; t++) tr.sample(base(m, t));
    let arg = 0;
    for (let k = 1; k < m.K; k++) if (tr.pi[k] > tr.pi[arg]) arg = k;
    const moved = (arg - k0 + m.K) % m.K;
    expect(Math.abs(moved - 10)).toBeLessThanOrEqual(3);
    // ~3 loops later the belief is close to the uniform prior again
    const T = Math.ceil(m.periodS * 3);
    for (let t = 7; t <= 6 + T; t++) tr.sample(base(m, t));
    expect(tv(tr.pi)).toBeLessThan(0.1);
  });

  it('negative evidence: phases the player would see (LOS ≤ playerSeesCrackstoneM) lose mass while he is not seen', () => {
    const run = freshRun('midnight_signal');
    const m = crackstoneRiskFor(run)!;
    const tr = new CrackstoneTracker(m, 0);
    const k1 = Math.floor(m.K / 3);
    const st = m.states[k1];
    tr.sample(base(m, 1, { player: { x: st.x + 0.5, z: st.z, crouched: false, hidden: false } }));
    expect(tr.pi[k1]).toBeLessThan(1 / m.K);
  });

  it('scan rule: a pending pulse hits a crouched player in its ring with line of sight, never a hidden one', () => {
    for (const caseId of CASE_IDS) {
      const run = freshRun(caseId);
      const m = crackstoneRiskFor(run)!;
      // a standing phase + a point 5 m behind him with line of sight (out of his cone)
      let found = false;
      for (let k = 0; k < m.K && !found; k++) {
        const s = m.states[k];
        if (s.sweep > 0) continue;
        const bx = s.x + Math.sin(s.yaw) * 5;
        const bz = s.z + Math.cos(s.yaw) * 5;
        if (!run.playerNav().walkable(bx, bz) || !run.world.lineOfSight(s.x, s.z, bx, bz, false)) continue;
        found = true;
        const tr = new CrackstoneTracker(m, 0);
        tr.sample(base(m, 30, { pose: { x: s.x, z: s.z, yaw: s.yaw } }));
        const crouched = { x: bx, z: bz, crouched: true, hidden: false };
        const withScan = tr.forecast(base(m, 30, { player: crouched, scanWarning: { pulseAt: 31.5 } }));
        expect(withScan.here, `${caseId}: crouching does not help against a scan`).toBeGreaterThan(0.9);
        expect(m.scanCovers(s, m.targetAt(bx, bz, true, false))).toBe(true);
        expect(m.scanCovers(s, m.targetAt(bx, bz, false, true))).toBe(false); // hidden
      }
      expect(found, caseId).toBe(true);
    }
  });

  it('known modes: hunting → p = 1 (fact), a search disc around where he last saw the player, perception off while stunned', () => {
    const run = freshRun('crypt_last_witness');
    const m = crackstoneRiskFor(run)!;
    const tr = new CrackstoneTracker(m, 0);
    const w = m.def.patrol[2];
    const pl = { x: w.x + 2, z: w.z, crouched: false, hidden: false };
    const hunting = tr.forecast(base(m, 5, { mode: 'CHASE', pose: { x: w.x, z: w.z, yaw: 0 }, player: pl, canSeePlayer: true }));
    expect(hunting.basis).toBe('chase');
    expect(hunting.here).toBe(1);
    tr.notePublic(null, true, pl);
    tr.onMode(6, 'CHASE', 'SEARCH', 'lost_sight', { player: pl, lurePoint: null });
    const search = tr.forecast(base(m, 6, { mode: 'SEARCH', player: pl }));
    expect(search.basis).toBe('search');
    const c = m.cellAt(pl.x, pl.z);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(search.cells[c]).toBeGreaterThan(0.3);
    const stunned = tr.forecast(base(m, 6, { mode: 'SEARCH', player: pl, perceptionOffS: CRACK_HORIZON_S }));
    expect(Math.max(...stunned.cells)).toBe(0);
    expect(stunned.here).toBe(0);
  });
});

// ----------------------------------------------------------------------------------------------------- messages

const CTX = { abilityLabel: () => 'Your power', hazards: [], mentions: () => 0, clueTotal: 3 };
const FACTS: CrackFrameFacts = {
  player: { x: 0, z: 0 }, hidden: false, inLeash: true, lastPose: { x: 5, z: 0 }, wallBetween: false, distanceToLastPoseM: 5, nowDistanceM: 9,
  sightRangeM: 14, proximityM: 2.5, lastCurse: null, insideLastCurse: null, lastScanExposure: null, areaName: 'Archive Stacks',
};

function onEvents(rules: EventRules, items: [number, Parameters<typeof stamp>[0][number][1]][], facts: Partial<CrackFrameFacts> = {}): MessageCandidate[] {
  return stamp(items).flatMap((e) => rules.onEvent(e, facts.hidden ?? false, { ...FACTS, ...facts }));
}

describe('Crackstone live messages (UX_ENEMIES §6)', () => {
  it('chase start is a P5 CRACKSTONE rule cause with the stance (UX_FINAL §8 copy); deferred and warnings say nothing', () => {
    const r = new EventRules(CTX, 'walk');
    const seen = onEvents(r, [[1, { type: 'crackstone_sighted', via: 'sight', distanceM: 12 }], [2, { type: 'crackstone_mode', from: 'PATROL', to: 'CHASE', reason: 'saw_player' }]]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ code: 'crack_seen', title: TITLES.crackstone, priority: P.alert, basis: 'rule' });
    expect(seen[0].text).toBe('Crackstone spotted you.');
    expect(seen[0].text.length).toBeLessThanOrEqual(48);
    const rc = new EventRules(CTX, 'crouch');
    expect(onEvents(rc, [[2, { type: 'crackstone_mode', from: 'PATROL', to: 'CHASE', reason: 'saw_player' }]])[0].text).toBe('Crackstone spotted you, even crouched.');
    expect(onEvents(new EventRules(CTX), [[2, { type: 'crackstone_mode', from: 'PATROL', to: 'CHASE', reason: 'sensed_player' }]])[0].code).toBe('crack_sensed');
    expect(onEvents(new EventRules(CTX, 'crouch'), [[2, { type: 'crackstone_mode', from: 'SEARCH', to: 'CHASE', reason: 'scan_hit' }]])[0].text).toMatch(/crouching does not hide you/);
    // a CHASE after a missed curse continues the same encounter; deferred / scan + curse warnings: nothing
    const q = new EventRules(CTX);
    expect(onEvents(q, [
      [3, { type: 'crackstone_mode', from: 'ATTACK', to: 'CHASE', reason: 'curse_missed' }],
      [4, { type: 'crackstone_mode', from: 'CHASE', to: 'SEARCH', reason: 'deferred' }],
      [5, { type: 'crackstone_scan', phase: 'warning', radiusM: 10, hit: false }],
      [6, { type: 'curse', phase: 'cast', hpLost: 0, blocked: false }],
    ])).toEqual([]);
    expect(q.crackChases).toBe(0);
    expect(q.crackEscapes).toBe(0);
  });

  it('curse and escape WHY from the public facts of that frame; escape LOG counts', () => {
    const r = new EventRules(CTX);
    const ring = { x: 0, z: 0, radiusM: 1.8, landsAt: 10 };
    expect(onEvents(r, [[10, { type: 'curse', phase: 'hit', hpLost: 15, blocked: false }]])[0]).toMatchObject({ code: 'crack_curse_hit', priority: P.alert });
    expect(onEvents(r, [[11, { type: 'curse', phase: 'hit', hpLost: 0, blocked: true }]])[0]).toMatchObject({ code: 'crack_curse_blocked', priority: P.why });
    expect(onEvents(r, [[10, { type: 'curse', phase: 'miss', hpLost: 0, blocked: false }]], { lastCurse: ring, insideLastCurse: false })[0].code).toBe('crack_curse_dodged');
    expect(onEvents(r, [[9, { type: 'curse', phase: 'miss', hpLost: 0, blocked: false }]], { lastCurse: ring, insideLastCurse: true })).toEqual([]); // cancelled
    const wall = onEvents(r, [[20, { type: 'crackstone_mode', from: 'CHASE', to: 'SEARCH', reason: 'lost_sight' }]], { wallBetween: true });
    expect(wall.map((c) => c.code)).toEqual(['crack_escape', 'crack_escape_wall']);
    expect(wall[0].text).toBe('Crackstone lost you. Escapes: 1.');
    expect(onEvents(r, [[30, { type: 'crackstone_mode', from: 'CHASE', to: 'SEARCH', reason: 'lost_sight' }]], { hidden: true }).map((c) => c.code)).toContain('crack_escape_hid');
    expect(onEvents(r, [[40, { type: 'crackstone_mode', from: 'CHASE', to: 'SEARCH', reason: 'leash' }]]).map((c) => c.code)).toContain('crack_escape_leash');
    expect(onEvents(r, [[50, { type: 'crackstone_mode', from: 'ATTACK', to: 'RETURN', reason: 'curse_done' }]])).toEqual([]);
    expect(r.crackEscapes).toBe(3);
    expect(onEvents(r, [[60, { type: 'crackstone_scan', phase: 'pulse', radiusM: 10, hit: false }]], { lastScanExposure: 'covered' })[0].code).toBe('crack_scan_covered');
    expect(onEvents(r, [[90, { type: 'crackstone_scan', phase: 'pulse', radiusM: 10, hit: false }]], { lastScanExposure: 'covered' })).toEqual([]); // once
    for (const code of ['crack_seen', 'crack_curse_hit', 'crack_escape_wall', 'crack_power_stun']) {
      const t = thingItemText({ kind: 'diagnostic', code, ref: null });
      expect(t.head).toBe(code.startsWith('crack_power') ? TITLES.power : TITLES.crackstone);
      expect(t.text).not.toBe('Thing explained an event.');
    }
  });

  it('rate limits: CRACKSTONE P5 ≤ 1 per 20 s, never pre-empts a HYDE ALERT, enemy alerts ≤ 4 per minute', () => {
    const cand = (code: string, title: string, t: number, priority: number = P.alert): MessageCandidate => ({ kind: 'diagnostic', code, title, text: code, basis: 'rule', priority, t });
    const g = new MessageGate();
    g.offer(cand('crack_seen', TITLES.crackstone, 0));
    expect(g.release(0, true).map((x) => x.code)).toEqual(['crack_seen']);
    g.offer(cand('crack_curse_hit', TITLES.crackstone, 5));
    expect(g.release(5, true)).toEqual([]); // < 20 s after the last Crackstone P5
    g.offer(cand('crack_curse_hit', TITLES.crackstone, CRACK_P5_GAP_S + 1));
    expect(g.release(CRACK_P5_GAP_S + 1, true).map((x) => x.code)).toEqual(['crack_curse_hit']);
    // equal priority: the Hyde alert goes first, the Crackstone one waits behind it
    const h = new MessageGate();
    h.offer(cand('seen', TITLES.hyde, 100));
    h.offer(cand('crack_seen', TITLES.crackstone, 100));
    expect(h.release(100, true).map((x) => x.code)).toEqual(['seen']);
    expect(h.release(100.1, true).map((x) => x.code)).toEqual(['crack_seen']);
    const h2 = new MessageGate();
    h2.offer(cand('crack_sensed', TITLES.crackstone, 200));
    h2.offer(cand('caught_1', TITLES.hyde, 200));
    expect(h2.release(200, true).map((x) => x.code)).toEqual(['caught_1']);
    expect(h2.release(200.2, true).map((x) => x.code)).toEqual(['crack_sensed']);
    // Hyde + Crackstone alerts ≤ 4 per minute (all priorities)
    const m = new MessageGate();
    let shown = 0;
    const codes = ['seen', 'caught_1', 'crack_seen', 'caught_2', 'hidden_escape', 'crack_escape_wall'];
    codes.forEach((code, i) => {
      const t = 300 + i * 9;
      m.offer(cand(code, code.startsWith('crack') ? TITLES.crackstone : TITLES.hyde, t, code.startsWith('caught') || code === 'seen' ? P.alert : P.why));
      shown += m.release(t, false).length;
    });
    expect(shown).toBe(ENEMY_ALERTS_PER_MINUTE);
  });
});

// ----------------------------------------------------------------------------------------------------- prescriptive

const svc = new PrescriptiveService();

/** Puts Crackstone at a patrol phase and the player `back` m behind him with line of sight (out of his cone). */
function stageBehind(run: MysteryRun, back: number): boolean {
  const m = crackstoneRiskFor(run)!;
  for (const s of m.states) {
    if (s.sweep > 0) continue;
    const bx = s.x + Math.sin(s.yaw) * back;
    const bz = s.z + Math.cos(s.yaw) * back;
    if (!run.playerNav().walkable(bx, bz) || !run.world.lineOfSight(s.x, s.z, bx, bz, false)) continue;
    const c = run.crackstone!;
    Object.assign(c, { x: s.x, z: s.z, yaw: s.yaw, mode: 'PATROL', canSeePlayer: false });
    Object.assign(run.player, { x: bx, z: bz, yaw: s.yaw, crouched: false, hidden: false, stance: 'idle' });
    (run as unknown as { updateSighting(): void }).updateSighting();
    return run.crackstoneVisible();
  }
  return false;
}

describe('Crackstone-aware advice is feasible', () => {
  it('scan warning while exposed → the nearest covered point reachable before the pulse (never "crouch")', () => {
    let staged = 0;
    for (const caseId of CASE_IDS) {
      const run = activeRun(caseId, `scan-${caseId}`);
      if (!stageBehind(run, 6)) continue;
      const c = run.crackstone!;
      c.scan = { phase: 'warning', startedAt: run.t, pulseAt: run.t + 2.2, radiusM: run.crackstoneBrain!.cfg.scanRadiusM };
      expect(run.scanExposure()).toBe('exposed');
      staged++;
      const opts = svc.candidates(run);
      expect(opts.some((o) => o.enemy === 'crackstone' && o.action === 'crouch')).toBe(false);
      const cover = opts.find((o) => o.action === 'take_cover');
      const ability = opts.find((o) => o.enemy === 'crackstone' && o.ability);
      expect(cover || ability, caseId).toBeTruthy();
      if (cover) {
        const t = cover.target!;
        const out = Math.hypot(t.x - c.x, t.z - c.z) > c.scan.radiusM;
        const wall = !run.world.lineOfSight(c.x, c.z, t.x, t.z, false);
        const spot = run.map.hidingSpots.some((h) => Math.hypot(h.x - t.x, h.z - t.z) <= h.radius);
        expect(out || wall || spot).toBe(true);
        expect(pathLength(run.player, run.playerNav().findPath(run.player, t)!)).toBeLessThanOrEqual(stanceSpeed(run, 'sprint') * 2.2);
        expect(svc.recommend(run)!.score).toBeGreaterThanOrEqual(90);
        expect(cover.text).not.toMatch(/^Crouch/);
      }
    }
    expect(staged).toBeGreaterThanOrEqual(2);
  });

  it('curse circle while exposed → step out of the ring before it lands (or the duo block); he sees you → break his line of sight', () => {
    let staged = 0;
    for (const caseId of CASE_IDS) {
      for (const duo of [DUO, { characterId: 'bianca', pokemonId: 'aegislash' } as Duo]) {
        const run = activeRun(caseId, `curse-${caseId}`, duo);
        if (!stageBehind(run, 5)) continue;
        staged++;
        const c = run.crackstone!;
        const cfg = run.crackstoneBrain!.cfg;
        c.mode = 'ATTACK';
        c.curse = { x: run.player.x, z: run.player.z, radiusM: cfg.curseRadiusM, startedAt: run.t, landsAt: run.t + cfg.curseWindupS };
        expect(run.curseExposure()).toBe('exposed');
        const opts = svc.candidates(run);
        const leave = opts.find((o) => o.action === 'leave_curse');
        expect(leave, caseId).toBeTruthy();
        const t = leave!.target!;
        expect(Math.hypot(t.x - c.curse.x, t.z - c.curse.z)).toBeGreaterThan(c.curse.radiusM);
        expect(pathLength(run.player, run.playerNav().findPath(run.player, t)!)).toBeLessThanOrEqual(stanceSpeed(run, 'sprint') * cfg.curseWindupS);
        expect(svc.recommend(run)!.action).toBe('leave_curse');
        for (const o of opts) if (o.ability && o.enemy === 'crackstone') {
          const def = o.ability.key === 'F' ? run.power.def : run.move.def;
          const kinds = def.effects.map((e) => e.kind);
          if (kinds.some((k) => k === 'stun' || k === 'distract' || k === 'slow')) expect(def.effects.some((e) => crackstoneTargetable(run, run.crackstoneBrain!, e).ok)).toBe(true);
        }
        // he hunts you (no curse now): break his line of sight behind walls / high cover, never toward him
        c.mode = 'CHASE';
        c.curse = null;
        const chase = svc.candidates(run);
        const bs = chase.find((o) => o.action === 'break_sight');
        if (bs) {
          expect(run.world.lineOfSight(c.x, c.z, bs.target!.x, bs.target!.z, false)).toBe(false);
          expect(run.playerNav().reachable(run.player, bs.target!, 1)).toBe(true);
        }
        expect(chase.some((o) => o.enemy === 'crackstone')).toBe(true);
      }
    }
    expect(staged).toBeGreaterThanOrEqual(2);
  });

  it('property over live bot episodes (with the live forecast): every Crackstone option is feasible', () => {
    const seen = new Set<string>();
    for (const [i, caseId] of CASE_IDS.entries()) {
      for (const k of [0, 1]) {
        const run = freshRun(caseId, `crack-prop-${i}-${k}`, k ? { characterId: 'gomez', pokemonId: 'froslass' } : DUO);
        const a = createMysteryAnalytics(run);
        const bot = new Bot(run, { profile: 'careless', sprintProb: 0.5, useAbilities: true, startDelayMaxS: 0 }, `crack-prop-${i}-${k}`);
        let next = 0;
        while (run.status === 'playing' && run.t < 240) {
          a.frame(run, run.update(1 / 30, bot.decide()));
          if (run.t < next) continue;
          next = run.t + 1;
          const f = a.live().forecasts.crackstone ?? null;
          for (const o of svc.candidates(run, a.engine.zones(), f)) {
            if (o.enemy !== 'crackstone') continue;
            seen.add(o.action);
            const c = run.crackstone!;
            const tg = o.target;
            if (o.action === 'leave_curse') {
              expect(run.curseExposure()).toBe('exposed');
              expect(Math.hypot(tg!.x - c.curse!.x, tg!.z - c.curse!.z)).toBeGreaterThan(c.curse!.radiusM);
            }
            if (o.action === 'take_cover') expect(run.scanExposure()).toBe('exposed');
            if (o.action === 'break_sight') expect(run.world.lineOfSight(c.x, c.z, tg!.x, tg!.z, false)).toBe(false);
            if (o.action === 'avoid_area') expect(run.playerNav().reachable(run.player, tg!, 2)).toBe(true);
            if (o.ability) {
              const def = o.ability.key === 'F' ? run.power.def : run.move.def;
              expect((o.ability.key === 'F' ? run.powerStatus() : run.moveStatus()).ready).toBe(true);
              expect(o.ability.id).toBe(def.id);
            }
            expect(o.text.length).toBeLessThanOrEqual(52);
            expect(o.reason.length).toBeLessThanOrEqual(48);
          }
        }
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  }, 180_000);
});

// ----------------------------------------------------------------------------------------------------- descriptive / diagnostic

describe('Crackstone descriptive counts and rule causes', () => {
  it('SessionReport.crackstone matches the raw events on real bot episodes of every case; KPI fields aggregate', () => {
    const records = [];
    let encounters = 0;
    for (const [i, caseId] of CASE_IDS.entries()) {
      for (let k = 0; k < 3; k++) {
        const ep = episode({ characterId: 'enid', pokemonId: 'dragapult' }, `crack-desc-${i}-${k}`, { profile: 'careless', sprintProb: 0.5, useAbilities: true }, undefined, caseId);
        const ev = ep.collector.events;
        const rep = describeSession({ duo: ep.duo, events: ev, result: ep.result, caseId });
        const cr = rep.crackstone;
        expect(cr.present).toBe(true);
        const modes = ev.filter((e): e is Extract<StampedEvent, { type: 'crackstone_mode' }> => e.type === 'crackstone_mode');
        const onsets = modes.filter((e) => e.to === 'CHASE' && e.from !== 'ATTACK' && ['saw_player', 'sensed_player', 'scan_hit'].includes(e.reason));
        expect(cr.encounters).toBe(onsets.length);
        expect(cr.encounters).toBe(ep.run.crackstoneBrain!.stats.chases - modes.filter((e) => e.to === 'CHASE' && e.from !== 'ATTACK' && !['saw_player', 'sensed_player', 'scan_hit'].includes(e.reason)).length);
        const sighted = ev.filter((e) => e.type === 'crackstone_sighted');
        expect(cr.detections.sight + cr.detections.proximity + cr.detections.scan).toBe(sighted.length);
        expect(cr.scans.warned).toBe(ev.filter((e) => e.type === 'crackstone_scan' && e.phase === 'warning').length);
        expect(cr.scans.hit + cr.scans.passed).toBe(ep.run.crackstoneBrain!.stats.scans);
        expect(cr.scans.hit).toBe(ep.run.crackstoneBrain!.stats.scanHits);
        expect(cr.curses.cast).toBe(ep.run.crackstoneBrain!.stats.curses);
        expect(cr.curses.hit).toBe(ev.filter((e) => e.type === 'curse' && e.phase === 'hit').length);
        expect(cr.curses.dodged).toBe(ev.filter((e) => e.type === 'curse' && e.phase === 'miss').length);
        expect(cr.deferrals).toBe(ep.run.crackstoneBrain!.stats.deferrals);
        expect(cr.escapes).toBe(modes.filter((e) => (e.from === 'CHASE' || e.from === 'ATTACK') && e.to !== 'CHASE' && e.to !== 'ATTACK' && e.reason !== 'deferred' && e.reason !== 'curse_done').length);
        expect(crackstoneReport(ev)).toEqual({ ...cr, present: cr.present });
        encounters += cr.encounters;
        records.push(recordOf(ep));
      }
    }
    expect(encounters).toBeGreaterThan(0);
    const agg = aggregateSessions(records);
    expect(agg.crackstone.runs).toBe(9);
    expect(agg.cursesCast).toBe(agg.crackstone.curses.cast);
    expect(agg.cursesHit).toBe(agg.crackstone.curses.hit);
    expect(agg.cursesDodgedPct === null ? agg.cursesCast === 0 : Math.abs(agg.cursesDodgedPct - (100 * agg.cursesDodged) / agg.cursesCast) < 1e-9).toBe(true);
    expect(agg.cursesSmallSample).toBe(agg.cursesCast < 10);
    const empty = aggregateSessions([]);
    expect(empty.cursesDodgedPct).toBeNull();
    expect(empty.cursesSmallSample).toBe(true);
  }, 120_000);

  it('rule-verified causes: saw you (distance, stance), sensed, scan hit (crouching does not help), curse landed, leash', () => {
    const ev = stamp([
      [1, { type: 'stance', stance: 'crouch' }],
      [2, { type: 'crackstone_sighted', via: 'sight', distanceM: 7.6 }],
      [3, { type: 'crackstone_mode', from: 'PATROL', to: 'CHASE', reason: 'saw_player' }],
      [4, { type: 'curse', phase: 'cast', hpLost: 0, blocked: false }],
      [5.4, { type: 'curse', phase: 'hit', hpLost: 15, blocked: false }],
      [5.4, { type: 'crackstone_mode', from: 'ATTACK', to: 'RETURN', reason: 'curse_done' }],
      [40, { type: 'crackstone_scan', phase: 'pulse', radiusM: 10, hit: true }],
      [40, { type: 'crackstone_sighted', via: 'scan', distanceM: 8 }],
      [40, { type: 'crackstone_mode', from: 'PATROL', to: 'CHASE', reason: 'scan_hit' }],
      [48, { type: 'crackstone_mode', from: 'CHASE', to: 'SEARCH', reason: 'leash' }],
      [70, { type: 'crackstone_sighted', via: 'proximity', distanceM: 2.1 }],
      [70, { type: 'crackstone_mode', from: 'PATROL', to: 'CHASE', reason: 'sensed_player' }],
    ]);
    const causes = diagnoseCauses(ev);
    const by = (code: string) => causes.find((c) => c.code === code)!;
    expect(by('crack_seen').text).toMatch(/8 m away even crouched/);
    expect(by('crack_seen').evidenceSeq).toEqual([2, 3]);
    expect(by('crack_curse_hit').text).toMatch(/stayed in the ring/);
    expect(by('crack_curse_hit').evidenceSeq).toEqual([4, 5]);
    expect(by('crack_scan_hit').text).toMatch(/crouching does not stop a scan/);
    expect(by('crack_scan_hit').evidenceSeq).toEqual([7, 8, 9]);
    expect(by('crack_leash').text).toMatch(/cursed area/);
    expect(by('crack_sensed').text).toMatch(/2 m/);
    // no cause without the explicit transition
    expect(diagnoseCauses(stamp([[1, { type: 'crackstone_sighted', via: 'sight', distanceM: 5 }]]))).toEqual([]);
  });
});

// ----------------------------------------------------------------------------------------------------- telemetry / heartbeat

describe('Crackstone telemetry and heartbeat', () => {
  it('crackstone_risk forecasts (rule_based, 0–1, flat features) pass the server parser; the heartbeat carries mode / chase, never a position', () => {
    const run = freshRun('poisoned_archive', 'crack-tele');
    const a = createMysteryAnalytics(run, { sessionId: '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b', stationId: 'station_a' });
    const bot = new Bot(run, { profile: 'careless', sprintProb: 0.5, useAbilities: true, startDelayMaxS: 0 }, 'crack-tele');
    let hb = a.heartbeat();
    let sawMode = false;
    while (run.status === 'playing' && run.t < 200) {
      a.frame(run, run.update(1 / 30, bot.decide()));
      if (Math.round(run.t * 30) % 60 === 0) {
        hb = a.heartbeat();
        expect(hb.crackstonePresent).toBe(true);
        if (hb.crackstoneMode) sawMode = true;
        expect(hb.crackstoneChase).toBe(hb.crackstoneMode === 'CHASE' || hb.crackstoneMode === 'ATTACK');
      }
    }
    if (run.status === 'accusing') a.frame(run, run.accuse(bot.accusation(), CASE_SOLUTIONS[run.caseDef.id]));
    expect(sawMode).toBe(true);
    const fc = a.collector.forecasts.filter((f) => f.target === 'crackstone_risk');
    expect(fc.length).toBeGreaterThan(5);
    for (const f of fc) {
      expect(f.modelLabel).toBe('rule_based');
      expect(f.value).toBeGreaterThanOrEqual(0);
      expect(f.value).toBeLessThanOrEqual(1);
      expect(Object.keys(f.features).some((k) => /^(x|z|crack.*[xz])$/i.test(k))).toBe(false);
    }
    for (let b = a.pendingBatch(200); b; b = a.pendingBatch(200)) {
      const body = parseMysteryAppend({ sessionId: '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b', events: b.events, forecasts: b.forecasts, recommendations: b.recommendations });
      expect(body.forecasts.length).toBe(b.forecasts.length);
      a.ackBatch(b);
    }
    const status = { stationId: 'station_a', phase: 'investigating' as const, nickname: 'x', duo: DUO, clues: 0, egg: null, hp: 100, catches: 0, hydeMode: null, risk: null, advice: null, activeTimeS: 1, updatedAt: 0 };
    const wire = heartbeatFrom('station_a', status, 'live', { ...hb, crackstoneMode: 'CHASE', crackstoneChase: true, crackstoneChases: 2, crackstoneRisk: 0.42 });
    const parsed = parseHeartbeat(JSON.parse(JSON.stringify(wire)))!;
    expect(parsed).toMatchObject({ crackstonePresent: true, crackstoneMode: 'CHASE', crackstoneChase: true, crackstoneChases: 2, crackstoneRisk: 0.42 });
    expect(JSON.stringify(parsed)).not.toMatch(/"(x|z|crackX|crackZ)":/);
    expect(parseHeartbeat({ ...JSON.parse(JSON.stringify(wire)), crackstoneMode: 'DANCING' })!.crackstoneMode).toBeNull();
  }, 120_000);
});

describe('Crackstone risk report (§7) quotes measured numbers', () => {
  it('the artifact records the rule-based method + held-out calibration and the report quotes exactly those numbers', async () => {
    const { readFileSync } = await import('node:fs');
    const { BUNDLED_MODEL } = await import('../../../src/mystery/analytics/model/index.ts');
    const art = BUNDLED_MODEL as unknown as { crackstoneRisk?: { method: string; label: string; modelVersion: string; metrics: { cells: { model: { n: number; brier: number }; staticRoute: { brier: number }; area: { brier: number }; constant: { brier: number } } | null; here: { model: { n: number; brier: number } } | null } } };
    const cr = art.crackstoneRisk!;
    expect(cr.method).toBe('rule_based');
    expect(cr.label).toBe('Rule-based estimate');
    const report = readFileSync('docs/MYSTERY_MODEL_REPORT.md', 'utf8');
    expect(report).toMatch(/## 7\. Joseph Crackstone risk — rule-based estimate \(not ML\)/);
    const cells = cr.metrics.cells!;
    expect(cells.model.n).toBeGreaterThan(100_000);
    expect(report).toContain(`| rule-based risk (live code) | ${cells.model.n} |`);
    expect(report).toContain(`| ${cells.model.brier.toFixed(4)} |`);
    expect(report).toContain(`| static patrol-route baseline | ${cells.model.n} |`);
    expect(report).toContain(`| constant | `);
    expect(report).toContain(cells.area.brier.toFixed(4));
    const here = cr.metrics.here!;
    expect(report).toContain(`| rule-based here.p | ${here.model.n} |`);
    expect(report).not.toMatch(/Crackstone[^\n]*ML estimate/);
  });
});
