// DescriptiveService exact counts + DiagnosticService cause/pattern discipline, on a scripted log and on bot episodes.
import { describe, expect, it } from 'vitest';
import { aggregateSessions, describeSession, stanceSeconds } from '../../../src/mystery/analytics/descriptive.ts';
import { aggregateDiagnostics, catchChains, diagnoseCauses, diagnosePatterns, diagnoseSession, topCauses } from '../../../src/mystery/analytics/diagnostic.ts';
import type { SessionRecord } from '../../../src/mystery/analytics/types.ts';
import type { StampedEvent } from '../../../src/mystery/types.ts';
import { episode, stamp } from './helpers.ts';

const DUO = { characterId: 'eugene', pokemonId: 'sableye' } as const;

function scripted(): StampedEvent[] {
  return stamp([
    [0.5, { type: 'stance', stance: 'walk' }],
    [1.0, { type: 'noise', source: 'footstep', x: 0, z: 0, loudness: 0.35, radiusM: 7 }],
    [1.5, { type: 'noise', source: 'footstep', x: 0, z: 1, loudness: 0.35, radiusM: 7 }],
    [2.0, { type: 'room_enter', roomId: 'research_room' }],
    [3.0, { type: 'stance', stance: 'sprint' }],
    [3.2, { type: 'noise', source: 'footstep', x: 1, z: 2, loudness: 0.95, radiusM: 13 }],
    [3.2, { type: 'hyde_heard', source: 'footstep', loudness: 0.95, distanceM: 9.2, occluded: false }],
    [3.2, { type: 'hyde_mode', from: 'PATROL', to: 'INVESTIGATE_SOUND', reason: 'heard_noise' }],
    [4.0, { type: 'clue_search_start', clueId: 'transfer_note' }],
    [6.0, { type: 'clue_found', clueId: 'transfer_note', cluesFound: 1 }],
    [6.5, { type: 'noise', source: 'interact', x: 1, z: 2, loudness: 0.2, radiusM: 4 }],
    [8.0, { type: 'hyde_sighted', distanceM: 6.1 }],
    [9.0, { type: 'hyde_mode', from: 'INVESTIGATE_SOUND', to: 'CHASE', reason: 'saw_player' }],
    [11.0, { type: 'catch', catchNumber: 1, hpLost: 35, eggSecurityLost: 0, blocked: false }],
    [11.0, { type: 'hyde_mode', from: 'CHASE', to: 'COOLDOWN', reason: 'grabbed' }],
    [12.0, { type: 'stance', stance: 'walk' }],
    [20.0, { type: 'egg_pickup' }],
    [20.0, { type: 'noise', source: 'interact', x: 5, z: 5, loudness: 0.3, radiusM: 6 }],
    [25.0, { type: 'egg_damage', amount: 10, cause: 'impact', security: 70 }],
    [25.0, { type: 'noise', source: 'impact', x: 6, z: 6, loudness: 0.6, radiusM: 10 }],
    [30.0, { type: 'ability_used', key: 'F', abilityId: 'x_power', kinds: ['distract'], success: true, detail: 'ok' }],
    [31.0, { type: 'ability_denied', key: 'Q', reason: 'cooldown' }],
    [32.0, { type: 'hint_requested' }],
    [40.0, { type: 'egg_delivered', tier: 'rare', points: 3, security: 70 }],
    [40.0, { type: 'accusation', suspectId: 'isaac', correct: false, cluesFound: 1 }],
    [40.0, { type: 'finish', verdict: 'egg_secured_mystery_unsolved', score: 260 }],
  ]);
}

describe('DescriptiveService — exact counts', () => {
  it('counts every event class exactly on a scripted log', () => {
    const r = describeSession({ duo: DUO, events: scripted() });
    expect(r.status).toBe('finished');
    expect(r.activeTimeS).toBe(40);
    expect(r.noise.total).toBe(6);
    expect(r.noise.bySource).toEqual({ footstep: 3, egg_drop: 0, ability: 0, interact: 2, impact: 1, decoy: 0 });
    expect(r.noise.maxLoudness).toBe(0.95);
    expect(r.noise.heardBySource.footstep).toBe(1);
    expect(r.hyde).toMatchObject({ heard: 1, sightings: 1, chases: 1, catches: 1, blockedCatches: 0, hpLost: 35, firstAlertT: 3.2 });
    expect(r.hyde.alertsByMode).toEqual({ PATROL: 0, INVESTIGATE_SOUND: 1, SEARCH: 0, CHASE: 1, COOLDOWN: 1 });
    expect(r.clues).toEqual({ found: [{ clueId: 'transfer_note', t: 6 }], count: 1, total: 3 });
    expect(r.egg).toMatchObject({ pickupT: 20, securityLost: 10, security: 70, delivered: true, deliveredT: 40, points: 3, drops: [] });
    expect(r.abilities.F).toMatchObject({ uses: 1, successes: 1, denied: 0 });
    expect(r.abilities.Q).toMatchObject({ uses: 0, successes: 0, denied: 1 });
    expect(r.hints).toBe(1);
    expect(r.verdict).toBe('egg_secured_mystery_unsolved');
    expect(r.extraction).toBe(true);
    expect(r.score).toBe(260);
    // stance: idle 0–0.5, walk 0.5–3, sprint 3–12, walk 12–40
    expect(r.stanceSeconds).toEqual({ idle: 0.5, walk: 30.5, crouch: 0, sprint: 9 });
    expect(r.stanceShare.sprint).toBeCloseTo(9 / 40, 10);
  });

  it('matches direct event counts and the RunResult on real bot episodes', () => {
    for (const [i, profile] of (['careless', 'stealthy'] as const).entries()) {
      const ep = episode({ characterId: 'gomez', pokemonId: 'froslass' }, `desc-${i}`, { profile, useAbilities: true });
      const c = ep.collector;
      const r = describeSession({ duo: ep.duo, events: c.events, initialStance: c.initialStance(), distanceM: c.distanceM, result: ep.result, factors: c.meta.factors });
      const count = (type: StampedEvent['type']) => c.events.filter((e) => e.type === type).length;
      expect(r.noise.total).toBe(count('noise'));
      expect(r.hyde.sightings).toBe(count('hyde_sighted'));
      expect(r.hyde.catches).toBe(ep.result!.catches);
      expect(r.hyde.chases).toBe(c.events.filter((e) => e.type === 'hyde_mode' && e.to === 'CHASE').length);
      expect(r.clues.count).toBe(ep.result!.cluesFound.length);
      expect(r.abilities.F.uses + r.abilities.Q.uses).toBe(count('ability_used'));
      expect(r.activeTimeS).toBe(ep.result!.activeTimeS);
      expect(r.score).toBe(ep.result!.score);
      const total = r.stanceSeconds.idle + r.stanceSeconds.walk + r.stanceSeconds.crouch + r.stanceSeconds.sprint;
      expect(total).toBeCloseTo(ep.result!.activeTimeS, 0);
      expect(r.distanceM).toBeGreaterThan(50);
      expect(r.abilities.F.name).toBe(ep.run.power.def.name);
    }
  }, 60_000);

  it('stance seconds clip at the end time', () => {
    const ev = stamp([[2, { type: 'stance', stance: 'crouch' }], [9, { type: 'stance', stance: 'walk' }]]);
    expect(stanceSeconds(ev, 5, 'walk')).toEqual({ idle: 0, walk: 2, crouch: 3, sprint: 0 });
  });

  it('aggregates sessions for Laptop 1 (finish/DNF, solved %, clue rates, pick rate when offered)', () => {
    const fin: SessionRecord = {
      sessionId: 'a', duo: { characterId: 'enid', pokemonId: 'gengar' }, events: scripted(),
      offered: [{ characterId: 'enid', pokemonId: 'gengar' }, { characterId: 'ajax', pokemonId: 'dusknoir' }, { characterId: 'bianca', pokemonId: 'gengar' }],
      result: { outcome: 'finished', verdict: 'case_solved', activeTimeS: 40, score: 260, cluesFound: ['transfer_note', 'master_key', 'greenhouse_trace'], catches: 1 },
    };
    const dnf: SessionRecord = {
      sessionId: 'b', duo: { characterId: 'ajax', pokemonId: 'dusknoir' },
      offered: [{ characterId: 'ajax', pokemonId: 'dusknoir' }, { characterId: 'enid', pokemonId: 'misdreavus' }, { characterId: 'gomez', pokemonId: 'gengar' }],
      events: stamp([[5, { type: 'catch', catchNumber: 1, hpLost: 35, eggSecurityLost: 0, blocked: false }], [9, { type: 'catch', catchNumber: 2, hpLost: 35, eggSecurityLost: 0, blocked: false }], [9, { type: 'dnf', reason: 'second_catch' }]]),
      result: { outcome: 'dnf', verdict: 'not_accused', activeTimeS: 9, score: null, cluesFound: [], catches: 2 },
    };
    const a = aggregateSessions([fin, dnf], ['transfer_note', 'master_key', 'greenhouse_trace']);
    expect(a).toMatchObject({ runs: 2, finished: 1, dnf: 1, inProgress: 0, caseSolvedPctOfFinished: 100, medianTimeS: 40, allThreePct: 50 });
    expect(a.clueFindRate).toEqual({ transfer_note: 0.5, master_key: 0.5, greenhouse_trace: 0.5 });
    const enid = a.pickRate.characters.find((x) => x.id === 'enid')!;
    expect(enid).toMatchObject({ offered: 2, selected: 1, rate: 0.5, smallSample: true });
    const gengar = a.pickRate.pokemon.find((x) => x.id === 'gengar')!;
    expect(gengar).toMatchObject({ offered: 3, selected: 1 });
    expect(a.topAbilities[0]).toMatchObject({ key: 'F', abilityId: 'x_power', uses: 1 });
  });
});

describe('DiagnosticService — causes only with rule evidence, patterns labelled', () => {
  it('derives the rule-verified chain on the scripted log', () => {
    const ev = scripted();
    const causes = diagnoseCauses(ev);
    const codes = causes.map((c) => c.code);
    expect(codes).toEqual(['heard_footstep_sprint', 'seen_while_investigating', 'catch', 'impact_damage']);
    const heard = causes[0];
    // evidence: the sprint stance (seq 5), the noise (6), its hearing (7) and the INVESTIGATE transition (8)
    expect(heard.evidenceSeq).toEqual([5, 6, 7, 8]);
    expect(heard.text).toBe('0:03 · Your sprint (loud) was heard 9 m away → the Hyde investigated.');
    expect(causes[1].evidenceSeq).toEqual([12, 13]);
    expect(causes[2].evidenceSeq).toEqual([13, 14]);
    for (const c of causes) {
      expect(c.kind).toBe('cause');
      for (const s of c.evidenceSeq) expect(ev.some((e) => e.seq === s)).toBe(true);
    }
    expect(topCauses(causes, 3).map((c) => c.code)).toEqual(['heard_footstep_sprint', 'seen_while_investigating', 'catch']);
  });

  it('asserts no cause without the explicit transition', () => {
    // INVESTIGATE "heard_noise" with no hyde_heard at that instant → no cause
    const a = stamp([
      [1, { type: 'noise', source: 'footstep', x: 0, z: 0, loudness: 0.95, radiusM: 13 }],
      [2, { type: 'hyde_mode', from: 'PATROL', to: 'INVESTIGATE_SOUND', reason: 'heard_noise' }],
    ]);
    expect(diagnoseCauses(a)).toEqual([]);
    // CHASE after the sighting was already lost → not attributed to that sighting
    const b = stamp([
      [1, { type: 'hyde_sighted', distanceM: 8 }],
      [2, { type: 'hyde_lost' }],
      [3, { type: 'hyde_mode', from: 'SEARCH', to: 'CHASE', reason: 'saw_player' }],
    ]);
    expect(diagnoseCauses(b)).toEqual([]);
    // sprinting near a sighting with no transition → only a pattern, never a cause
    const c = stamp([
      [1, { type: 'stance', stance: 'sprint' }],
      [2, { type: 'hyde_sighted', distanceM: 8 }],
      [3, { type: 'hyde_lost' }],
      [6, { type: 'hyde_sighted', distanceM: 9 }],
      [7, { type: 'hyde_lost' }],
      [20, { type: 'stance', stance: 'walk' }],
      [40, { type: 'hyde_sighted', distanceM: 12 }],
    ]);
    expect(diagnoseCauses(c)).toEqual([]);
    const pats = diagnosePatterns(c);
    expect(pats).toHaveLength(1);
    expect(pats[0]).toMatchObject({ kind: 'pattern', code: 'sprint_before_sighting', evidenceSeq: [2, 4] });
    expect(pats[0].text).toBe('2 of 3 sightings came within 5 s of sprinting — a pattern, not proof.');
  });

  it('grab and impact drops are causes with their evidence', () => {
    const ev = stamp([
      [1, { type: 'egg_pickup' }],
      [5, { type: 'hyde_mode', from: 'PATROL', to: 'CHASE', reason: 'saw_player' }],
      [6, { type: 'catch', catchNumber: 1, hpLost: 35, eggSecurityLost: 20, blocked: false }],
      [6, { type: 'egg_damage', amount: 20, cause: 'grab', security: 80 }],
      [6, { type: 'egg_drop', reason: 'grab', security: 80 }],
      [9, { type: 'egg_damage', amount: 25, cause: 'impact', security: 30 }],
      [9, { type: 'egg_drop', reason: 'impact', security: 30 }],
      [12, { type: 'catch', catchNumber: 2, hpLost: 35, eggSecurityLost: 0, blocked: false }],
      [12, { type: 'dnf', reason: 'second_catch' }],
    ]);
    const causes = diagnoseCauses(ev);
    const drop = causes.find((c) => c.code === 'grab_drop')!;
    expect(drop.evidenceSeq).toEqual([3, 4, 5]);
    expect(causes.find((c) => c.code === 'impact_drop')!.evidenceSeq).toEqual([6, 7]);
    expect(causes.find((c) => c.code === 'dnf_second_catch')!.evidenceSeq).toEqual([8, 9]);
  });

  it('on bot episodes every cause cites existing events including the rule transition, and patterns are worded as correlations', () => {
    let causes = 0;
    for (let i = 0; i < 6; i++) {
      const ep = episode({ characterId: 'bianca', pokemonId: 'dragapult' }, `diag-${i}`, { profile: 'careless', sprintProb: 0.7 });
      const ev = ep.collector.events;
      const bySeq = new Map(ev.map((e) => [e.seq, e]));
      const rep = diagnoseSession(ev, { initialStance: ep.collector.initialStance() });
      for (const c of rep.causes) {
        causes++;
        const cited = c.evidenceSeq.map((s) => bySeq.get(s));
        expect(cited.every(Boolean)).toBe(true);
        const ruleEvent = cited.some((e) => e && ['hyde_mode', 'catch', 'egg_drop', 'egg_damage', 'dnf'].includes(e.type));
        expect(ruleEvent, c.code).toBe(true);
        if (c.code.startsWith('heard_')) {
          expect(cited.some((e) => e?.type === 'hyde_heard')).toBe(true);
          expect(cited.some((e) => e?.type === 'hyde_mode' && e.reason === 'heard_noise')).toBe(true);
        }
        if (c.code.startsWith('seen_')) {
          expect(cited.some((e) => e?.type === 'hyde_sighted')).toBe(true);
          expect(cited.some((e) => e?.type === 'hyde_mode' && e.to === 'CHASE' && e.reason === 'saw_player')).toBe(true);
        }
      }
      for (const p of rep.patterns) {
        expect(p.kind).toBe('pattern');
        expect(p.text).toMatch(/a pattern, not proof\.|a correlation, not proof\./);
      }
    }
    expect(causes).toBeGreaterThan(5);
  }, 60_000);

  it('aggregates failure chains and labels pooled patterns', () => {
    const recs: SessionRecord[] = [];
    for (let i = 0; i < 6; i++) {
      const ep = episode({ characterId: 'enid', pokemonId: 'drifblim' }, `agg-${i}`, { profile: 'careless', sprintProb: 0.8 });
      recs.push({ sessionId: ep.seed, duo: ep.duo, events: ep.collector.events, result: ep.result });
    }
    const agg = aggregateDiagnostics(recs);
    const catches = recs.reduce((s, r) => s + r.events.filter((e) => e.type === 'catch').length, 0);
    expect(agg.failureCauses.reduce((s, c) => s + c.count, 0)).toBe(catches);
    expect(recs.reduce((s, r) => s + catchChains(r.events).length, 0)).toBe(catches);
    for (const p of agg.patterns) expect(p.text).toMatch(/correlation, not proof/);
  }, 60_000);
});
