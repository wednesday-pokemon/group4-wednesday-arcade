// Joseph Crackstone backend (2026-10-24, docs/overhaul/ENEMY_CONTRACT.md "Server", migration 20261024000100):
// the four Crackstone telemetry types + the `curse` RULE event (rule R7: a landed curse costs HP — it can end the run as a
// dnf 'hp_depleted' — but it is not a catch and never touches the egg), and the `crackstone_risk` forecast target.
// Run after `npm run sync:shared`.
import { describe, expect, it } from 'vitest';
import { HttpError } from '../../functions/_shared/errors.ts';
import {
  CRACKSTONE_TELEMETRY_TYPES, HP_EPSILON, MAX_CURSE_HP, MAX_SCAN_RADIUS_M, RULE_EVENT_TYPES, applyBatch, initialProgress,
  parseEvent, parseEventBatch, progressFromRow, progressSummary, ruleFingerprint, type MysteryProgress, type ParsedEvent,
  type RulesContext,
} from '../../functions/_shared/mystery-events.ts';
import { PLAYER_MAX_HP, computeResult, requireData, requireEggRules, resolveCase, rulesContext } from '../../functions/_shared/mystery-rules.ts';
import { parseMysteryAppend } from '../../functions/_shared/mystery-validation.ts';
import { DEFAULT_TUNING } from '../../functions/_shared/mystery/config.ts';
import { scoreFor } from '../../functions/_shared/mystery/scoring.ts';

/** These tests pin the LEGACY mystery-v3.1 rules (v3.1 history stays verifiable/readable); v4 lives in mystery-v4.test.ts. */
const V31 = 'mystery-v3.1' as const;
const computeV31 = (...a: [Parameters<typeof computeResult>[0], Parameters<typeof computeResult>[1], Parameters<typeof computeResult>[2], Parameters<typeof computeResult>[3]?]) =>
  computeResult(a[0], a[1], a[2], a[3], V31);

const SID = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b';
const SEED = '0123456789abcdef0123456789abcdef';

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof HttpError) return `${e.code}:${(e.details?.rule as string) ?? (e.details?.field as string) ?? ''}`;
    throw e;
  }
  return 'no-error';
}

const ev = (type: string, payload: Record<string, unknown> = {}, seq = 0, t = 1) => parseEvent({ type, t, seq, ...payload }, 0);

/** One valid payload per Crackstone type (exact shapes of the GameEvent union in src/mystery/types.ts). */
const SAMPLES: Record<string, Record<string, unknown>> = {
  crackstone_mode: { from: 'PATROL', to: 'CHASE', reason: 'saw_player' },
  crackstone_sighted: { via: 'sight', distanceM: 11.4 },
  crackstone_lost: {},
  crackstone_scan: { phase: 'warning', radiusM: 14, hit: false },
  curse: { phase: 'cast', hpLost: 0, blocked: false },
};

const data = requireData();
const kase = resolveCase('poisoned_archive', data.cases.poisoned_archive.version);
const ctx: RulesContext = rulesContext(SEED, kase.caseDef, requireEggRules(), PLAYER_MAX_HP, V31);
const clues = kase.caseDef.clues.map((c) => c.id);
const tier = ctx.expectedTier!;
const points = ctx.eggPoints[tier];

/** Builds a raw stamped stream: push(type, t, payload). */
function builder() {
  const raw: Record<string, unknown>[] = [];
  let seq = 0;
  const push = (type: string, t: number, payload: Record<string, unknown> = {}) => { raw.push({ type, t, seq: seq++, ...payload }); };
  return { raw, push };
}

/** Upload (parse + reduce in batches) and finalize replay (rule events only); asserts both agree. */
function verify(raw: Record<string, unknown>[], c: RulesContext = ctx, batch = 7): MysteryProgress {
  let p = initialProgress();
  for (let k = 0; k < raw.length; k += batch) p = applyBatch(p, parseEventBatch(raw.slice(k, k + batch), false), c);
  const rule = parseEventBatch(raw, false).filter((e) => RULE_EVENT_TYPES.includes(e.type));
  const replay = applyBatch(initialProgress(), rule, c);
  expect(ruleFingerprint(replay)).toBe(ruleFingerprint(p));
  // jsonb round trip of the stored progress (append-events stores it; finalize reads it back)
  expect(ruleFingerprint(progressFromRow(JSON.parse(JSON.stringify(p))))).toBe(ruleFingerprint(p));
  return p;
}

// ------------------------------------------------------------------------------------------------- parsing
describe('Crackstone events: structure', () => {
  it('accepts each type with its exact payload, and every enum value', () => {
    expect(Object.keys(SAMPLES).filter((t) => t !== 'curse').sort()).toEqual([...CRACKSTONE_TELEMETRY_TYPES].sort());
    for (const [type, payload] of Object.entries(SAMPLES)) expect(ev(type, payload)).toEqual({ seq: 0, t: 1, type, payload });
    for (const mode of ['PATROL', 'INVESTIGATE', 'CHASE', 'ATTACK', 'SEARCH', 'RETURN']) {
      expect(ev('crackstone_mode', { from: mode, to: mode, reason: 'returned' }).payload.to).toBe(mode);
    }
    for (const reason of ['saw_player', 'sensed_player', 'scan_hit', 'lost_sight', 'leash', 'reached_target', 'gave_up',
      'search_timeout', 'returned', 'curse_cast', 'curse_done', 'curse_missed', 'stunned', 'lured', 'deferred']) {
      expect(ev('crackstone_mode', { from: 'CHASE', to: 'SEARCH', reason }).payload.reason).toBe(reason);
    }
    for (const via of ['sight', 'proximity', 'scan']) expect(ev('crackstone_sighted', { via, distanceM: 3 }).payload.via).toBe(via);
    expect(ev('crackstone_scan', { phase: 'pulse', radiusM: 14, hit: true }).payload.hit).toBe(true);
    for (const phase of ['cast', 'hit', 'miss']) expect(ev('curse', { phase, hpLost: 0, blocked: false }).payload.phase).toBe(phase);
  });

  it('rejects unknown enum values (incl. Hyde-only names), missing keys and wrong types', () => {
    const bad: [string, Record<string, unknown>][] = [
      ['crackstone_mode', { ...SAMPLES.crackstone_mode, to: 'INVESTIGATE_SOUND' }], // Hyde mode, not his
      ['crackstone_mode', { ...SAMPLES.crackstone_mode, from: 'COOLDOWN' }],
      ['crackstone_mode', { ...SAMPLES.crackstone_mode, reason: 'heard_noise' }], // he is deaf (R3)
      ['crackstone_mode', { ...SAMPLES.crackstone_mode, to: 'chase' }],
      ['crackstone_sighted', { via: 'noise', distanceM: 3 }],
      ['crackstone_sighted', { via: 'sight', distanceM: '3' }],
      ['crackstone_scan', { ...SAMPLES.crackstone_scan, phase: 'flash' }],
      ['crackstone_scan', { ...SAMPLES.crackstone_scan, hit: 1 }],
      ['curse', { ...SAMPLES.curse, phase: 'landed' }],
      ['curse', { ...SAMPLES.curse, blocked: 'no' }],
    ];
    for (const [type, payload] of bad) expect(code(() => ev(type, payload)), `${type} ${JSON.stringify(payload)}`).toBe('EVENT_REJECTED:payload');
    for (const [type, payload] of Object.entries(SAMPLES)) {
      for (const key of Object.keys(payload)) {
        const { [key]: _drop, ...missing } = payload;
        expect(code(() => ev(type, missing)), `${type} without ${key}`).toBe('EVENT_REJECTED:payload');
      }
    }
  });

  it('numbers are finite, non-negative and capped', () => {
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1000.1, null]) {
      expect(code(() => ev('crackstone_sighted', { via: 'scan', distanceM: v })), `distanceM ${v}`).toBe('EVENT_REJECTED:payload');
    }
    expect(ev('crackstone_sighted', { via: 'proximity', distanceM: 0 }).payload.distanceM).toBe(0);
    expect(ev('crackstone_scan', { phase: 'pulse', radiusM: MAX_SCAN_RADIUS_M, hit: false }).payload.radiusM).toBe(100);
    for (const v of [-1, MAX_SCAN_RADIUS_M + 0.5, Number.NaN]) {
      expect(code(() => ev('crackstone_scan', { phase: 'pulse', radiusM: v, hit: false })), `radiusM ${v}`).toBe('EVENT_REJECTED:payload');
    }
    expect(ev('curse', { phase: 'hit', hpLost: MAX_CURSE_HP, blocked: false }).payload.hpLost).toBe(100);
    for (const v of [-5, MAX_CURSE_HP + 1, Number.NaN, Number.NEGATIVE_INFINITY, '25']) {
      expect(code(() => ev('curse', { phase: 'hit', hpLost: v, blocked: false })), `hpLost ${v}`).toBe('EVENT_REJECTED:payload');
    }
  });

  it('telemetry tolerates ≤ 6 extra short primitives; the curse RULE event is strict (exact keys)', () => {
    expect(ev('crackstone_mode', { ...SAMPLES.crackstone_mode, suspicion: 0.8, areaId: 'archive_stacks' }).payload.suspicion).toBe(0.8);
    expect(code(() => ev('crackstone_scan', { ...SAMPLES.crackstone_scan, at: { x: 1, z: 2 } }))).toBe('EVENT_REJECTED:payload');
    expect(code(() => ev('curse', { ...SAMPLES.curse, x: 3 }))).toBe('EVENT_REJECTED:payload');
  });

  it('crackstone_risk forecasts ride along in an append body', () => {
    const body = parseMysteryAppend({ sessionId: SID, events: [{ type: 'crackstone_lost', t: 30, seq: 4 }],
      forecasts: [{ forecastNo: 0, t: 30, target: 'crackstone_risk', value: 0.42, modelLabel: 'rule_based', features: { horizon_s: 10 } },
        { forecastNo: 1, t: 30, target: 'crackstone_risk', value: 1.2, modelLabel: 'rule_based', features: {} }] });
    expect(body.events.map((e) => e.type)).toEqual(['crackstone_lost']);
    expect(body.forecasts.map((f) => [f.target, f.value])).toEqual([['crackstone_risk', 0.42]]);
    expect(body.dropped.forecasts).toBe(1); // the out-of-range probability is dropped, never rejecting the events
  });
});

// ------------------------------------------------------------------------------------------------- rules
describe('curse is a rule event: HP accounting, never a catch', () => {
  it('the server knows the sim max HP', () => {
    expect(PLAYER_MAX_HP).toBe(DEFAULT_TUNING.player.maxHp);
    expect(ctx.maxHp).toBe(PLAYER_MAX_HP);
    expect(RULE_EVENT_TYPES).toContain('curse');
    expect(CRACKSTONE_TELEMETRY_TYPES.filter((t) => RULE_EVENT_TYPES.includes(t))).toEqual([]);
  });

  it('a cursed run that finishes still verifies; curses add HP loss, not catches; Crackstone sightings are not Hyde sightings', () => {
    const { raw, push } = builder();
    push('crackstone_mode', 3, { from: 'PATROL', to: 'CHASE', reason: 'saw_player' });
    push('crackstone_sighted', 3, { via: 'sight', distanceM: 9 });
    push('crackstone_mode', 5, { from: 'CHASE', to: 'ATTACK', reason: 'curse_cast' });
    push('curse', 5, { phase: 'cast', hpLost: 0, blocked: false });
    push('curse', 6.3, { phase: 'hit', hpLost: 25, blocked: false });
    push('crackstone_mode', 6.3, { from: 'ATTACK', to: 'RETURN', reason: 'curse_done' });
    push('crackstone_lost', 7);
    clues.forEach((c, i) => push('clue_found', 10 + i, { clueId: c, cluesFound: i + 1 }));
    push('crackstone_scan', 20, { phase: 'warning', radiusM: 14, hit: false });
    push('crackstone_scan', 22, { phase: 'pulse', radiusM: 14, hit: true });
    push('crackstone_sighted', 22, { via: 'scan', distanceM: 12 });
    push('curse', 24, { phase: 'cast', hpLost: 0, blocked: false });
    push('curse', 25.3, { phase: 'hit', hpLost: 0, blocked: true }); // block_grab consumed by the curse
    push('curse', 40, { phase: 'cast', hpLost: 0, blocked: false });
    push('curse', 41.3, { phase: 'miss', hpLost: 0, blocked: false }); // player left the circle
    push('catch', 50, { catchNumber: 1, hpLost: 35, eggSecurityLost: 0, blocked: false });
    push('egg_pickup', 60);
    push('egg_delivered', 99, { tier, points, security: 100 });
    push('accusation', 99, { suspectId: kase.solution.culprit, correct: true, cluesFound: 3, evidence: [...kase.solution.supportingEvidence], deductionCorrect: true });
    push('finish', 99, { verdict: 'case_solved', score: scoreFor(points, 99) });
    const p = verify(raw);
    expect([p.catches, p.curses, p.hpLost, p.sightings, p.egg]).toEqual([1, 2, 60, 0, 'delivered']);
    expect(progressSummary(p)).toMatchObject({ catches: 1, sightings: 0, terminal: 'finish' });
    const r = computeV31(p, kase, tier);
    expect(r).toMatchObject({ outcome: 'finished', verdict: 'case_solved', catches: 1, sightings: 0, score: scoreFor(points, 99), claimMatches: true });
  });

  it('a run that died to curses is a valid hp_depleted DNF (the curse hits are in the finalize replay)', () => {
    const { raw, push } = builder();
    push('catch', 20, { catchNumber: 1, hpLost: 35, eggSecurityLost: 0, blocked: false });
    let t = 30;
    for (const hp of [25, 25, 15]) {
      push('curse', t, { phase: 'cast', hpLost: 0, blocked: false });
      push('curse', t + 1.3, { phase: 'hit', hpLost: hp, blocked: false });
      t += 20;
    }
    push('dnf', t - 18.7, { reason: 'hp_depleted' }); // same step as the last hit, emitted after it
    const p = verify(raw);
    expect([p.catches, p.curses, p.hpLost, p.terminal?.type]).toEqual([1, 3, 100, 'dnf']);
    const r = computeV31(p, kase, tier);
    expect(r).toMatchObject({ outcome: 'dnf', dnfReason: 'hp_depleted', score: null, catches: 1, eggPoints: 0, claimMatches: true });
    // also curses alone (no catch), and while carrying the egg (a curse never drops / damages it)
    const solo = builder();
    solo.push('egg_pickup', 5);
    for (let i = 0; i < 4; i++) solo.push('curse', 10 + i * 15, { phase: 'hit', hpLost: 25, blocked: false });
    solo.push('dnf', 55, { reason: 'hp_depleted' });
    const q = verify(solo.raw);
    expect([q.catches, q.curses, q.hpLost, q.egg, q.eggSecurity]).toEqual([0, 4, 100, 'carried', 100]);
    expect(computeV31(q, kase, tier)).toMatchObject({ outcome: 'dnf', dnfReason: 'hp_depleted', catches: 0 });
  });

  it('hp_depleted needs the recorded HP loss to reach max HP (a curse missing from the stream is caught)', () => {
    const { raw, push } = builder();
    push('catch', 20, { catchNumber: 1, hpLost: 35, eggSecurityLost: 0, blocked: false });
    push('curse', 30, { phase: 'hit', hpLost: 25, blocked: false });
    push('dnf', 31, { reason: 'hp_depleted' }); // 60 < 100
    expect(code(() => verify(raw))).toBe('EVENT_REJECTED:dnf_reason');
    // blocked hits cost nothing, so they do not count towards an HP death
    const blocked = builder();
    for (let i = 0; i < 5; i++) blocked.push('curse', 10 + i, { phase: 'hit', hpLost: 0, blocked: true });
    blocked.push('dnf', 16, { reason: 'hp_depleted' });
    expect(code(() => verify(blocked.raw))).toBe('EVENT_REJECTED:dnf_reason');
    // float noise is tolerated; maxHp null (an older RulesContext) skips the check
    const noisy = builder();
    noisy.push('curse', 10, { phase: 'hit', hpLost: 100 - HP_EPSILON / 2, blocked: false });
    noisy.push('dnf', 10, { reason: 'hp_depleted' });
    expect(verify(noisy.raw).terminal?.type).toBe('dnf');
    expect(verify(raw, { ...ctx, maxHp: null }).terminal?.type).toBe('dnf');
    // second_catch is unaffected by curses
    const two = builder();
    two.push('curse', 5, { phase: 'hit', hpLost: 25, blocked: false });
    two.push('catch', 20, { catchNumber: 1, hpLost: 35, eggSecurityLost: 0, blocked: false });
    two.push('catch', 40, { catchNumber: 2, hpLost: 35, eggSecurityLost: 0, blocked: false });
    two.push('dnf', 40, { reason: 'second_catch' });
    expect(computeV31(verify(two.raw), kase, tier)).toMatchObject({ dnfReason: 'second_catch', catches: 2 });
  });

  it('a curse is not a catch: it never satisfies second_catch', () => {
    const { raw, push } = builder();
    push('catch', 20, { catchNumber: 1, hpLost: 35, eggSecurityLost: 0, blocked: false });
    push('curse', 30, { phase: 'hit', hpLost: 25, blocked: false });
    push('dnf', 31, { reason: 'second_catch' });
    expect(code(() => verify(raw))).toBe('EVENT_REJECTED:dnf_reason');
    // and the next catch is still #2
    const next = builder();
    next.push('curse', 30, { phase: 'hit', hpLost: 25, blocked: false });
    next.push('catch', 40, { catchNumber: 2, hpLost: 35, eggSecurityLost: 0, blocked: false });
    expect(code(() => verify(next.raw))).toBe('EVENT_REJECTED:catch_order');
  });

  it('HP consistency of the curse payload', () => {
    const one = (payload: Record<string, unknown>, before: Record<string, unknown>[] = []) =>
      code(() => verify([...before, { type: 'curse', t: 50, seq: before.length, ...payload }]));
    expect(one({ phase: 'hit', hpLost: 25, blocked: true })).toBe('EVENT_REJECTED:curse_hp'); // blocked costs nothing
    expect(one({ phase: 'cast', hpLost: 25, blocked: false })).toBe('EVENT_REJECTED:curse_hp');
    expect(one({ phase: 'miss', hpLost: 10, blocked: false })).toBe('EVENT_REJECTED:curse_hp');
    expect(one({ phase: 'miss', hpLost: 0, blocked: false })).toBe('no-error');
    // no curse lands after the deposit (the run is in the accusation phase); cast / miss are harmless telemetry there
    const deposit = [{ type: 'egg_pickup', t: 10, seq: 0 }, { type: 'egg_delivered', t: 20, seq: 1, tier, points, security: 100 }];
    expect(one({ phase: 'hit', hpLost: 25, blocked: false }, deposit)).toBe('EVENT_REJECTED:curse_after_deposit');
    expect(one({ phase: 'miss', hpLost: 0, blocked: false }, deposit)).toBe('no-error');
    // nothing after the terminal event
    const dead = [{ type: 'catch', t: 10, seq: 0, catchNumber: 1, hpLost: 35, eggSecurityLost: 0, blocked: false },
      { type: 'catch', t: 20, seq: 1, catchNumber: 2, hpLost: 35, eggSecurityLost: 0, blocked: false }, { type: 'dnf', t: 20, seq: 2, reason: 'second_catch' }];
    expect(one({ phase: 'hit', hpLost: 25, blocked: false }, dead)).toBe('EVENT_REJECTED:after_terminal');
  });

  it('Crackstone telemetry never changes the rule state; curse does (it is in the fingerprint)', () => {
    const { raw, push } = builder();
    for (const [type, payload] of Object.entries(SAMPLES)) push(type, 5, payload);
    push('crackstone_sighted', 6, { via: 'proximity', distanceM: 1.5 });
    const tele = verify(raw);
    expect(ruleFingerprint(tele)).toBe(ruleFingerprint(applyBatch(initialProgress(), parseEventBatch(raw, false).filter((e) => e.type === 'curse'), ctx)));
    expect(tele.sightings).toBe(0);
    const hit = applyBatch(tele, [ev('curse', { phase: 'hit', hpLost: 25, blocked: false }, 99, 9) as ParsedEvent], ctx);
    expect(ruleFingerprint(hit)).not.toBe(ruleFingerprint(tele));
  });

  it('progress stored without the Crackstone fields restores as a curse-free run', () => {
    const old = { ...initialProgress() } as Partial<MysteryProgress>;
    delete old.curses;
    const p = progressFromRow(JSON.parse(JSON.stringify(old)));
    expect(p.curses).toBe(0);
    expect(ruleFingerprint(p)).toBe(ruleFingerprint(initialProgress()));
  });
});
