// mystery-v3.1 Edge Function logic (pure parts): request parsers, event validation rules, resend dedupe, server-side
// result recomputation, offer generation/sanity, and parity with the SQL score CHECK. Run after `npm run sync:shared`.
import { describe, expect, it } from 'vitest';
import { HttpError, HTTP_STATUS, fromRpcEnvelope } from '../../functions/_shared/errors.ts';
import {
  applyBatch, applyEvent, initialProgress, parseEvent, parseEventBatch, progressFromRow, ruleFingerprint, splitResend,
  type MysteryProgress, type ParsedEvent, type RulesContext,
} from '../../functions/_shared/mystery-events.ts';
import {
  PLAYER_MAX_HP, assertValidOffer, caseReveal, caseVersions, computeOffer, computeResult, expectedEggTier, requireData, requireEggRules,
  resolveCase, revealedClues, rulesContext, type SessionCase,
} from '../../functions/_shared/mystery-rules.ts';
import {
  parseForecast, parseMysteryAppend, parseMysteryCreate, parseMysteryFinalize, parseMysteryGet, parseMysterySelect,
  parseRecommendation,
} from '../../functions/_shared/mystery-validation.ts';
import { parseAdminReset } from '../../functions/_shared/validation.ts';
import { round1, scoreFor } from '../../functions/_shared/mystery/scoring.ts';
import { CASE_IDS, CLUE_IDS, SUSPECT_IDS, type CaseId, type DuoOffer } from '../../functions/_shared/mystery/types.ts';

/** These tests pin the LEGACY mystery-v3.1 rules (v3.1 history stays verifiable/readable); v4 lives in mystery-v4.test.ts. */
const V31 = 'mystery-v3.1' as const;
const computeV31 = (...a: [Parameters<typeof computeResult>[0], Parameters<typeof computeResult>[1], Parameters<typeof computeResult>[2], Parameters<typeof computeResult>[3]?]) =>
  computeResult(a[0], a[1], a[2], a[3], V31);

const SID = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b';
const ACT = 'a1b2c3d4-e5f6-4711-8899-aabbccddeeff';
const SEED = '0123456789abcdef0123456789abcdef';

// The real case 01 + the server's own answer key (generated registry), at its DEPLOYED version (v1 before the
// overhaul, v2 after it). Clues: A = falsified_transfer, B = botanical_residue, L = access_ledger; culprit thornhill;
// notes note_drain_mud / note_keys_jangling.
const CASE: SessionCase = resolveCase('poisoned_archive', requireData().cases.poisoned_archive.version);
const ALL = ['falsified_transfer', 'botanical_residue', 'access_ledger'];
const CTX: RulesContext = {
  clueIds: ALL as RulesContext['clueIds'], suspectIds: ['thornhill', 'isaac', 'barry'],
  eggPoints: { common: 1, rare: 3, legendary: 6 }, expectedTier: 'rare',
};

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof HttpError) return `${e.code}:${(e.details?.rule as string) ?? (e.details?.field as string) ?? ''}`;
    throw e;
  }
  return 'no-error';
}

let seqNo = 0;
const ev = (type: string, payload: Record<string, unknown> = {}, t = seqNo): ParsedEvent =>
  parseEvent({ type, t, seq: seqNo++, ...payload }, 0);

/** A complete, valid finished run (honest claims for case 01 unless overridden). */
function solvedRun(opts: {
  clues?: string[]; suspect?: string | null; t?: number; tier?: string; points?: number; evidence?: string[];
  correct?: boolean; deduction?: boolean; verdict?: string;
} = {}): ParsedEvent[] {
  seqNo = 0;
  const clues = opts.clues ?? ALL;
  const suspect = opts.suspect === undefined ? 'thornhill' : opts.suspect;
  const evidence = opts.evidence ?? (suspect === null ? [] : clues);
  const t = opts.t ?? 245.67;
  const out = [ev('stance', { stance: 'crouch' }, 1)];
  clues.forEach((c, i) => out.push(ev('clue_found', { clueId: c, cluesFound: i + 1 }, 10 + i)));
  out.push(ev('egg_pickup', {}, 100));
  out.push(ev('egg_drop', { reason: 'grab', security: 65 }, 120));
  out.push(ev('egg_pickup', {}, 130));
  out.push(ev('egg_delivered', { tier: opts.tier ?? 'rare', points: opts.points ?? 3, security: 65 }, t));
  const solved = suspect === 'thornhill' && clues.length === 3 && new Set(evidence).size === 3 && ALL.every((c) => evidence.includes(c));
  const correct = opts.correct ?? suspect === 'thornhill';
  const deduction = opts.deduction ?? (suspect !== null && new Set(evidence).size === 3 && ALL.every((c) => evidence.includes(c) && clues.includes(c)));
  const verdict = opts.verdict ?? (suspect === null ? 'not_accused' : solved ? 'case_solved' : 'egg_secured_mystery_unsolved');
  out.push(ev('accusation', { suspectId: suspect, correct, cluesFound: clues.length, evidence, deductionCorrect: deduction }, t));
  out.push(ev('finish', { verdict, score: scoreFor(opts.points ?? 3, t) }, t));
  return out;
}

const run = (events: ParsedEvent[], ctx: RulesContext = CTX): MysteryProgress => applyBatch(initialProgress(), events, ctx);

// ------------------------------------------------------------------------------------------------- parsing
describe('event parsing', () => {
  it('accepts a StampedEvent and splits off seq/t/type', () => {
    expect(parseEvent({ type: 'clue_found', t: 3.5, seq: 7, clueId: 'access_ledger', cluesFound: 1 }, 0))
      .toEqual({ seq: 7, t: 3.5, type: 'clue_found', payload: { clueId: 'access_ledger', cluesFound: 1 } });
  });
  it('rejects unknown types, bad seq/t, wrong payload types and extra keys on rule events', () => {
    expect(code(() => parseEvent({ type: 'teleport', t: 1, seq: 0 }, 0))).toBe('EVENT_REJECTED:type');
    expect(code(() => parseEvent({ type: 'egg_pickup', t: -1, seq: 0 }, 0))).toBe('EVENT_REJECTED:t');
    expect(code(() => parseEvent({ type: 'egg_pickup', t: Number.NaN, seq: 0 }, 0))).toBe('EVENT_REJECTED:t');
    expect(code(() => parseEvent({ type: 'egg_pickup', t: 1, seq: 1.5 }, 0))).toBe('EVENT_REJECTED:seq');
    expect(code(() => parseEvent({ type: 'egg_pickup', t: 1, seq: 0, points: 6 }, 0))).toBe('EVENT_REJECTED:payload');
    expect(code(() => parseEvent({ type: 'catch', t: 1, seq: 0, catchNumber: 3, hpLost: 35, eggSecurityLost: 0, blocked: false }, 0)))
      .toBe('EVENT_REJECTED:payload');
    expect(code(() => parseEvent({ type: 'egg_delivered', t: 1, seq: 0, tier: 'mythic', points: 6, security: 9 }, 0))).toBe('EVENT_REJECTED:payload');
  });
  it('tolerates a few extra primitive keys on cosmetic events, but not objects', () => {
    expect(parseEvent({ type: 'stance', t: 1, seq: 0, stance: 'walk', debug: 'x' }, 0).payload).toEqual({ stance: 'walk', debug: 'x' });
    expect(code(() => parseEvent({ type: 'stance', t: 1, seq: 0, stance: 'walk', blob: { a: 1 } }, 0))).toBe('EVENT_REJECTED:payload');
  });
  it('batches must be strictly increasing in seq and not go back in time', () => {
    const a = { type: 'hint_requested', t: 2, seq: 4 };
    expect(code(() => parseEventBatch([a, { ...a, seq: 4 }], false))).toBe('EVENT_REJECTED:order');
    expect(code(() => parseEventBatch([a, { ...a, seq: 5, t: 1 }], false))).toBe('EVENT_REJECTED:order');
    expect(code(() => parseEventBatch([], false))).toBe('INVALID_INPUT:events');
    expect(code(() => parseEventBatch(Array.from({ length: 501 }, (_, i) => ({ ...a, seq: i })), false))).toBe('INVALID_INPUT:events');
  });
});

// ------------------------------------------------------------------------------------------------- rules
describe('event order rules', () => {
  it('accepts a full solved run and tracks the rule state', () => {
    const p = run(solvedRun());
    expect(p.cluesFound).toEqual(ALL);
    expect(p.delivered).toMatchObject({ tier: 'rare', points: 3, t: 245.67 });
    expect(p.accusation?.suspectId).toBe('thornhill');
    expect(p.terminal?.type).toBe('finish');
    expect(p.pickups).toBe(2);
  });
  const base = () => { seqNo = 0; return [] as ParsedEvent[]; };
  it('clue ids must be valid and unique, with a consistent count', () => {
    base();
    expect(code(() => run([ev('clue_found', { clueId: 'diary', cluesFound: 1 })]))).toBe('EVENT_REJECTED:clue_unknown');
    base();
    expect(code(() => run([ev('clue_found', { clueId: 'access_ledger', cluesFound: 1 }), ev('clue_found', { clueId: 'access_ledger', cluesFound: 2 })])))
      .toBe('EVENT_REJECTED:clue_duplicate');
    base();
    expect(code(() => run([ev('clue_found', { clueId: 'access_ledger', cluesFound: 2 })]))).toBe('EVENT_REJECTED:clue_count');
    base();
    // a clue of ANOTHER case is unknown in this session's case
    expect(code(() => run([ev('clue_found', { clueId: 'sabotaged_gate', cluesFound: 1 })]))).toBe('EVENT_REJECTED:clue_unknown');
    base();
    expect(code(() => run([ev('clue_found', { clueId: 'master_key', cluesFound: 1 })]))).toBe('EVENT_REJECTED:clue_unknown');
  });
  it('egg_pickup must precede egg_drop / egg_delivered; no double pickup', () => {
    base();
    expect(code(() => run([ev('egg_delivered', { tier: 'rare', points: 3, security: 100 })]))).toBe('EVENT_REJECTED:egg_order');
    base();
    expect(code(() => run([ev('egg_drop', { reason: 'manual', security: 100 })]))).toBe('EVENT_REJECTED:egg_order');
    base();
    expect(code(() => run([ev('egg_pickup'), ev('egg_pickup')]))).toBe('EVENT_REJECTED:egg_order');
    base();
    expect(code(() => run([ev('egg_pickup'), ev('egg_drop', { reason: 'grab', security: 50 }),
      ev('egg_delivered', { tier: 'rare', points: 3, security: 50 })]))).toBe('EVENT_REJECTED:egg_order');
  });
  it('the delivered tier must be the seed tier and points must match the tier', () => {
    base();
    expect(code(() => run([ev('egg_pickup'), ev('egg_delivered', { tier: 'legendary', points: 6, security: 100 })]))).toBe('EVENT_REJECTED:egg_tier');
    base();
    expect(code(() => run([ev('egg_pickup'), ev('egg_delivered', { tier: 'rare', points: 6, security: 100 })]))).toBe('EVENT_REJECTED:egg_points');
    base();
    expect(run([ev('egg_pickup'), ev('egg_delivered', { tier: 'legendary', points: 6, security: 100 })], { ...CTX, expectedTier: null }).delivered?.points).toBe(6);
  });
  it('accusation only after egg_delivered, exactly once; finish only after the accusation', () => {
    base();
    expect(code(() => run([ev('accusation', { suspectId: 'thornhill', correct: true, cluesFound: 0, evidence: [], deductionCorrect: false })])))
      .toBe('EVENT_REJECTED:accusation_order');
    const full = solvedRun();
    const acc = full.find((e) => e.type === 'accusation')!;
    expect(code(() => run([...full.slice(0, -1), { ...acc, seq: 99 }]))).toBe('EVENT_REJECTED:accusation_duplicate');
    seqNo = 0;
    const noAcc = solvedRun().filter((e) => e.type !== 'accusation');
    expect(code(() => run(noAcc))).toBe('EVENT_REJECTED:finish_order');
    expect(code(() => run([...solvedRun().slice(0, -2), { ...acc, seq: 98, payload: { ...acc.payload, suspectId: 'hyde' } }])))
      .toBe('EVENT_REJECTED:suspect_unknown');
  });
  it('accusation may be null ("leave the case unsolved")', () => {
    expect(run(solvedRun({ suspect: null })).accusation?.suspectId).toBeNull();
  });
  it('accusation payload: evidence (<= 5 short strings) and deductionCorrect are required; kept raw for finalize', () => {
    const acc = (payload: Record<string, unknown>) => parseEvent({ type: 'accusation', t: 1, seq: 0, ...payload }, 0);
    const ok = { suspectId: 'isaac', correct: false, cluesFound: 2, evidence: ['falsified_transfer', 'forged_id'], deductionCorrect: false };
    expect(acc(ok).payload.evidence).toEqual(['falsified_transfer', 'forged_id']);
    expect(code(() => acc({ ...ok, evidence: undefined }))).toBe('EVENT_REJECTED:payload');
    expect(code(() => acc({ ...ok, deductionCorrect: undefined }))).toBe('EVENT_REJECTED:payload');
    expect(code(() => acc({ ...ok, evidence: ['a', 'b', 'c', 'd', 'e', 'f'] }))).toBe('EVENT_REJECTED:payload');
    expect(code(() => acc({ ...ok, evidence: ['x'.repeat(41)] }))).toBe('EVENT_REJECTED:payload');
    expect(code(() => acc({ ...ok, evidence: [{ id: 'x' }] }))).toBe('EVENT_REJECTED:payload');
    expect(code(() => acc({ ...ok, culprit: 'barry' }))).toBe('EVENT_REJECTED:payload');
    const p = run(solvedRun({ suspect: 'isaac', evidence: ['falsified_transfer', 'forged_id'] }));
    expect(p.accusation).toMatchObject({ suspectId: 'isaac', evidence: ['falsified_transfer', 'forged_id'], claimedDeduction: false });
  });
  it('at most one terminal event and nothing after it', () => {
    const full = solvedRun();
    expect(code(() => run([...full, { seq: 500, t: 999, type: 'dnf', payload: { reason: 'hp_depleted' } }]))).toBe('EVENT_REJECTED:after_terminal');
    expect(code(() => run([...full, { seq: 500, t: 999, type: 'noise', payload: { source: 'footstep', x: 0, z: 0, loudness: 0.3, radiusM: 7 } }])))
      .toBe('EVENT_REJECTED:after_terminal');
  });
  it('catches are numbered 1 then 2; second_catch DNF needs catch #2; no catch/DNF/clue after the deposit', () => {
    const c = (n: number) => ev('catch', { catchNumber: n, hpLost: 35, eggSecurityLost: 0, blocked: false });
    base();
    expect(code(() => run([c(2)]))).toBe('EVENT_REJECTED:catch_order');
    base();
    expect(code(() => run([c(1), ev('dnf', { reason: 'second_catch' })]))).toBe('EVENT_REJECTED:dnf_reason');
    base();
    expect(run([c(1), c(2), ev('dnf', { reason: 'second_catch' })]).terminal).toMatchObject({ type: 'dnf', reason: 'second_catch' });
    const delivered = solvedRun().slice(0, -2);
    const after = (type: string, payload: Record<string, unknown>) => [...delivered, { seq: 300, t: 300, type, payload } as ParsedEvent];
    expect(code(() => run(after('catch', { catchNumber: 1, hpLost: 35, eggSecurityLost: 0, blocked: false })))).toBe('EVENT_REJECTED:catch_after_deposit');
    expect(code(() => run(after('dnf', { reason: 'hp_depleted' })))).toBe('EVENT_REJECTED:dnf_after_deposit');
    seqNo = 0;
    const twoClues = solvedRun({ clues: ['access_ledger', 'falsified_transfer'] }).slice(0, -2);
    expect(code(() => run([...twoClues, { seq: 300, t: 300, type: 'clue_found', payload: { clueId: 'botanical_residue', cluesFound: 3 } }])))
      .toBe('EVENT_REJECTED:clue_after_deposit');
  });
  it('seq/t monotonic across batches; applyBatch never mutates its input', () => {
    const p0 = run(solvedRun().slice(0, 3));
    const frozen = JSON.stringify(p0);
    expect(code(() => applyBatch(p0, [{ seq: 1, t: 50, type: 'hint_requested', payload: {} }], CTX))).toBe('EVENT_REJECTED:order');
    expect(code(() => applyBatch(p0, [{ seq: 50, t: 0, type: 'hint_requested', payload: {} }], CTX))).toBe('EVENT_REJECTED:order');
    expect(JSON.stringify(p0)).toBe(frozen);
  });
  it('replaying only the rule events reproduces the incremental rule state (finalize cross-check)', () => {
    const all = solvedRun();
    const incremental = applyBatch(applyBatch(initialProgress(), all.slice(0, 4), CTX), all.slice(4), CTX);
    const ruleOnly = run(all.filter((e) => e.type !== 'stance'));
    expect(ruleFingerprint(ruleOnly)).toBe(ruleFingerprint(incremental));
    expect(ruleFingerprint(progressFromRow(JSON.parse(JSON.stringify(incremental))))).toBe(ruleFingerprint(incremental));
    expect(progressFromRow({})).toEqual(initialProgress());
  });
  it('the fingerprint ignores object key order (jsonb reorders keys; regression found by the PGlite round-trip)', () => {
    const p = run(solvedRun());
    const reorder = (x: unknown): unknown => Array.isArray(x) ? x.map(reorder)
      : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).reverse().map(([k, v]) => [k, reorder(v)])) : x;
    const shuffled = progressFromRow(reorder(JSON.parse(JSON.stringify(p))));
    expect(JSON.stringify(shuffled)).not.toBe(JSON.stringify(p));
    expect(ruleFingerprint(shuffled)).toBe(ruleFingerprint(p));
  });
});

describe('resend dedupe', () => {
  const stored = new Map<number, ParsedEvent>([[4, { seq: 4, t: 2.5, type: 'stance', payload: { stance: 'walk' } }]]);
  it('identical resends are duplicates, newer events are fresh', () => {
    const out = splitResend([{ seq: 4, t: 2.5, type: 'stance', payload: { stance: 'walk' } }, { seq: 6, t: 3, type: 'hint_requested', payload: {} }], 4, stored);
    expect(out.duplicates).toBe(1);
    expect(out.fresh.map((e) => e.seq)).toEqual([6]);
  });
  it('a different event under a stored seq, or a never-stored old seq, is a SEQ_CONFLICT', () => {
    expect(code(() => splitResend([{ seq: 4, t: 2.5, type: 'stance', payload: { stance: 'sprint' } }], 4, stored))).toBe('SEQ_CONFLICT:');
    expect(code(() => splitResend([{ seq: 3, t: 1, type: 'hint_requested', payload: {} }], 4, stored))).toBe('SEQ_CONFLICT:');
  });
});

// ------------------------------------------------------------------------------------------------- result
describe('server-side result recomputation', () => {
  it('all clues + culprit + exactly the supporting evidence -> case_solved; score = round1(points x 100 - activeTimeS)', () => {
    const r = computeV31(run(solvedRun()), CASE, 'rare');
    expect(r).toMatchObject({ outcome: 'finished', verdict: 'case_solved', accused: 'thornhill', correct: true, eggTier: 'rare',
      eggPoints: 3, activeTimeS: 245.7, score: 54.3, claimMatches: true, dnfReason: null, caseId: 'poisoned_archive', caseVersion: CASE.caseDef.version,
      deductionCorrect: true });
    expect([...r.evidence].sort()).toEqual([...ALL].sort());
  });
  it('wrong suspect, the culprit with missing clues, or weak evidence -> egg_secured_mystery_unsolved; null -> not_accused', () => {
    expect(computeV31(run(solvedRun({ suspect: 'isaac' })), CASE, 'rare')).toMatchObject({ verdict: 'egg_secured_mystery_unsolved', correct: false, deductionCorrect: true });
    expect(computeV31(run(solvedRun({ clues: ['access_ledger'] })), CASE, 'rare')).toMatchObject({ verdict: 'egg_secured_mystery_unsolved', correct: true, deductionCorrect: false });
    expect(computeV31(run(solvedRun({ evidence: ['falsified_transfer', 'botanical_residue'] })), CASE, 'rare'))
      .toMatchObject({ verdict: 'egg_secured_mystery_unsolved', correct: true, deductionCorrect: false, claimMatches: true });
    expect(computeV31(run(solvedRun({ evidence: [...ALL, 'note_drain_mud'] })), CASE, 'rare'))
      .toMatchObject({ verdict: 'egg_secured_mystery_unsolved', deductionCorrect: false, evidence: [...ALL, 'note_drain_mud'] });
    expect(computeV31(run(solvedRun({ suspect: null })), CASE, 'rare')).toMatchObject({ verdict: 'not_accused', accused: null, correct: false, outcome: 'finished', evidence: [], deductionCorrect: false });
  });
  it('forged / uncitable evidence ids are dropped (unknown ids, clues of other cases, clues not found) and flag the claim', () => {
    const r = computeV31(run(solvedRun({
      clues: ['falsified_transfer', 'access_ledger'],
      evidence: ['falsified_transfer', 'botanical_residue', 'sabotaged_gate', 'note_keys_jangling', 'culprit_is_thornhill'],
      deduction: false,
    })), CASE, 'rare');
    expect(r.evidence).toEqual(['falsified_transfer', 'note_keys_jangling']); // order kept, uncitable dropped
    expect(r.claimMatches).toBe(false); // the client cited ids the server dropped
    expect(r.clientClaim.accusationEvidence).toContain('culprit_is_thornhill'); // raw claim kept for the audit
  });
  it('a client claiming correct / deductionCorrect / case_solved for a wrong accusation is overruled', () => {
    const lying = solvedRun({ suspect: 'barry', correct: true, deduction: true, verdict: 'case_solved' });
    const r = computeV31(run(lying), CASE, 'rare', { outcome: 'finished', verdict: 'case_solved', correct: true, deductionCorrect: true,
      score: 54.3, activeTimeS: 245.7 });
    expect(r).toMatchObject({ accused: 'barry', correct: false, verdict: 'egg_secured_mystery_unsolved', claimMatches: false });
    expect(r.deductionCorrect).toBe(true); // the cited chain IS the supporting evidence; only the suspect is wrong
  });
  it('evidence cited with a null suspect is ignored (never an error)', () => {
    const r = computeV31(run(solvedRun({ suspect: null, evidence: ['falsified_transfer'] })), CASE, 'rare');
    expect(r).toMatchObject({ verdict: 'not_accused', evidence: [], deductionCorrect: false, claimMatches: false });
  });
  it('honest runs of EVERY case are solved with their own answer key, and only with it', () => {
    for (const id of CASE_IDS) {
      const kase = resolveCase(id, undefined);
      const clues = kase.caseDef.clues.map((c) => c.id);
      const ctx = rulesContext(SEED, kase.caseDef, requireEggRules(), PLAYER_MAX_HP, V31);
      seqNo = 0;
      const tier = ctx.expectedTier!;
      const pts = requireEggRules().points[tier];
      const events = [
        ...clues.map((c, i) => ev('clue_found', { clueId: c, cluesFound: i + 1 }, 10 + i)),
        ev('egg_pickup', {}, 50), ev('egg_delivered', { tier, points: pts, security: 100 }, 99),
        ev('accusation', { suspectId: kase.solution.culprit, correct: true, cluesFound: 3, evidence: [...clues], deductionCorrect: true }, 99),
        ev('finish', { verdict: 'case_solved', score: scoreFor(pts, 99) }, 99),
      ];
      const r = computeV31(applyBatch(initialProgress(), events, ctx), kase, tier);
      expect(r).toMatchObject({ caseId: id, verdict: 'case_solved', correct: true, deductionCorrect: true, claimMatches: true });
      const innocent = kase.caseDef.suspects.find((s) => s.id !== kase.solution.culprit)!.id;
      const wrong = applyBatch(initialProgress(), events.map((e) => e.type === 'accusation'
        ? { ...e, payload: { ...e.payload, suspectId: innocent } } : e), ctx);
      expect(computeV31(wrong, kase, tier)).toMatchObject({ verdict: 'egg_secured_mystery_unsolved', correct: false });
      // another case's clue ids are unknown here
      const other = CASE_IDS.find((x) => x !== id)!;
      seqNo = 0;
      expect(code(() => applyBatch(initialProgress(), [ev('clue_found', { clueId: resolveCase(other, undefined).caseDef.clues[0]!.id, cluesFound: 1 })], ctx)))
        .toBe('EVENT_REJECTED:clue_unknown');
    }
  });
  it('slow finishers get NEGATIVE scores (still finished)', () => {
    const r = computeV31(run(solvedRun({ t: 745.66, tier: 'common', points: 1 }), { ...CTX, expectedTier: 'common' }), CASE, 'common');
    expect([r.outcome, r.activeTimeS, r.score]).toEqual(['finished', 745.7, -645.7]);
  });
  it('DNF: score null, verdict not_accused, no egg points, tier from the seed', () => {
    seqNo = 0;
    const p = run([ev('catch', { catchNumber: 1, hpLost: 35, eggSecurityLost: 0, blocked: false }, 10),
      ev('catch', { catchNumber: 2, hpLost: 35, eggSecurityLost: 0, blocked: false }, 88.04), ev('dnf', { reason: 'second_catch' }, 88.04)]);
    expect(computeV31(p, CASE, 'legendary', { outcome: 'dnf', score: null, caseId: 'poisoned_archive' })).toMatchObject({
      outcome: 'dnf', dnfReason: 'second_catch', verdict: 'not_accused', score: null, eggPoints: 0, eggTier: 'legendary', activeTimeS: 88, catches: 2, claimMatches: true,
      evidence: [], deductionCorrect: false, caseId: 'poisoned_archive',
    });
    expect(computeV31(p, CASE, 'legendary', { outcome: 'dnf', score: null, caseId: 'midnight_signal' }).claimMatches).toBe(false);
  });
  it('client claims are recorded and compared, never trusted', () => {
    const events = solvedRun();
    const fin = events[events.length - 1];
    const lying = [...events.slice(0, -1), { ...fin, payload: { verdict: 'case_solved', score: 599.9 } }];
    const r = computeV31(run(lying), CASE, 'rare', { outcome: 'finished', score: 599.9, verdict: 'case_solved', activeTimeS: 0.1 });
    expect(r.score).toBe(54.3);
    expect(r.claimMatches).toBe(false);
    expect(r.clientClaim).toMatchObject({ finishScore: 599.9, result: { score: 599.9 } });
  });
  it('refuses to compute a result before a terminal event', () => {
    expect(code(() => computeV31(run(solvedRun().slice(0, -1)), CASE, 'rare'))).toBe('RUN_NOT_FINISHED:');
  });
  it('shared scoreFor agrees EXACTLY with the SQL CHECK score = points*100 - active_time_s (integer tenths)', () => {
    const bad: string[] = [];
    for (let i = 0; i < 20000; i++) {
      const t = i * 0.0731 + (i % 7) * 0.00049;
      for (const points of [1, 3, 6]) {
        const s = scoreFor(points, t);
        const tenths = Math.round(s * 10);
        if (tenths !== points * 1000 - Math.round(round1(t) * 10) || Math.abs(s * 10 - tenths) > 1e-6) bad.push(`${points}@${t}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------- offer
describe('server offer (shared draftOffer)', () => {
  it('real data registries and egg rules are bound', () => {
    expect(() => requireData()).not.toThrow();
    expect(requireEggRules().points).toEqual({ common: 1, rare: 3, legendary: 6 });
    expect(code(() => requireData(null))).toBe('MISCONFIGURED:');
  });
  it('same seed -> same three valid, distinct cards; different seeds vary', () => {
    const a = computeOffer(SEED);
    expect(computeOffer(SEED)).toEqual(a);
    expect(a.cards).toHaveLength(3);
    const keys = new Set<string>();
    for (let i = 0; i < 150; i++) {
      const seed = (i.toString(16).padStart(4, '0') + SEED).slice(0, 32);
      const o = computeOffer(seed); // asserts validity internally
      keys.add(o.cards.map((c) => `${c.characterId}:${c.pokemonId}`).join('|'));
    }
    expect(keys.size).toBeGreaterThan(100);
  });
  it('the sanity check refuses tampered offers', () => {
    const good = computeOffer(SEED);
    const clone = (): DuoOffer => JSON.parse(JSON.stringify(good));
    const dup = clone(); dup.cards[1] = dup.cards[0];
    const stat = clone(); stat.cards[2].stats.stealth = 9;
    const id = clone(); (id.cards[0] as { characterId: string }).characterId = 'xavier';
    for (const bad of [dup, stat, id]) expect(code(() => assertValidOffer(bad, SEED))).toBe('INTERNAL:');
    expect(code(() => assertValidOffer(good, 'f'.repeat(32)))).toBe('INTERNAL:');
  });
  it('the registry binds all three cases with matching answer keys; versions per case', () => {
    const data = requireData();
    expect(Object.keys(data.cases).sort()).toEqual([...CASE_IDS].sort());
    expect(Object.keys(data.variants).sort()).toEqual([...CASE_IDS].sort());
    for (const id of CASE_IDS) expect(Object.keys(data.variants[id]).sort(), id).toEqual([...SUSPECT_IDS].sort());
    const versions = caseVersions();
    for (const id of CASE_IDS) expect(versions[id]).toBe(data.cases[id].version);
    expect(new Set(CASE_IDS.flatMap((id) => data.cases[id].clues.map((c) => c.id)))).toEqual(new Set(CLUE_IDS));
  });
  it('resolveCase: unknown case -> INTERNAL, stale session version -> CASE_OUTDATED, mismatched key -> MISCONFIGURED', () => {
    expect(code(() => resolveCase('silent_evidence', 1))).toBe('INTERNAL:');
    expect(code(() => resolveCase('midnight_signal', 99))).toBe('CASE_OUTDATED:');
    const data = requireData();
    const broken = { ...data, variants: { ...data.variants, crypt_last_witness: data.variants.midnight_signal } };
    expect(code(() => resolveCase('crypt_last_witness', undefined, broken))).toBe('MISCONFIGURED:');
    // a variant filed under the wrong murderer is refused too
    const swapped = { ...data, variants: { ...data.variants, midnight_signal: { ...data.variants.midnight_signal, barry: data.variants.midnight_signal.galpin } } };
    expect(code(() => resolveCase('midnight_signal', undefined, swapped, 'barry'))).toBe('MISCONFIGURED:');
    // the session's murderer picks the variant; its found clue texts are released, unfound ones never
    const k = resolveCase('midnight_signal', undefined, data, 'galpin');
    expect(k.solution.culprit).toBe('galpin');
    expect(Object.keys(revealedClues(k, ['alarm_override']))).toEqual(['alarm_override']);
    expect(revealedClues(k, [])).toEqual({});
    expect(HTTP_STATUS.CASE_OUTDATED).toBe(409);
  });
  it('caseReveal: culprit + resolution only for a finished run', () => {
    expect(caseReveal(CASE, 'finished')).toEqual({ culprit: 'thornhill', resolution: CASE.solution.resolution });
    expect(caseReveal(CASE, 'dnf')).toBeNull();
  });
  it('rules context comes from the SESSION case; the seed tier is deterministic and roughly 50/35/15', () => {
    const data = requireData();
    const ctx = rulesContext(SEED, data.cases.poisoned_archive, requireEggRules());
    expect([...ctx.clueIds].sort()).toEqual([...ALL].sort());
    const byCase = (id: CaseId) => [...rulesContext(SEED, data.cases[id], requireEggRules()).clueIds].sort();
    expect(byCase('crypt_last_witness')).toEqual(['equipment_match', 'sabotaged_gate', 'tunnel_access_record']);
    expect(byCase('midnight_signal')).toEqual(['alarm_override', 'falsified_patrol_log', 'watchtower_signal']);
    expect([...ctx.suspectIds].sort()).toEqual(['barry', 'galpin', 'thornhill']); // final wave: Galpin replaces Isaac Night (now Slurp)
    expect(ctx.expectedTier).toBe(expectedEggTier(SEED));
    const n = { common: 0, rare: 0, legendary: 0 };
    for (let i = 0; i < 3000; i++) n[expectedEggTier(i.toString(16).padStart(32, '0'))]++;
    expect(n.common / 3000).toBeGreaterThan(0.44);
    expect(n.legendary / 3000).toBeLessThan(0.2);
  });
});

// ------------------------------------------------------------------------------------------------- bodies
describe('mystery request bodies', () => {
  it('create: sanitized nickname, test seeds only when enabled', () => {
    expect(parseMysteryCreate({ actionId: ACT, nickname: '  Ann  Lee ' }, false)).toEqual({ actionId: ACT, nickname: 'Ann Lee' });
    expect(code(() => parseMysteryCreate({ actionId: ACT, nickname: 'Annie', testSeed: SEED }, false))).toBe('TEST_SEED_FORBIDDEN:testSeed');
    expect(parseMysteryCreate({ actionId: ACT, nickname: 'Annie', testSeed: SEED }, true).testSeed).toBe(SEED);
    expect(code(() => parseMysteryCreate({ actionId: ACT, nickname: 'Annie', seed: SEED }, true))).toBe('INVALID_INPUT:seed');
    expect(code(() => parseMysteryCreate({ actionId: ACT, nickname: 'Annie', stationId: 'station_b' }, false))).toBe('INVALID_INPUT:stationId');
    expect(code(() => parseMysteryCreate({ actionId: 'x', nickname: 'Annie' }, false))).toBe('INVALID_INPUT:actionId');
  });
  it('create: testCase only when test seeds are enabled, only with a testSeed, only a known case', () => {
    expect(parseMysteryCreate({ actionId: ACT, nickname: 'Annie', testSeed: SEED, testCase: 'midnight_signal' }, true))
      .toEqual({ actionId: ACT, nickname: 'Annie', testSeed: SEED, testCase: 'midnight_signal' });
    expect(code(() => parseMysteryCreate({ actionId: ACT, nickname: 'Annie', testCase: 'midnight_signal' }, false))).toBe('TEST_SEED_FORBIDDEN:testCase');
    expect(code(() => parseMysteryCreate({ actionId: ACT, nickname: 'Annie', testCase: 'midnight_signal' }, true))).toBe('INVALID_INPUT:testCase');
    expect(code(() => parseMysteryCreate({ actionId: ACT, nickname: 'Annie', testSeed: SEED, testCase: 'silent_evidence' }, true))).toBe('INVALID_INPUT:testCase');
    expect(code(() => parseMysteryCreate({ actionId: ACT, nickname: 'Annie', caseId: 'midnight_signal' }, true))).toBe('INVALID_INPUT:caseId');
  });
  it('select / get / finalize', () => {
    expect(parseMysterySelect({ sessionId: SID.toUpperCase(), characterId: 'ajax', pokemonId: 'gholdengo' }))
      .toEqual({ sessionId: SID, characterId: 'ajax', pokemonId: 'gholdengo' });
    expect(code(() => parseMysterySelect({ sessionId: SID, characterId: 'xavier', pokemonId: 'gengar' }))).toBe('INVALID_INPUT:characterId');
    expect(code(() => parseMysterySelect({ sessionId: SID, characterId: 'enid', pokemonId: 'gengar', slot: 1 }))).toBe('INVALID_INPUT:slot');
    expect(parseMysteryGet({})).toEqual({});
    const fin = parseMysteryFinalize({ sessionId: SID, clientResult: { score: 12.3, verdict: 'case_solved', duo: { characterId: 'x' },
      cluesFound: ['access_ledger'], evil: 1, caseId: 'poisoned_archive', evidence: ['access_ledger', 'note_drain_mud'], deductionCorrect: false } });
    expect(fin.clientResult).toEqual({ score: 12.3, verdict: 'case_solved', cluesFound: ['access_ledger'], caseId: 'poisoned_archive',
      evidence: ['access_ledger', 'note_drain_mud'], deductionCorrect: false });
    expect(parseMysteryFinalize({ sessionId: SID, clientResult: { evidence: ['a', 'b', 'c', 'd', 'e', 'f'] } }).clientResult).toEqual({});
  });
  it('append: events strict; each forecast / recommendation record strictly validated', () => {
    const body = parseMysteryAppend({
      sessionId: SID,
      events: [{ type: 'hint_requested', t: 1, seq: 0 }],
      forecasts: [{ forecastNo: 0, t: 1, target: 'detection_15s', value: 0.4, modelLabel: 'rule_based', features: { dist: 9, crouched: true } }],
      recommendations: [{ recNo: 0, t: 1, action: 'crouch', advice: 'Crouch <now>', accepted: null }],
    });
    expect(body.recommendations[0].advice).toBe('Crouch now');
    expect(body.forecasts[0].modelVersion).toBeNull();
    expect(body.dropped).toEqual({ forecasts: 0, recommendations: 0, reasons: [] });
    expect(code(() => parseMysteryAppend({ sessionId: SID, events: [] }))).toBe('INVALID_INPUT:events');
    expect(parseMysteryAppend({ sessionId: SID, events: [], recommendations: [{ recNo: 0, t: 1, action: 'hide', advice: 'Hide', accepted: true, outcome: 'escaped' }] }).events).toEqual([]);
    // record-level validation (the same checks decide whether a record is kept)
    expect(code(() => parseForecast({ forecastNo: 0, t: 1, target: 'detection_15s', value: 1.5, modelLabel: 'ml', features: {} }, 0)))
      .toBe('INVALID_INPUT:forecasts[0].value');
    expect(code(() => parseForecast({ forecastNo: 0, t: 1, target: 'detection_15s', value: 0.5, modelLabel: 'neural', features: {} }, 0)))
      .toBe('INVALID_INPUT:forecasts[0].modelLabel');
    expect(code(() => parseRecommendation({ recNo: 0, t: 1, action: 'Hide Now', advice: 'Hide' }, 0))).toBe('INVALID_INPUT:recommendations[0].action');
  });
  it('append: an invalid analytics record is DROPPED and counted, never a rejection (the run stays verifiable)', () => {
    const good = { forecastNo: 1, t: 1, target: 'egg_site', value: 0.5, modelLabel: 'rule_based', features: { site: 'e_shed' } };
    const body = parseMysteryAppend({
      sessionId: SID,
      events: [{ type: 'clue_found', t: 2, seq: 0, clueId: 'access_ledger', cluesFound: 1 }],
      forecasts: [
        { ...good, forecastNo: 0, value: Number.NaN }, // e.g. a 0/0 posterior
        good,
        { ...good, forecastNo: 2, features: { label: 'x'.repeat(41) } },
        { ...good, forecastNo: 3, target: 'tower_eta' }, // a target this deployment does not know yet
        { ...good }, // repeated forecastNo 1
      ],
      recommendations: [{ recNo: 0, t: 1, action: 'hide', advice: 'Hide' }, { recNo: 0, t: 1, action: 'hide', advice: 'Hide' }, 'nonsense'],
    });
    expect(body.events).toHaveLength(1);
    expect(body.forecasts.map((f) => f.forecastNo)).toEqual([1]);
    expect(body.recommendations.map((r) => r.recNo)).toEqual([0]);
    expect(body.dropped.forecasts).toBe(4);
    expect(body.dropped.recommendations).toBe(2);
    expect(body.dropped.reasons).toHaveLength(5); // capped for the log
    expect(body.dropped.reasons[0]).toMatch(/^forecasts\[0\]\.value: /);
    // an analytics-only call whose records were all dropped is still a valid (no-op) request
    expect(parseMysteryAppend({ sessionId: SID, events: [], forecasts: [{ ...good, value: 2 }] })).toMatchObject({ events: [], forecasts: [], dropped: { forecasts: 1 } });
    // the list itself must be well-formed, and events stay strict
    expect(code(() => parseMysteryAppend({ sessionId: SID, events: [], forecasts: { 0: good } }))).toBe('INVALID_INPUT:forecasts');
    expect(code(() => parseMysteryAppend({ sessionId: SID, events: [], forecasts: Array.from({ length: 51 }, (_, i) => ({ ...good, forecastNo: i })) })))
      .toBe('INVALID_INPUT:forecasts');
    expect(code(() => parseMysteryAppend({ sessionId: SID, events: [{ type: 'teleport', t: 1, seq: 0 }], forecasts: [good] }))).toBe('EVENT_REJECTED:type');
  });
  it('admin-reset scope defaults to all and is validated', () => {
    expect(parseAdminReset({ stationId: 'station_a', reason: 'stuck kiosk', actionId: ACT }).scope).toBe('all');
    expect(parseAdminReset({ stationId: 'station_a', reason: 'stuck kiosk', actionId: ACT, scope: 'mystery' }).scope).toBe('mystery');
    expect(code(() => parseAdminReset({ stationId: 'station_a', reason: 'stuck kiosk', actionId: ACT, scope: 'everything' }))).toBe('INVALID_INPUT:scope');
  });
  it('mystery RPC error codes map to the documented statuses', () => {
    const cases: [string, number][] = [['NOT_SELECTED', 409], ['ALREADY_SELECTED', 409], ['DUO_NOT_OFFERED', 422], ['STALE_EVENTS', 409],
      ['EVENT_REJECTED', 422], ['RUN_NOT_FINISHED', 409], ['TOO_MANY_EVENTS', 422]];
    for (const [c, status] of cases) expect([fromRpcEnvelope({ ok: false, error: c, message: 'm' }).code, HTTP_STATUS[c as keyof typeof HTTP_STATUS]]).toEqual([c, status]);
    expect(HTTP_STATUS.SEQ_CONFLICT).toBe(409);
    expect(HTTP_STATUS.TEST_SEED_FORBIDDEN).toBe(403);
  });
});

// keep the reducer import used even if a future refactor drops direct calls above
void applyEvent;
