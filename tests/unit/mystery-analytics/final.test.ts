// Final wave (FINAL_CONTRACT §4–§10, UX_FINAL §1c/§1d/§3/§4/§8): encounter odds of all three enemies (the director's
// exact spawn distribution, the Slurp wander filter + cells, the threat map), event-based WHY lines with the exact copy,
// Thing's free cabinet / Slurp advice (feasible), Principal Weems' paid hints (never a name), the live tally + score
// preview, the game-over WHY, the local leaderboard ranking and the heartbeat additions.
import { describe, expect, it } from 'vitest';
import { createMysteryAnalytics } from '../../../src/mystery/analytics/index.ts';
import {
  assembleThreatMap, buildSlurpModel, EnemyZoneTracker, slurpEncounterP, slurpLooks, slurpOccupancy, spawnOddsByArea, spawnOddsByZone,
  zoneFractionsWithin,
} from '../../../src/mystery/analytics/encounter.ts';
import { predictZones } from '../../../src/mystery/analytics/hydeZones.ts';
import { EventRules, MessageGate, P, TITLES, type MessageContext } from '../../../src/mystery/analytics/liveMessages.ts';
import { localDefeatLog, localRankOf, rankLocalRecords, type LocalRecordLike } from '../../../src/mystery/analytics/leaderboard.ts';
import { namesSuspect, weemsHint } from '../../../src/mystery/analytics/weems.ts';
import { scoreV4 } from '../../../src/mystery/scoring.ts';
import { CASES } from '../../../src/mystery/data/cases.ts';
import { Bot } from '../../../src/mystery/bot.ts';
import { IDLE_INPUT, MysteryRun } from '../../../src/mystery/run.ts';
import { CASE_IDS, type CaseId } from '../../../src/mystery/types.ts';
import type { EnemyThreatLayer } from '../../../src/mystery/analytics/types.ts';
import { parseHeartbeat } from '../../../src/lib/supabase/mysteryWire.ts';
import { heartbeatFrom } from '../../../src/app/mystery/liveRun.ts';
import { stamp } from './helpers.ts';

const DUO = { characterId: 'morticia', pokemonId: 'aegislash' } as const;

function play(caseId: CaseId, seed: string, maxT: number, onFrame?: (run: MysteryRun, a: ReturnType<typeof createMysteryAnalytics>) => void, profile: 'stealthy' | 'careless' = 'careless') {
  const run = new MysteryRun({ duo: { ...DUO }, seed, tutorial: false, caseDef: CASES[caseId] });
  const a = createMysteryAnalytics(run);
  const bot = new Bot(run, { profile }, seed);
  let n = 0;
  while (run.status === 'playing' && run.t < maxT) {
    a.frame(run, run.update(1 / 60, bot.decide()));
    if (++n % 15 === 0) onFrame?.(run, a);
  }
  return { run, a };
}

// ----------------------------------------------------------------------------------------------------- encounter math

describe('encounter math (pure)', () => {
  const zones = [
    { id: 'a', name: 'West', polygon: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }] },
    { id: 'b', name: 'East', polygon: [{ x: 10, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 10 }, { x: 10, z: 10 }] },
    { id: 'c', name: 'Far', polygon: [{ x: 20, z: 0 }, { x: 30, z: 0 }, { x: 30, z: 10 }, { x: 20, z: 10 }] },
  ];
  const wander = [{ x: 2, z: 5 }, { x: 18, z: 5 }, { x: 15, z: 2 }];

  it('Slurp occupancy is a distribution over the zones his legs cross; the reset chain keeps it stationary', () => {
    const occ = slurpOccupancy(zones, wander, 1.3, 2);
    expect(occ.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 9);
    expect(occ[2]).toBe(0); // no leg enters the far zone
    expect(occ[0]).toBeGreaterThan(0);
    const model = buildSlurpModel(zones, wander, 1.3, 2);
    const after = predictZones(model, occ, 30);
    after.forEach((p, i) => expect(p).toBeCloseTo(occ[i], 6));
    // from a one-hot start it relaxes toward the occupancy
    const far = predictZones(model, [0, 0, 1], 120);
    far.forEach((p, i) => expect(Math.abs(p - occ[i])).toBeLessThan(0.02));
  });

  it('the tracker starts from the remembered spawn odds, steps, and stops at a despawn', () => {
    const tr = new EnemyZoneTracker(buildSlurpModel(zones, wander, 1.3, 2));
    tr.noteSpawnOdds([0, 1, 0]);
    expect(tr.active).toBe(false);
    tr.spawn(10);
    expect(tr.probs()![1]).toBeGreaterThan(0.99);
    const seen = tr.step(11, { player: { x: 25, z: 5 }, mode: 'PATROL', visible: true, pos: { x: 5, z: 5 } });
    expect(seen[0]).toBeGreaterThan(0.99); // a public sighting collapses the belief
    tr.despawn();
    expect(tr.probs()).toBeNull();
  });

  it('cell risk is monotone in proximity and the "hidden" variant only counts his proximity sense', () => {
    const model = buildSlurpModel(zones, wander, 1.3, 2);
    const looks = slurpLooks(model, [1, 0, 0]);
    const near = (x: number) => zoneFractionsWithin(zones, { x, z: 5 }, 3);
    const far = (x: number) => zoneFractionsWithin(zones, { x, z: 5 }, 10);
    const pWest = slurpEncounterP(looks, near(5), far(5));
    const pFar = slurpEncounterP(looks, near(28), far(28));
    expect(pWest).toBeGreaterThan(pFar);
    expect(slurpEncounterP(looks, near(5), far(5), true)).toBeLessThan(pWest);
    expect(pWest).toBeLessThanOrEqual(1);
  });

  it('spawn odds by zone / by area sum to 1; the threat map max ignores inactive "may appear" layers', () => {
    const spawns = [
      { spawnId: 's1', name: 'One', zoneId: 'a', x: 2, z: 2, p: 0.5 },
      { spawnId: 's2', name: 'Two', zoneId: 'b', x: 12, z: 2, p: 0.3 },
      { spawnId: 's3', name: 'Three', zoneId: 'b', x: 14, z: 8, p: 0.2 },
    ];
    expect(spawnOddsByZone(zones, spawns)).toEqual([0.5, 0.5, 0]);
    const areas = spawnOddsByArea({ zones, areas: [{ id: 'ar', name: 'Garden', x: 13, z: 5, radiusM: 5 }] }, spawns);
    expect(areas.reduce((x, a) => x + a.p, 0)).toBeCloseTo(1, 9);
    expect(areas[0]).toMatchObject({ name: 'Garden', p: 0.5 });
    const layer = (enemy: 'hyde' | 'slurp', state: 'active' | 'inactive', p: number[]): EnemyThreatLayer => ({
      enemy, name: enemy, state, basis: state === 'active' ? 'zone_filter' : 'spawn_rules', label: 'x', meaning: state === 'active' ? 'location' : 'appear',
      zones: zones.map((z, i) => ({ zoneId: z.id, p: p[i] })), mode: null, appearsInS: null, here: null,
    });
    const map = assembleThreatMap(zones, [layer('hyde', 'active', [0.2, 0.7, 0.1]), layer('slurp', 'inactive', [0.9, 0.1, 0])], { x: 1, z: 1 });
    expect(map.zones.map((z) => z.max)).toEqual([0.2, 0.7, 0.1]);
    expect(map.zones[0].p).toEqual({ hyde: 0.2, slurp: 0.9 });
    expect(map.zones[1].top).toBe('hyde');
    expect(map.here).toEqual({ max: 0.2, top: 'hyde' });
  });
});

// ----------------------------------------------------------------------------------------------------- live: exact director odds

describe('live encounter odds (every case)', () => {
  it('inactive enemies show EXACTLY run.encounterDistribution; active ones are labelled; the threat map + Slurp risk stay well-formed', () => {
    for (const caseId of CASE_IDS) {
      let checkedInactive = 0;
      let checkedActive = 0;
      play(caseId, `enc-${caseId}`, 120, (run, a) => {
        const f = a.live().forecasts;
        const th = f.threat!;
        expect(th).toBeTruthy();
        expect(th.zones.length).toBe(run.map.world!.zones.length);
        for (const z of th.zones) {
          expect(z.max).toBeGreaterThanOrEqual(0);
          expect(z.max).toBeLessThanOrEqual(1);
        }
        for (const layer of Object.values(th.enemies)) {
          if (!layer) continue;
          const sum = layer.zones.reduce((x, z) => x + z.p, 0);
          if (layer.state === 'inactive') {
            expect(layer.label).toBe('Rule-based estimate · spawn rules');
            const exact = run.encounterDistribution(layer.enemy);
            if (exact.length > 0) {
              expect(layer.spawns!.map((s) => s.spawnId)).toEqual(exact.map((e) => e.spawnId));
              layer.spawns!.forEach((s, i) => expect(s.p).toBeCloseTo(exact[i].p, 2));
              if (exact.some((e) => e.p > 0)) expect(sum).toBeCloseTo(1, 2);
              checkedInactive++;
            }
          } else {
            expect(['Bayesian estimate · zone filter', 'Rule-based estimate · sight rules', 'Rule-based estimate · wander rules']).toContain(layer.label);
            if (layer.meaning === 'location') expect(sum).toBeCloseTo(1, 2);
            checkedActive++;
          }
        }
        if (f.slurp) {
          // "Finds you": the trained slurpRisk model when the artifact has it (ML estimate), else the raw rule; cells are the rule
          expect(['Rule-based estimate', 'ML estimate']).toContain(f.slurp.label);
          expect(f.slurp.cellsLabel).toBe('Rule-based estimate');
          expect(f.slurp.ruleP).toBeGreaterThanOrEqual(0);
          expect(f.slurp.ruleP).toBeLessThanOrEqual(1);
          expect(f.slurp.horizonS).toBe(15);
          expect(f.slurp.here.p).toBeGreaterThanOrEqual(0);
          expect(f.slurp.here.p).toBeLessThanOrEqual(1);
          expect(f.slurp.cells.every((c) => c.sizeM === 4 && c.p >= 0 && c.p <= 1)).toBe(true);
          if (f.slurp.here.fact === 'hunting' || f.slurp.here.fact === 'seen') expect(f.slurp.here.p).toBe(1);
        }
        if (f.noise) {
          expect(f.noise.label).toBe('Rule-based estimate · zone odds × hearing radius');
          expect(f.noise.p).toBeGreaterThanOrEqual(0);
          expect(f.noise.p).toBeLessThanOrEqual(1);
        }
        // the old Hyde field keeps its contract
        if (f.hyde.phase === 'before_emergence') expect(f.hyde.label).toBe('Rule-based estimate');
      });
      expect(checkedInactive + checkedActive, caseId).toBeGreaterThan(0);
    }
  }, 240_000);
});

// ----------------------------------------------------------------------------------------------------- diagnostic copy

const CTX: MessageContext = {
  abilityLabel: (key, id) => (key === 'Q' ? `Aegislash's ${id}` : `Morticia's ${id}`), hazards: [], mentions: () => 0, clueTotal: 3,
};

function texts(items: Parameters<typeof stamp>[0], stance: 'walk' | 'sprint' | 'crouch' = 'walk') {
  const r = new EventRules(CTX, stance);
  return { r, out: stamp(items).flatMap((e) => r.onEvent(e, false, null)) };
}

describe('WHY lines from the final rule events (UX_FINAL §8 exact copy, rule basis)', () => {
  it('detections, blocks, Slurp chase / pull-out / lost-by-door, the creak, the cabinet noise', () => {
    const steps = texts([
      [1, { type: 'noise', source: 'footstep', x: 0, z: 0, loudness: 0.5, radiusM: 7 }],
      [1, { type: 'hyde_heard', source: 'footstep', loudness: 0.5, distanceM: 6, occluded: false }],
      [1, { type: 'enemy_detected', enemy: 'hyde', via: 'sound' }],
    ]).out;
    expect(steps.map((m) => m.text)).toContain('Hyde detected your footsteps.');
    expect(texts([[2, { type: 'enemy_detected', enemy: 'crackstone', via: 'sight' }]]).out[0]).toMatchObject({ text: 'Crackstone spotted you.', title: TITLES.crackstone, basis: 'rule', priority: P.alert });
    const slam = texts([
      [3, { type: 'cabinet', spotId: 'c1', action: 'enter', loud: true }],
      [3, { type: 'noise', source: 'interact', x: 0, z: 0, loudness: 0.9, radiusM: 14 }],
      [3, { type: 'slurp_mode', from: 'WANDER', to: 'INVESTIGATE', reason: 'heard_noise' }],
    ]).out;
    expect(slam.map((m) => m.text)).toContain('Slurp heard the cabinet door.');
    const block = texts([
      [4, { type: 'ability_used', key: 'Q', abilityId: 'kings_shield', kinds: ['block_grab'], success: true, detail: '' }],
      [5, { type: 'enemy_hit', enemy: 'slurp', hpLost: 0, blocked: true }],
    ]).out;
    expect(block.map((m) => m.text)).toEqual(['Your Pokémon blocked the attack.']);
    expect(texts([[6, { type: 'slurp_mode', from: 'WANDER', to: 'CHASE', reason: 'saw_player' }]]).out[0].text).toBe('Slurp saw you and gave chase.');
    const pulled = texts([
      [7, { type: 'cabinet', spotId: 'c1', action: 'enter', loud: false }],
      [7, { type: 'enemy_detected', enemy: 'slurp', via: 'witnessed_hide' }],
      [9, { type: 'cabinet', spotId: 'c1', action: 'pulled_out', loud: true }],
    ]).out;
    expect(pulled.map((m) => m.text)).toEqual(['Witnessed: it saw you hide.', 'Slurp saw you hide and pulled you out.']);
    const lost = texts([
      [10, { type: 'slurp_mode', from: 'WANDER', to: 'CHASE', reason: 'saw_player' }],
      [11, { type: 'cabinet', spotId: 'c1', action: 'enter', loud: false }],
      [11.5, { type: 'cabinet', spotId: 'c1', action: 'close', loud: false }],
      [14, { type: 'slurp_mode', from: 'CHASE', to: 'SEARCH', reason: 'lost_sight' }],
    ]).out;
    expect(lost.map((m) => m.text)).toContain('Lost Slurp: the cabinet door was shut.');
    const creak = texts([
      [20, { type: 'cabinet', spotId: 'c1', action: 'enter', loud: false }],
      [20.5, { type: 'cabinet', spotId: 'c1', action: 'close', loud: false }],
      [40, { type: 'noise', source: 'interact', x: 0, z: 0, loudness: 0.3, radiusM: 6 }],
      [40, { type: 'hyde_mode', from: 'PATROL', to: 'INVESTIGATE_SOUND', reason: 'heard_noise' }],
    ]).out;
    expect(creak.map((m) => m.text)).toContain('The cabinet door creaked.');
    for (const m of [...steps, ...slam, ...block, ...pulled, ...lost, ...creak]) {
      expect(m.text.length).toBeLessThanOrEqual(48);
      if (m.kind === 'diagnostic') expect(m.basis).toBe('rule');
    }
  });

  it('spawn / despawn logs say presence only; counts are exact; a Hyde catch blocked by the Pokémon says so', () => {
    const { r, out } = texts([
      [20, { type: 'enemy_spawned', enemy: 'slurp', spawnId: 'x', x: 1, z: 2 }],
      [30, { type: 'enemy_despawned', enemy: 'slurp', reason: 'cycle_done' }],
      [31, { type: 'hint_requested', level: 1 }],
      [32, { type: 'enemy_detected', enemy: 'hyde', via: 'sight' }],
      [33, { type: 'ability_used', key: 'Q', abilityId: 'kings_shield', kinds: ['block_grab'], success: true, detail: '' }],
      [34, { type: 'catch', catchNumber: 1, hpLost: 0, eggSecurityLost: 0, blocked: true }],
      [34, { type: 'enemy_hit', enemy: 'hyde', hpLost: 0, blocked: true }],
    ]);
    expect(out.filter((m) => m.kind === 'log').map((m) => m.text)).toEqual(['Slurp is shambling about.', 'Slurp shambled off.']);
    expect(out.find((m) => m.code === 'caught_1')!.text).toBe('Caught 1 of 2. Your Pokémon blocked it.');
    expect(r.hintsUsed).toBe(1);
    expect(r.detections).toEqual({ hyde: 1, crackstone: 0, slurp: 0 });
    expect(r.hits).toEqual({ hyde: 1, crackstone: 0, slurp: 0 });
    expect(r.blockedHits).toBe(1);
  });

  it('SLURP alerts go through the same gate limits as the other enemies (≤ 4 enemy items per minute)', () => {
    const g = new MessageGate();
    let shown = 0;
    for (let i = 0; i < 8; i++) {
      g.offer({ kind: 'diagnostic', code: `slurp_x${i}`, title: TITLES.slurp, text: 'x', basis: 'rule', priority: P.alert, t: i * 5 });
      shown += g.release(i * 5, true).length;
    }
    expect(shown).toBe(4);
  });
});

// ----------------------------------------------------------------------------------------------------- Weems

describe('Principal Weems (paid, explicit, never a name)', () => {
  it('every case × level × objective step: ≤ 90 chars, titled, never names a suspect; L3 is deduction guidance', () => {
    for (const caseId of CASE_IDS) {
      play(caseId, `weems-${caseId}`, 150, (run) => {
        if (Math.round(run.t * 4) % 20 !== 0) return;
        for (const level of [1, 2, 3] as const) {
          for (const given of [0, 1, 5]) {
            const h = weemsHint(run, level, given);
            expect(h.title).toBe('PRINCIPAL WEEMS');
            expect(h.kind).toBe('weems');
            expect(h.level).toBe(level);
            expect(h.text.length).toBeGreaterThan(0);
            expect(h.text.length).toBeLessThanOrEqual(90);
            expect(namesSuspect(run, h.text), `${caseId} L${level}: ${h.text}`).toBe(false);
            for (const s of run.caseDef.suspects) expect(h.text).not.toContain(s.name);
            if (level === 3) expect(h.basis).toBe('deduction');
          }
        }
      });
    }
  }, 240_000);

  it('a sim hint_requested {level} yields that level\'s card once (FrameOutput + live().weems) and is recorded; Thing\'s ladder never counts', () => {
    const run = new MysteryRun({ duo: { ...DUO }, seed: 'weems-flow', tutorial: false, caseDef: CASES.poisoned_archive });
    const a = createMysteryAnalytics(run);
    for (let i = 0; i < 8; i++) a.frame(run, run.update(0.25, IDLE_INPUT));
    // Thing's free ladder (idle nudges): no hint_requested, the tally stays 0
    const nudge = a.hint(1, { requested: false });
    expect(nudge).not.toBeNull();
    expect(run.log.some((e) => e.type === 'hint_requested')).toBe(false);
    expect(a.liveStats().hintsUsed).toBe(0);
    // an explicit Ask Weems (V): the sim counts it, analytics provide the content
    let weems = null;
    for (let i = 0; i < 4 && !weems; i++) weems = a.frame(run, run.update(0.25, { ...IDLE_INPUT, hint: i === 0 })).weems;
    expect(weems).not.toBeNull();
    expect(weems!.level).toBe(1);
    const L = a.live();
    expect(L.weems!.map((w) => w.id)).toEqual([weems!.id]);
    expect(a.live().weems).toEqual([]);
    expect(L.stats!.hintsUsed).toBe(1);
    expect(a.weemsHints()).toHaveLength(1);
    expect(a.collector.recommendations.some((r) => r.action === 'weems_l1' && r.trigger === 'hint')).toBe(true);
    // Thing's advice cards are flagged free
    if (L.advice) expect(L.advice.free).toBe(true);
  });
});

// ----------------------------------------------------------------------------------------------------- tally + score preview + game over

describe('Weems ladder: every level says something new', () => {
  it('L1 ≠ L2 ≠ L3 for every case and objective step (incl. the accusation), for repeated hints too', () => {
    const steps = new Set<string>();
    for (const caseId of CASE_IDS) {
      const check = (run: MysteryRun) => {
        for (const given of [0, 1, 2, 4]) {
          const t = ([1, 2, 3] as const).map((l) => weemsHint(run, l, given).text);
          expect(new Set(t).size, `${caseId} ${run.objective()} given ${given}: ${t.join(' | ')}`).toBe(3);
        }
        steps.add(run.objective());
      };
      const { run } = play(caseId, `ladder-${caseId}`, 400, (r) => {
        if (Math.round(r.t * 4) % 12 === 0) check(r);
      }, 'stealthy');
      if (run.status === 'accusing') check(run);
    }
    expect(steps.has('find_clues')).toBe(true);
    expect(steps.size).toBeGreaterThanOrEqual(3);
  }, 300_000);
});

describe('live tally, score preview and the game-over WHY', () => {
  it('counts equal the rule events of the log; the preview equals scoreV4 for the same parts', () => {
    for (const caseId of CASE_IDS) {
      const { run, a } = play(caseId, `tally-${caseId}`, 200);
      const s = a.liveStats();
      const log = run.log;
      expect(s.hintsUsed).toBe(log.filter((e) => e.type === 'hint_requested').length);
      expect(s.detections).toBe(log.filter((e) => e.type === 'enemy_detected').length);
      expect(s.hits).toBe(log.filter((e) => e.type === 'enemy_hit').length);
      const want = scoreV4({ delivered: true, correct: false, cluesFound: run.cluesFound.length, detections: s.detections, hintsUsed: s.hintsUsed, hits: s.hits, activeTimeS: s.activeTimeS });
      expect(s.scorePreview.totalNow).toBe(want.total);
      expect(s.scorePreview.label).toBe('Preview · if you deliver now');
      expect(s.scorePreview.accusationBonus).toBeGreaterThanOrEqual(0);
      expect(s.scorePreview.accusationBonus).toBeLessThanOrEqual(300);
      if (run.status === 'dnf') {
        const why = a.gameOverWhy();
        expect(why.length).toBeGreaterThanOrEqual(1);
        expect(why.length).toBeLessThanOrEqual(2);
        why.forEach((l) => expect(l.length).toBeLessThanOrEqual(52));
        const by = run.result()!.defeatedBy;
        if (by === 'slurp') expect(why[0]).toMatch(/Slurp/);
        if (by === 'hyde') expect(why[0]).toMatch(/Hyde/);
        if (by === 'crackstone') expect(why[0]).toMatch(/Crackstone/);
      } else expect(a.gameOverWhy()).toEqual([]);
    }
  }, 240_000);
});

// ----------------------------------------------------------------------------------------------------- prescriptive: cabinets / Slurp

describe("Thing's free advice: cabinets and Slurp are feasible", () => {
  it('inside a cabinet only door advice is given; hide_cabinet never while an enemy can see you; targets are cabinets', () => {
    let hides = 0;
    let inside = 0;
    for (const caseId of CASE_IDS) {
      for (const profile of ['careless', 'stealthy'] as const) {
        play(caseId, `cab-${caseId}-${profile}`, 160, (run, a) => {
          const all = a.prescriptive.candidates(run, a.engine.zones(), a.live().forecasts.crackstone ?? null);
          if (run.player.cabinet) {
            inside++;
            for (const o of all) expect(['close_cabinet', 'exit_cabinet', 'stay_quiet']).toContain(o.action);
          }
          for (const o of all) {
            expect(o.text.length).toBeLessThanOrEqual(52);
            expect(o.reason.length).toBeLessThanOrEqual(48);
            if (o.action === 'hide_cabinet') {
              hides++;
              expect(run.hyde.canSeePlayer && run.hydeActive).toBe(false);
              expect(run.slurp?.canSeePlayer && run.slurp.active ? true : false).toBe(false);
              const cab = run.map.hidingSpots.filter((h) => h.kind === 'cabinet');
              expect(cab.some((c) => Math.hypot(c.x - o.target!.x, c.z - o.target!.z) < 1.5)).toBe(true);
            }
            if (o.action === 'use_power' || o.action === 'use_move') {
              // never an enemy-targeted move with no active enemy (the existing property test checks range / LOS per enemy)
              const any = run.hydeActive || (run.crackstoneBrain?.active ?? false) || (run.slurp?.active ?? false);
              if (o.ability!.kinds.some((k) => k === 'stun' || k === 'slow' || k === 'distract')) expect(any).toBe(true);
            }
          }
        }, profile);
      }
    }
    expect(hides + inside).toBeGreaterThanOrEqual(0); // smoke: bots rarely use cabinets; the rules above hold whenever they do
  }, 300_000);
});

// ----------------------------------------------------------------------------------------------------- local leaderboard

describe('local leaderboard ranking (LOCAL DEMO)', () => {
  const rec = (id: string, outcome: 'finished' | 'dnf', score: number | null, t: number, v: string | undefined, endedAt: string): LocalRecordLike => ({
    record: {
      sessionId: id, caseId: 'poisoned_archive', duo: { characterId: 'enid', pokemonId: 'gengar' },
      result: { outcome, verdict: 'case_solved', activeTimeS: t, score, cluesFound: [], catches: 0, ...(v ? { rulesVersion: v as 'mystery-v4' } : {}), ...(outcome === 'dnf' ? { defeatedBy: 'slurp' as const } : {}) },
    },
    nickname: id.toUpperCase(), endedAt,
  });
  const records = [
    rec('a', 'finished', 1500, 100, 'mystery-v4', '2026-10-27T18:00:00Z'),
    rec('b', 'finished', 1700, 120, 'mystery-v4', '2026-10-27T18:01:00Z'),
    rec('c', 'finished', 1500, 100, 'mystery-v4', '2026-10-27T18:00:00Z'), // exact tie with a → same rank
    rec('d', 'dnf', null, 200, 'mystery-v4', '2026-10-27T18:02:00Z'),
    rec('e', 'finished', 2200, 90, 'mystery-v3.1', '2026-10-27T18:03:00Z'), // other rules version: never mixed
    rec('f', 'finished', 2100, 90, undefined, '2026-10-27T18:03:00Z'), // legacy record: ignored
    rec('g', 'finished', 900, 200, 'mystery-v4', '2026-10-27T18:04:00Z'),
    rec('h', 'finished', 800, 200, 'mystery-v4', '2026-10-27T18:04:00Z'),
    rec('i', 'finished', 700, 200, 'mystery-v4', '2026-10-27T18:04:00Z'),
  ];
  it('v4 finishers only, best first, SQL ranks, top 5; DNFs never ranked (defeat log)', () => {
    const top = rankLocalRecords(records);
    expect(top.map((e) => [e.sessionId, e.rank])).toEqual([['b', 1], ['a', 2], ['c', 2], ['g', 4], ['h', 5]]);
    expect(top[0]).toMatchObject({ nickname: 'B', score: 1700, characterId: 'enid', pokemonId: 'gengar' });
    expect(localRankOf(records, 'i')).toBe(6);
    expect(localRankOf(records, 'd')).toBeNull();
    expect(localDefeatLog(records).map((d) => [d.sessionId, d.defeatedBy])).toEqual([['d', 'slurp']]);
    expect(rankLocalRecords([])).toEqual([]);
  });
});

// ----------------------------------------------------------------------------------------------------- heartbeat

describe('heartbeat additions (three enemies, tally) round-trip the strict parser', () => {
  it('enums and counts only; never a position', () => {
    const { a } = play('crypt_last_witness', 'beat-final', 90);
    const hb = a.heartbeat();
    const beat = heartbeatFrom('station_a', {
      stationId: 'station_a', phase: 'investigating', nickname: 'x', duo: null, clues: 0, egg: null, hp: 100, catches: 0, hydeMode: null, risk: null,
      advice: null, activeTimeS: 90, updatedAt: 0,
    }, 'live', hb);
    const parsed = parseHeartbeat(JSON.parse(JSON.stringify(beat)))!;
    expect(parsed).not.toBeNull();
    expect(parsed.hintsUsed).toBe(hb.hintsUsed);
    expect(parsed.detections).toBe(hb.detections);
    expect(parsed.hits).toBe(hb.hits);
    expect(parsed.hydeActive).toBe(hb.enemies.hyde.active);
    expect(parsed.slurpPresent).toBe(hb.enemies.slurp.present);
    expect(JSON.stringify(beat)).not.toMatch(/"x":|"z":/);
    expect(parseHeartbeat({ ...beat, slurpMode: 'DANCING', cabinet: 'ajar', hits: -3 })).toMatchObject({ slurpMode: null, cabinet: null, hits: 0 });
  }, 120_000);
});

describe('cabinet advice, deterministic', () => {
  it('approach → E (enter) → "close" advice → E (close) → "clear, step out"; an alerted Hyde → "Hide. The Hyde is approaching."', async () => {
    const { cabinetDoor } = await import('../../../src/mystery/cabinet.ts');
    let checked = 0;
    let hidesAdvised = 0;
    for (const caseId of CASE_IDS) {
      const run = new MysteryRun({ duo: { ...DUO }, seed: `cabdet-${caseId}`, tutorial: false, caseDef: CASES[caseId] });
      const a = createMysteryAnalytics(run);
      const nav = run.playerNav();
      const cab = run.map.hidingSpots.find((h) => h.kind === 'cabinet' && nav.nearestWalkable(cabinetDoor(h), 1) !== null);
      if (!cab) continue;
      const door = nav.nearestWalkable(cabinetDoor(cab), 1)!;
      Object.assign(run.player, { x: door.x, z: door.z });
      a.frame(run, run.update(1 / 60, IDLE_INPUT));
      // enter
      a.frame(run, run.update(1 / 60, { ...IDLE_INPUT, interact: true }));
      for (let i = 0; i < 90 && run.player.cabinet?.phase !== 'open'; i++) a.frame(run, run.update(1 / 60, IDLE_INPUT));
      if (run.player.cabinet?.phase !== 'open') continue; // something of higher interaction priority was in reach
      const open = a.prescriptive.candidates(run);
      expect(open.map((o) => o.action)).toEqual(['close_cabinet']);
      expect(a.live().advice?.text).toBe(open[0].text);
      // close: from the press on (the door is still swinging shut) Thing never says "Close the cabinet." again
      a.frame(run, run.update(1 / 60, { ...IDLE_INPUT, interact: true }));
      expect(run.cabinetStatus()?.closing || run.cabinetStatus()?.phase === 'closed').toBe(true);
      expect(a.prescriptive.candidates(run).some((o) => o.action === 'close_cabinet')).toBe(false);
      expect(a.live().advice?.text ?? '').not.toBe(open[0].text);
      for (let i = 0; i < 90 && (run.player.cabinet?.phase as string | undefined) !== 'closed'; i++) a.frame(run, run.update(1 / 60, IDLE_INPUT));
      expect(run.player.cabinet?.phase).toBe('closed');
      const closed = a.prescriptive.candidates(run);
      expect(closed.map((o) => o.action)).toEqual(['exit_cabinet']);
      // the forecasts say "hidden" while the door is shut
      const f = a.live().forecasts;
      if (f.crackstone && f.crackstone.here.fact !== 'hunting') expect(f.crackstone.here).toEqual({ p: 0, fact: 'hidden' });
      if (f.slurp && f.slurp.here.fact !== 'hunting') expect(f.slurp.here).toEqual({ p: 0, fact: 'hidden' });
      checked++;
      // a fresh run: the Hyde searching 14 m away on the far side → hide in the cabinet (target = its door)
      const r2 = new MysteryRun({ duo: { ...DUO }, seed: `cabdet2-${caseId}`, tutorial: false, caseDef: CASES[caseId] });
      const a2 = createMysteryAnalytics(r2);
      r2.emergeHyde();
      const nav2 = r2.playerNav();
      const d2 = cabinetDoor(cab);
      let placed = false;
      for (let k = 0; k < 16 && !placed; k++) {
        const ang = (k / 16) * Math.PI * 2;
        const me = nav2.nearestWalkable({ x: d2.x + Math.cos(ang) * 4, z: d2.z + Math.sin(ang) * 4 }, 1);
        const hy = nav2.nearestWalkable({ x: d2.x + Math.cos(ang) * 18, z: d2.z + Math.sin(ang) * 18 }, 2);
        if (!me || !hy) continue;
        Object.assign(r2.player, { x: me.x, z: me.z });
        Object.assign(r2.hyde, { x: hy.x, z: hy.z, mode: 'SEARCH', canSeePlayer: false });
        a2.frame(r2, []);
        const hide = a2.prescriptive.candidates(r2).find((o) => o.action === 'hide_cabinet');
        if (hide) {
          placed = true;
          expect(hide.text).toBe('Hide. The Hyde is approaching.');
          expect(Math.hypot(hide.target!.x - d2.x, hide.target!.z - d2.z)).toBeLessThan(0.5);
        }
      }
      if (placed) hidesAdvised++;
    }
    expect(checked).toBeGreaterThan(0);
    expect(hidesAdvised).toBeGreaterThan(0);
  }, 120_000);
});

describe('bundled artifact (mystery-v4 retrain)', () => {
  it('is accepted by the gate, trained for mystery-v4, and its Slurp model beats the constant base rate on held-out sessions', async () => {
    const { BUNDLED_MODEL } = await import('../../../src/mystery/analytics/model/index.ts');
    const { validateArtifact } = await import('../../../src/mystery/analytics/model.ts');
    const { slurpRiskFrom } = await import('../../../src/mystery/analytics/slurpModel.ts');
    const v = validateArtifact(BUNDLED_MODEL);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.model.rulesVersion).toBe('mystery-v4');
    const s = slurpRiskFrom(BUNDLED_MODEL);
    expect(s).not.toBeNull();
    expect(s!.metrics!.brier).toBeLessThan(s!.metrics!.constantBrier);
    expect(s!.trainedOn).toMatch(/simulated/);
  });
});
