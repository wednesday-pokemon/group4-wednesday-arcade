// mystery-v3.1 Edge Function logic (pure parts): request parsers, event validation rules, resend dedupe, server-side
// result recomputation, offer generation/sanity, and parity with the SQL score CHECK. Run after `npm run sync:shared`.
import { describe, expect, it } from 'vitest';
import { HttpError, HTTP_STATUS, fromRpcEnvelope } from '../../functions/_shared/errors.ts';
import {
  applyBatch, applyEvent, initialProgress, parseEvent, parseEventBatch, progressFromRow, ruleFingerprint, splitResend,
  type MysteryProgress, type ParsedEvent, type RulesContext,
} from '../../functions/_shared/mystery-events.ts';
import {
  assertValidOffer, computeOffer, computeResult, expectedEggTier, requireData, requireEggRules, rulesContext,
} from '../../functions/_shared/mystery-rules.ts';
import {
  parseMysteryAppend, parseMysteryCreate, parseMysteryFinalize, parseMysteryGet, parseMysterySelect,
} from '../../functions/_shared/mystery-validation.ts';
import { parseAdminReset } from '../../functions/_shared/validation.ts';
import { round1, scoreFor } from '../../functions/_shared/mystery/scoring.ts';
import type { CaseDef, DuoOffer } from '../../functions/_shared/mystery/types.ts';

const SID = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b';
const ACT = 'a1b2c3d4-e5f6-4711-8899-aabbccddeeff';
const SEED = '0123456789abcdef0123456789abcdef';

const CASE: CaseDef = {
  id: 'test_case', title: 'T', victim: 'Orloff', culprit: 'thornhill',
  suspects: [
    { id: 'thornhill', name: 'T', role: 'r', alibiOrContext: 'c' },
    { id: 'isaac', name: 'I', role: 'r', alibiOrContext: 'c' },
    { id: 'barry', name: 'B', role: 'r', alibiOrContext: 'c' },
  ],
  clues: (['transfer_note', 'master_key', 'greenhouse_trace'] as const).map((id) => ({
    id, title: id, roomId: 'crypt' as const, text: 'x', implicates: ['thornhill' as const], exonerates: [], deduction: 'd',
  })),
};
const CTX: RulesContext = {
  clueIds: ['transfer_note', 'master_key', 'greenhouse_trace'], suspectIds: ['thornhill', 'isaac', 'barry'],
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

/** A complete, valid finished run. */
function solvedRun(opts: { clues?: string[]; suspect?: string | null; t?: number; tier?: string; points?: number } = {}): ParsedEvent[] {
  seqNo = 0;
  const clues = opts.clues ?? ['transfer_note', 'master_key', 'greenhouse_trace'];
  const t = opts.t ?? 245.67;
  const out = [ev('stance', { stance: 'crouch' }, 1)];
  clues.forEach((c, i) => out.push(ev('clue_found', { clueId: c, cluesFound: i + 1 }, 10 + i)));
  out.push(ev('egg_pickup', {}, 100));
  out.push(ev('egg_drop', { reason: 'grab', security: 65 }, 120));
  out.push(ev('egg_pickup', {}, 130));
  out.push(ev('egg_delivered', { tier: opts.tier ?? 'rare', points: opts.points ?? 3, security: 65 }, t));
  out.push(ev('accusation', { suspectId: opts.suspect === undefined ? 'thornhill' : opts.suspect, correct: true, cluesFound: clues.length }, t));
  out.push(ev('finish', { verdict: 'case_solved', score: scoreFor(opts.points ?? 3, t) }, t));
  return out;
}

const run = (events: ParsedEvent[], ctx: RulesContext = CTX): MysteryProgress => applyBatch(initialProgress(), events, ctx);

// ------------------------------------------------------------------------------------------------- parsing
describe('event parsing', () => {
  it('accepts a StampedEvent and splits off seq/t/type', () => {
    expect(parseEvent({ type: 'clue_found', t: 3.5, seq: 7, clueId: 'master_key', cluesFound: 1 }, 0))
      .toEqual({ seq: 7, t: 3.5, type: 'clue_found', payload: { clueId: 'master_key', cluesFound: 1 } });
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
    expect(p.cluesFound).toEqual(['transfer_note', 'master_key', 'greenhouse_trace']);
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
    expect(code(() => run([ev('clue_found', { clueId: 'master_key', cluesFound: 1 }), ev('clue_found', { clueId: 'master_key', cluesFound: 2 })])))
      .toBe('EVENT_REJECTED:clue_duplicate');
    base();
    expect(code(() => run([ev('clue_found', { clueId: 'master_key', cluesFound: 2 })]))).toBe('EVENT_REJECTED:clue_count');
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
    expect(code(() => run([ev('accusation', { suspectId: 'thornhill', correct: true, cluesFound: 0 })]))).toBe('EVENT_REJECTED:accusation_order');
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
    const twoClues = solvedRun({ clues: ['master_key', 'transfer_note'] }).slice(0, -2);
    expect(code(() => run([...twoClues, { seq: 300, t: 300, type: 'clue_found', payload: { clueId: 'greenhouse_trace', cluesFound: 3 } }])))
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
  it('all clues + culprit -> case_solved; score = round1(points x 100 - activeTimeS)', () => {
    const r = computeResult(run(solvedRun()), CASE, 'rare');
    expect(r).toMatchObject({ outcome: 'finished', verdict: 'case_solved', accused: 'thornhill', correct: true, eggTier: 'rare',
      eggPoints: 3, activeTimeS: 245.7, score: 54.3, claimMatches: true, dnfReason: null });
  });
  it('wrong suspect, or the culprit with missing clues -> egg_secured_mystery_unsolved; null -> not_accused', () => {
    expect(computeResult(run(solvedRun({ suspect: 'isaac' })), CASE, 'rare')).toMatchObject({ verdict: 'egg_secured_mystery_unsolved', correct: false });
    expect(computeResult(run(solvedRun({ clues: ['master_key'] })), CASE, 'rare')).toMatchObject({ verdict: 'egg_secured_mystery_unsolved', correct: true });
    expect(computeResult(run(solvedRun({ suspect: null })), CASE, 'rare')).toMatchObject({ verdict: 'not_accused', accused: null, correct: false, outcome: 'finished' });
  });
  it('slow finishers get NEGATIVE scores (still finished)', () => {
    const r = computeResult(run(solvedRun({ t: 745.66, tier: 'common', points: 1 }), { ...CTX, expectedTier: 'common' }), CASE, 'common');
    expect([r.outcome, r.activeTimeS, r.score]).toEqual(['finished', 745.7, -645.7]);
  });
  it('DNF: score null, verdict not_accused, no egg points, tier from the seed', () => {
    seqNo = 0;
    const p = run([ev('catch', { catchNumber: 1, hpLost: 35, eggSecurityLost: 0, blocked: false }, 10),
      ev('catch', { catchNumber: 2, hpLost: 35, eggSecurityLost: 0, blocked: false }, 88.04), ev('dnf', { reason: 'second_catch' }, 88.04)]);
    expect(computeResult(p, CASE, 'legendary', { outcome: 'dnf', score: null })).toMatchObject({
      outcome: 'dnf', dnfReason: 'second_catch', verdict: 'not_accused', score: null, eggPoints: 0, eggTier: 'legendary', activeTimeS: 88, catches: 2, claimMatches: true,
    });
  });
  it('client claims are recorded and compared, never trusted', () => {
    const events = solvedRun();
    const fin = events[events.length - 1];
    const lying = [...events.slice(0, -1), { ...fin, payload: { verdict: 'case_solved', score: 599.9 } }];
    const r = computeResult(run(lying), CASE, 'rare', { outcome: 'finished', score: 599.9, verdict: 'case_solved', activeTimeS: 0.1 });
    expect(r.score).toBe(54.3);
    expect(r.claimMatches).toBe(false);
    expect(r.clientClaim).toMatchObject({ finishScore: 599.9, result: { score: 599.9 } });
  });
  it('refuses to compute a result before a terminal event', () => {
    expect(code(() => computeResult(run(solvedRun().slice(0, -1)), CASE, 'rare'))).toBe('RUN_NOT_FINISHED:');
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
  it('rules context comes from the case data; the seed tier is deterministic and roughly 50/35/15', () => {
    const data = requireData();
    const ctx = rulesContext(SEED, data.caseDef, requireEggRules());
    expect([...ctx.clueIds].sort()).toEqual(['greenhouse_trace', 'master_key', 'transfer_note']);
    expect([...ctx.suspectIds].sort()).toEqual(['barry', 'isaac', 'thornhill']);
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
  it('select / get / finalize', () => {
    expect(parseMysterySelect({ sessionId: SID.toUpperCase(), characterId: 'ajax', pokemonId: 'gholdengo' }))
      .toEqual({ sessionId: SID, characterId: 'ajax', pokemonId: 'gholdengo' });
    expect(code(() => parseMysterySelect({ sessionId: SID, characterId: 'xavier', pokemonId: 'gengar' }))).toBe('INVALID_INPUT:characterId');
    expect(code(() => parseMysterySelect({ sessionId: SID, characterId: 'enid', pokemonId: 'gengar', slot: 1 }))).toBe('INVALID_INPUT:slot');
    expect(parseMysteryGet({})).toEqual({});
    const fin = parseMysteryFinalize({ sessionId: SID, clientResult: { score: 12.3, verdict: 'case_solved', duo: { characterId: 'x' }, cluesFound: ['master_key'], evil: 1 } });
    expect(fin.clientResult).toEqual({ score: 12.3, verdict: 'case_solved', cluesFound: ['master_key'] });
  });
  it('append: events + forecasts + recommendations, strictly validated', () => {
    const body = parseMysteryAppend({
      sessionId: SID,
      events: [{ type: 'hint_requested', t: 1, seq: 0 }],
      forecasts: [{ forecastNo: 0, t: 1, target: 'detection_15s', value: 0.4, modelLabel: 'rule_based', features: { dist: 9, crouched: true } }],
      recommendations: [{ recNo: 0, t: 1, action: 'crouch', advice: 'Crouch <now>', accepted: null }],
    });
    expect(body.recommendations[0].advice).toBe('Crouch now');
    expect(body.forecasts[0].modelVersion).toBeNull();
    expect(code(() => parseMysteryAppend({ sessionId: SID, events: [] }))).toBe('INVALID_INPUT:events');
    expect(parseMysteryAppend({ sessionId: SID, events: [], recommendations: [{ recNo: 0, t: 1, action: 'hide', advice: 'Hide', accepted: true, outcome: 'escaped' }] }).events).toEqual([]);
    expect(code(() => parseMysteryAppend({ sessionId: SID, events: [], forecasts: [{ forecastNo: 0, t: 1, target: 'detection_15s', value: 1.5, modelLabel: 'ml', features: {} }] })))
      .toBe('INVALID_INPUT:forecasts[0].value');
    expect(code(() => parseMysteryAppend({ sessionId: SID, events: [], forecasts: [{ forecastNo: 0, t: 1, target: 'detection_15s', value: 0.5, modelLabel: 'neural', features: {} }] })))
      .toBe('INVALID_INPUT:forecasts[0].modelLabel');
    const rec = { recNo: 2, t: 1, action: 'hide', advice: 'Hide' };
    expect(code(() => parseMysteryAppend({ sessionId: SID, events: [], recommendations: [rec, rec] }))).toBe('INVALID_INPUT:recommendations');
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
