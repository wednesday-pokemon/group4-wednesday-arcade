// DescriptiveService exact counts + DiagnosticService cause/pattern discipline, on a scripted log and on bot episodes;
// case awareness: per-case aggregates never mix clue sets, case-rule failure reasons (missed clues by title, wrong
// suspect, right suspect with weak evidence, no accusation, DNF before accusing).
import { describe, expect, it } from 'vitest';
import { aggregateSessions, describeSession, scopeRecords, stanceSeconds } from '../../../src/mystery/analytics/descriptive.ts';
import {
  aggregateDiagnostics, catchChains, diagnoseCaseReasons, diagnoseCauses, diagnosePatterns, diagnoseSession, failureReasons, topCauses,
} from '../../../src/mystery/analytics/diagnostic.ts';
import { accusationKind } from '../../../src/mystery/analytics/caseInfo.ts';
import type { SessionRecord } from '../../../src/mystery/analytics/types.ts';
import { CASES } from '../../../src/mystery/data/cases.ts';
import { CASE_IDS, type CaseId, type ClueId, type StampedEvent } from '../../../src/mystery/types.ts';
import { episode, recordOf, stamp } from './helpers.ts';

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
    [4.0, { type: 'clue_search_start', clueId: 'falsified_transfer' }],
    [6.0, { type: 'clue_found', clueId: 'falsified_transfer', cluesFound: 1 }],
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
    [40.0, { type: 'accusation', suspectId: 'isaac', correct: false, cluesFound: 1, evidence: ['falsified_transfer'], deductionCorrect: false }],
    [40.0, { type: 'finish', verdict: 'egg_secured_mystery_unsolved', score: 260 }],
  ]);
}

describe('DescriptiveService — exact counts', () => {
  it('counts every event class exactly on a scripted log', () => {
    const r = describeSession({ duo: DUO, events: scripted(), caseId: 'poisoned_archive' });
    expect(r.status).toBe('finished');
    expect(r.caseId).toBe('poisoned_archive');
    expect(r.caseVersion).toBe(CASES.poisoned_archive.version);
    expect(r.activeTimeS).toBe(40);
    expect(r.noise.total).toBe(6);
    expect(r.noise.bySource).toEqual({ footstep: 3, egg_drop: 0, ability: 0, interact: 2, impact: 1, decoy: 0 });
    expect(r.noise.maxLoudness).toBe(0.95);
    expect(r.noise.heardBySource.footstep).toBe(1);
    expect(r.hyde).toMatchObject({ heard: 1, sightings: 1, chases: 1, catches: 1, blockedCatches: 0, hpLost: 35, firstAlertT: 3.2 });
    expect(r.hyde.alertsByMode).toEqual({ PATROL: 0, INVESTIGATE_SOUND: 1, SEARCH: 0, CHASE: 1, COOLDOWN: 1 });
    expect(r.clues).toEqual({
      found: [{ clueId: 'falsified_transfer', t: 6 }], count: 1, total: 3,
      missing: [
        { clueId: 'botanical_residue', title: 'Restricted Botanical Residue' },
        { clueId: 'access_ledger', title: 'Archive and Greenhouse Access Ledger' },
      ],
    });
    expect(r.accusation).toEqual({ kind: 'wrong_suspect', evidenceCount: 1 });
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
      sessionId: 'a', caseId: 'poisoned_archive', duo: { characterId: 'enid', pokemonId: 'gengar' }, events: scripted(),
      offered: [{ characterId: 'enid', pokemonId: 'gengar' }, { characterId: 'ajax', pokemonId: 'dusknoir' }, { characterId: 'bianca', pokemonId: 'gengar' }],
      result: { outcome: 'finished', verdict: 'case_solved', activeTimeS: 40, score: 260, cluesFound: ['falsified_transfer', 'botanical_residue', 'access_ledger'], catches: 1 },
    };
    const dnf: SessionRecord = {
      sessionId: 'b', caseId: 'poisoned_archive', duo: { characterId: 'ajax', pokemonId: 'dusknoir' },
      offered: [{ characterId: 'ajax', pokemonId: 'dusknoir' }, { characterId: 'enid', pokemonId: 'misdreavus' }, { characterId: 'gomez', pokemonId: 'gengar' }],
      events: stamp([[5, { type: 'catch', catchNumber: 1, hpLost: 35, eggSecurityLost: 0, blocked: false }], [9, { type: 'catch', catchNumber: 2, hpLost: 35, eggSecurityLost: 0, blocked: false }], [9, { type: 'dnf', reason: 'second_catch' }]]),
      result: { outcome: 'dnf', verdict: 'not_accused', activeTimeS: 9, score: null, cluesFound: [], catches: 2 },
    };
    const a = aggregateSessions([fin, dnf]);
    expect(a).toMatchObject({ scope: 'all', legacyExcluded: 0, runs: 2, finished: 1, dnf: 1, inProgress: 0, caseSolvedPctOfFinished: 100, medianTimeS: 40, allCluesPct: 50 });
    expect(a).toMatchObject({ finishRatePct: 50, extractionPct: 50, meanTimeS: 40 });
    expect(a.clueFindRate).toEqual({ falsified_transfer: 0.5, botanical_residue: 0.5, access_ledger: 0.5 });
    expect(a.accusation).toMatchObject({ solved: 1, dnf: 1, wrongSuspect: 0, accused: 1 });
    expect(a.cases.map((c) => c.runs)).toEqual([2, 0, 0]);
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

// ----------------------------------------------------------------------------------------------------- case awareness

const ids = (c: CaseId) => CASES[c].clues.map((x) => x.id);

/** A finished (or DNF) result-only record of `caseId` that found `found` (count of that case's clues, in order). */
function rec(id: string, caseId: CaseId | null, found: number, extra: Partial<NonNullable<SessionRecord['result']>> = {}, clueIds?: string[]): SessionRecord {
  const clues = (clueIds ?? (caseId ? ids(caseId) : [])).slice(0, found) as ClueId[];
  const solved = found === 3 && extra.verdict === undefined;
  return {
    sessionId: id, caseId, duo: { characterId: 'enid', pokemonId: 'gengar' }, events: [],
    result: {
      outcome: 'finished', verdict: solved ? 'case_solved' : 'egg_secured_mystery_unsolved', activeTimeS: 100 + found, score: 200, cluesFound: clues, catches: 0,
      correct: solved, deductionCorrect: solved, ...extra,
    },
  };
}

describe('case-aware aggregates', () => {
  it('per-case aggregates never mix clue sets: "all clues" uses each case\'s own clues, clue rates stay within the case', () => {
    const records: SessionRecord[] = [
      // Case 01: 2 runs, one found all 3, one found 1
      rec('a1', 'poisoned_archive', 3), rec('a2', 'poisoned_archive', 1),
      // Case 02: 3 runs, all found 3 (two solved, one wrong suspect)
      rec('b1', 'crypt_last_witness', 3), rec('b2', 'crypt_last_witness', 3),
      rec('b3', 'crypt_last_witness', 3, { verdict: 'egg_secured_mystery_unsolved', correct: false, deductionCorrect: true }),
      // Case 03: 1 run with 2 of its clues PLUS two foreign (Case 01) ids that must not count toward Case 03
      rec('c1', 'midnight_signal', 2, {}, [...ids('midnight_signal').slice(0, 2), ...ids('poisoned_archive')]),
      // legacy: 3 old ids, no case → excluded by default
      rec('L1', null, 3, { verdict: 'case_solved' }, ['transfer_note', 'master_key', 'greenhouse_trace']),
    ];
    // c1 claims 4 found clues in the record; make sure only its own case's count
    records[5].result!.cluesFound = [...ids('midnight_signal').slice(0, 2), ...ids('poisoned_archive').slice(0, 2)] as ClueId[];
    const all = aggregateSessions(records);
    expect(all.legacyExcluded).toBe(1);
    expect(all.runs).toBe(6);
    // allClues: a1, b1, b2, b3 → 4 of 6 (c1 has 4 ids but only 2 of ITS case)
    expect(all.allCluesPct).toBeCloseTo((100 * 4) / 6, 10);
    const byCase = Object.fromEntries(all.cases.map((c) => [c.caseId, c]));
    expect(byCase.poisoned_archive.allCluesPct).toBe(50);
    expect(byCase.crypt_last_witness.allCluesPct).toBe(100);
    expect(byCase.midnight_signal.allCluesPct).toBe(0);
    // clue rates: each case's three clues over THAT case's runs only (Case 01 clues in c1 never inflate Case 01)
    const rate = (c: CaseId, i: number) => byCase[c].clues.find((x) => x.clueId === ids(c)[i])!;
    expect(rate('poisoned_archive', 0)).toMatchObject({ found: 2, of: 2, rate: 1 });
    expect(rate('poisoned_archive', 1)).toMatchObject({ found: 1, of: 2, rate: 0.5 });
    expect(rate('midnight_signal', 2)).toMatchObject({ found: 0, of: 1, rate: 0 });
    expect(byCase.poisoned_archive.clues.map((c) => c.clueId)).toEqual(ids('poisoned_archive'));
    for (const c of CASE_IDS) expect(byCase[c].clues.every((x) => x.caseId === c)).toBe(true);
    expect(all.clueFindRate.falsified_transfer).toBe(1); // within Case 01, not 3 of 6 runs
    expect(Object.keys(all.clueFindRate)).toHaveLength(9);
    // solving accuracy / accusation outcome per case
    expect(byCase.crypt_last_witness.solvedPctOfFinished).toBeCloseTo((100 * 2) / 3, 10);
    expect(byCase.crypt_last_witness.accusation).toMatchObject({ solved: 2, wrongSuspect: 1, rightSuspectWrongEvidence: 0 });
    expect(byCase.crypt_last_witness.accusation.deductionCorrectPctOfAccused).toBe(100); // evidence right even for the wrong suspect
    expect(byCase.crypt_last_witness.accusation.rightSuspectPctOfAccused).toBeCloseTo((100 * 2) / 3, 10);
    // scoped to one case: only that case, its clues only
    const one = aggregateSessions(records, { caseId: 'poisoned_archive' });
    expect(one.scope).toBe('poisoned_archive');
    expect(one.runs).toBe(2);
    expect(one.clueRates.map((c) => c.clueId)).toEqual(ids('poisoned_archive'));
    expect(one.allCluesPct).toBe(50);
    expect(one.medianTimeS).toBe((103 + 101) / 2);
    // the per-case table does not depend on the scope
    expect(one.cases).toEqual(all.cases);
    // legacy records only join the combined view on request, never a case view
    const withLegacy = aggregateSessions(records, { legacy: 'include' });
    expect(withLegacy.runs).toBe(7);
    expect(withLegacy.legacyExcluded).toBe(0);
    expect(withLegacy.clueRates.filter((c) => c.caseId === null).map((c) => c.clueId)).toEqual(['greenhouse_trace', 'master_key', 'transfer_note']);
    expect(aggregateSessions(records, { caseId: 'poisoned_archive', legacy: 'include' }).runs).toBe(2);
    expect(scopeRecords(records, { caseId: 'midnight_signal' }).records.map((r) => r.sessionId)).toEqual(['c1']);
    // the pre-case API (clue id array) means "everything, combined"
    expect(aggregateSessions(records, ['x']).runs).toBe(7);
  });

  it('per-case summary: runs, solving accuracy, median time, extraction rate, usage (no names of the accused anywhere)', () => {
    const records = [
      rec('a1', 'poisoned_archive', 3),
      { ...rec('a2', 'poisoned_archive', 1), result: { outcome: 'dnf', verdict: 'not_accused', activeTimeS: 50, score: null, cluesFound: [], catches: 2 } } as SessionRecord,
      rec('b1', 'crypt_last_witness', 3),
    ];
    const a = aggregateSessions(records);
    const c1 = a.cases[0];
    expect(c1).toMatchObject({ caseId: 'poisoned_archive', number: '01', title: 'The Poisoned Archive', runs: 2, finished: 1, dnf: 1, extractionPct: 50, solvedPctOfFinished: 100, medianTimeS: 103 });
    expect(c1.accusation.dnf).toBe(1);
    expect(c1.characters).toEqual([{ id: 'enid', runs: 2 }]);
    expect(c1.duos[0]).toEqual({ characterId: 'enid', pokemonId: 'gengar', runs: 2 });
    expect(a.combined).toMatchObject({ caseId: 'all', runs: 3, finished: 2 });
    expect(JSON.stringify(a)).not.toMatch(/thornhill|isaac|barry|Thornhill|Isaac|Barry/);
  });
});

describe('case-rule failure reasons', () => {
  const t0 = stamp([
    [5, { type: 'clue_found', clueId: 'sabotaged_gate', cluesFound: 1 }],
    [9, { type: 'clue_found', clueId: 'tunnel_access_record', cluesFound: 2 }],
    [40, { type: 'egg_delivered', tier: 'rare', points: 3, security: 90 }],
  ]);
  const withAcc = (acc: Partial<Extract<StampedEvent, { type: 'accusation' }>>, verdict: 'case_solved' | 'egg_secured_mystery_unsolved' | 'not_accused') => [
    ...t0,
    { type: 'accusation', suspectId: 'isaac', correct: true, cluesFound: 2, evidence: [], deductionCorrect: false, ...acc, t: 41, seq: 4 } as StampedEvent,
    { type: 'finish', verdict, score: 259, t: 41, seq: 5 } as StampedEvent,
  ];

  it('flags "right suspect, wrong evidence" and names the missed clue of THIS case', () => {
    const ev = withAcc({ correct: true, deductionCorrect: false, evidence: ['sabotaged_gate', 'note_bell_rope'] }, 'egg_secured_mystery_unsolved');
    expect(accusationKind({ events: ev })).toBe('right_suspect_wrong_evidence');
    const items = diagnoseCaseReasons(ev, { caseId: 'crypt_last_witness' });
    expect(items.map((i) => i.code)).toEqual(['weak_evidence', 'missed_clue']);
    expect(items.every((i) => i.kind === 'case')).toBe(true);
    expect(items[0].evidenceSeq).toEqual([4, 5]);
    expect(items[0].text).toMatch(/^0:41 · Right suspect, but the cited evidence was not the full chain/);
    expect(items[1]).toMatchObject({ ref: 'equipment_match' });
    expect(items[1].text).toContain('“Groundskeeper’s Tool Roll” (Egg Chamber)');
    // never names a suspect
    for (const it of items) expect(it.text).not.toMatch(/Thornhill|Isaac|Barry|Marilyn|Night|Dort/);
  });

  it('wrong suspect vs not accused vs DNF before accusing vs solved', () => {
    expect(diagnoseCaseReasons(withAcc({ correct: false, deductionCorrect: false }, 'egg_secured_mystery_unsolved'), { caseId: 'crypt_last_witness' })[0])
      .toMatchObject({ code: 'wrong_suspect', text: '0:41 · The accused suspect was not the culprit of Case 02 · The Crypt’s Last Witness.' });
    expect(diagnoseCaseReasons(withAcc({ suspectId: null, correct: false }, 'not_accused'), { caseId: 'crypt_last_witness' })[0].code).toBe('not_accused');
    const dnf = stamp([[5, { type: 'catch', catchNumber: 1, hpLost: 35, eggSecurityLost: 0, blocked: false }], [9, { type: 'catch', catchNumber: 2, hpLost: 35, eggSecurityLost: 0, blocked: false }], [9, { type: 'dnf', reason: 'second_catch' }]]);
    const d = diagnoseCaseReasons(dnf, { caseId: 'midnight_signal' });
    expect(d.map((x) => x.code)).toEqual(['dnf_before_accusation', 'missed_clue', 'missed_clue', 'missed_clue']);
    expect(d.slice(1).map((x) => x.ref)).toEqual(ids('midnight_signal'));
    expect(d[1].text).toContain('Rewritten Patrol Log');
    // failure reasons for the results panel = case reasons + stealth mistakes
    const rep = diagnoseSession(dnf, { caseId: 'midnight_signal' });
    expect(failureReasons(rep).map((x) => x.code)).toEqual(['dnf_before_accusation', 'missed_clue', 'missed_clue', 'missed_clue', 'catch', 'dnf_second_catch']);
    // solved → nothing to explain
    const all3 = [...t0.slice(0, 2), { type: 'clue_found', clueId: 'equipment_match', cluesFound: 3, t: 20, seq: 3 } as StampedEvent];
    const solved = [...all3, { type: 'accusation', suspectId: 'isaac', correct: true, cluesFound: 3, evidence: ids('crypt_last_witness'), deductionCorrect: true, t: 41, seq: 4 } as StampedEvent, { type: 'finish', verdict: 'case_solved', score: 300, t: 41, seq: 5 } as StampedEvent];
    expect(diagnoseCaseReasons(solved, { caseId: 'crypt_last_witness' })).toEqual([]);
    expect(failureReasons(diagnoseSession(solved, { caseId: 'crypt_last_witness' }))).toEqual([]);
    // still running → nothing yet
    expect(diagnoseCaseReasons(t0, { caseId: 'crypt_last_witness' })).toEqual([]);
  });

  it('works from the result alone (anonymous live rows) and aggregates by case clue titles', () => {
    const records: SessionRecord[] = [
      rec('a', 'poisoned_archive', 2, { verdict: 'egg_secured_mystery_unsolved', correct: true, deductionCorrect: false }),
      rec('b', 'poisoned_archive', 3, { verdict: 'egg_secured_mystery_unsolved', correct: false, deductionCorrect: false }),
      rec('c', 'crypt_last_witness', 3),
      rec('d', 'midnight_signal', 3, { verdict: 'not_accused', correct: false, deductionCorrect: false }),
    ];
    const a = diagnoseCaseReasons([], { caseId: 'poisoned_archive', result: records[0].result });
    expect(a.map((x) => x.code)).toEqual(['weak_evidence', 'missed_clue']);
    expect(a[1].text).toContain('Archive and Greenhouse Access Ledger');
    const agg = aggregateDiagnostics(records);
    expect(agg.unsolvedRuns).toBe(3);
    const by = Object.fromEntries(agg.caseFailures.map((c) => [c.ref ? `${c.code}:${c.ref}` : c.code, c]));
    expect(by.weak_evidence.count).toBe(1);
    expect(by.wrong_suspect.count).toBe(1);
    expect(by.not_accused.count).toBe(1);
    expect(by['missed_clue:access_ledger']).toMatchObject({ count: 1, caseId: 'poisoned_archive', text: 'Missed “Archive and Greenhouse Access Ledger” (Case 01)' });
    expect(JSON.stringify(agg.caseFailures)).not.toMatch(/thornhill|isaac|barry/i);
  });

  it('on bot episodes of each case every unsolved run explains itself with that case\'s clue titles', () => {
    for (const [i, c] of CASE_IDS.entries()) {
      for (let k = 0; k < 2; k++) {
        const ep = episode({ characterId: 'gomez', pokemonId: 'froslass' }, `case-diag-${i}-${k}`, { profile: 'careless', sprintProb: 0.4, accuse: 'guess' }, undefined, c);
        expect(ep.run.caseDef.id).toBe(c);
        const r = recordOf(ep);
        const reasons = diagnoseCaseReasons(r.events, { caseId: c, result: r.result });
        if (ep.result?.verdict === 'case_solved') expect(reasons).toEqual([]);
        else expect(reasons.length).toBeGreaterThan(0);
        const titles = CASES[c].clues.map((x) => x.title);
        for (const it of reasons.filter((x) => x.code === 'missed_clue')) expect(titles.some((t) => it.text.includes(t))).toBe(true);
        const d = describeSession({ duo: ep.duo, events: r.events, result: ep.result, caseId: c });
        expect(d.clues.total).toBe(CASES[c].clues.length);
        expect(d.clues.missing.map((m) => m.clueId)).toEqual(CASES[c].clues.filter((x) => !ep.result!.cluesFound.includes(x.id)).map((x) => x.id));
      }
    }
  }, 120_000);
});

describe('board scope policy (LOCAL DEMO and LIVE boards)', () => {
  it('case-aware as soon as one record has a case id; otherwise combined-only with every record', async () => {
    const { boardOptions, dashboard } = await import('../../../src/mystery/analytics/index.ts');
    const legacy = rec('L', null, 3, { verdict: 'case_solved' }, ['transfer_note', 'master_key', 'greenhouse_trace']);
    const c2 = rec('c2', 'crypt_last_witness', 3);
    const onlyLegacy = boardOptions([legacy], 'crypt_last_witness');
    expect(onlyLegacy).toEqual({ caseAware: false, options: { caseId: 'all', legacy: 'include' } });
    expect(dashboard([legacy], onlyLegacy.options).descriptive.runs).toBe(1);
    const mixed = boardOptions([legacy, c2], 'crypt_last_witness');
    expect(mixed).toEqual({ caseAware: true, options: { caseId: 'crypt_last_witness', legacy: 'exclude' } });
    const d = dashboard([legacy, c2], mixed.options);
    expect(d.scope).toBe('crypt_last_witness');
    expect(d.descriptive.runs).toBe(1);
    expect(d.descriptive.legacyExcluded).toBe(1);
    expect(d.diagnostic.unsolvedRuns).toBe(0);
  });
});
