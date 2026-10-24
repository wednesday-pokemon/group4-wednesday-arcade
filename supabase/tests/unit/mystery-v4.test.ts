// mystery-v4 backend (2026-10-24, docs/final/FINAL_CONTRACT.md §1, §2, §4, §10; migration 20261025000100_mystery_v4.sql):
// the encounter-director / Slurp / cabinet events, the enemy_detected / enemy_hit / hint_requested{level} rule events,
// dnf.by, the v4 computeResult (shared scoreV4 from validated progress + the server's answer key), v3.1 / v4 separation,
// the v4 claim fields, and drift guards (server enums vs the synced types.ts unions vs the SQL CHECK lists).
// Run after `npm run sync:shared`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HttpError } from '../../functions/_shared/errors.ts';
import {
  CABINET_ACTIONS, DESPAWN_REASONS, DETECT_VIA, DIRECTOR_TELEMETRY_TYPES, ENEMY_IDS, MAX_HIT_HP, MYSTERY_EVENT_TYPES,
  RULE_EVENT_TYPES, SLURP_MODES, SLURP_REASONS, applyBatch, eventFieldNames, initialProgress, isStrictEvent, parseEvent,
  parseEventBatch, progressFromRow, progressSummary, ruleFingerprint, totalHits, type MysteryProgress, type RulesContext,
} from '../../functions/_shared/mystery-events.ts';
import {
  MYSTERY_RULES_VERSION, PLAYER_MAX_HP, RULES_VERSIONS, computeResult, requireData, requireEggRules, resolveCase, rulesContext,
  sessionRulesVersion, type SessionCase,
} from '../../functions/_shared/mystery-rules.ts';
import {
  FORECAST_TARGETS, SCORE_BREAKDOWN_KEYS, parseMysteryAppend, parseMysteryFinalize, sanitizeClientResult,
} from '../../functions/_shared/mystery-validation.ts';
import { compareResults, round1, scoreFor, scoreV4 } from '../../functions/_shared/mystery/scoring.ts';
import { CASE_IDS, CLUE_IDS, SUSPECT_IDS, type ScoreBreakdown } from '../../functions/_shared/mystery/types.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SID = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b';
const SEED = '0123456789abcdef0123456789abcdef';
const V4 = 'mystery-v4' as const;
const V31 = 'mystery-v3.1' as const;

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

/** Independent oracle of FINAL_CONTRACT §1 (NOT the shared scoreV4): the server must agree with the written contract. */
function contractScore(x: { delivered: boolean; correct: boolean; clues: number; detections: number; hints: number; hits: number; t: number }) {
  const parts = {
    delivery: x.delivered ? 1000 : 0,
    accusation: x.correct ? 300 : 0,
    clues: 100 * Math.min(x.clues, 3),
    noDetection: x.detections === 0 ? 150 : 0,
    noHints: x.hints === 0 ? 150 : 0,
    timeBonus: Math.max(0, 300 - Math.floor(x.t)),
    hintPenalty: x.hints === 0 ? 0 : -50 * x.hints,
    hitPenalty: x.hits === 0 ? 0 : -75 * x.hits,
  };
  const sum = Object.values(parts).reduce((a, b) => a + b, 0);
  return { ...parts, total: Math.max(0, sum) } as ScoreBreakdown;
}

const data = requireData();
const egg = requireEggRules();
const KASE: SessionCase = resolveCase('poisoned_archive', data.cases.poisoned_archive.version);
const CTX4: RulesContext = rulesContext(SEED, KASE.caseDef, egg, PLAYER_MAX_HP, V4);
const CTX31: RulesContext = rulesContext(SEED, KASE.caseDef, egg, PLAYER_MAX_HP, V31);
const TIER = CTX4.expectedTier!;
const POINTS = CTX4.eggPoints[TIER];
const CLUES = KASE.caseDef.clues.map((c) => c.id);

/** Raw stamped-stream builder: push(type, t, payload). */
function builder() {
  const raw: Record<string, unknown>[] = [];
  let seq = 0;
  const push = (type: string, t: number, payload: Record<string, unknown> = {}) => { raw.push({ type, t, seq: seq++, ...payload }); };
  return { raw, push };
}

/** Upload in batches (append-events) and finalize replay of the rule events only; asserts both agree. */
function verify(raw: Record<string, unknown>[], ctx: RulesContext = CTX4, batch = 6): MysteryProgress {
  let p = initialProgress();
  for (let k = 0; k < raw.length; k += batch) p = applyBatch(p, parseEventBatch(raw.slice(k, k + batch), false), ctx);
  const rule = parseEventBatch(raw, false).filter((e) => RULE_EVENT_TYPES.includes(e.type));
  const replay = applyBatch(initialProgress(), rule, ctx);
  expect(ruleFingerprint(replay)).toBe(ruleFingerprint(p));
  expect(ruleFingerprint(progressFromRow(JSON.parse(JSON.stringify(p))))).toBe(ruleFingerprint(p)); // jsonb round trip
  return p;
}

/** One valid payload per final-wave type (exact shapes of the GameEvent union in src/mystery/types.ts). */
const SAMPLES: Record<string, Record<string, unknown>> = {
  enemy_spawned: { enemy: 'slurp', spawnId: 'sp_slurp_vault', x: 12.5, z: -40 },
  enemy_despawned: { enemy: 'hyde', reason: 'far' },
  enemy_detected: { enemy: 'crackstone', via: 'scan' },
  enemy_hit: { enemy: 'slurp', hpLost: 30, blocked: false },
  slurp_mode: { from: 'WANDER', to: 'CHASE', reason: 'saw_player' },
  cabinet: { spotId: 'cab_archive_1', action: 'enter', loud: false },
};

/**
 * A full v4 run: director spawns, a Slurp stalk, cabinet use, a Hyde grab (catch + enemy_hit), a landed curse (curse +
 * enemy_hit), a Slurp attack, Weems hints and detections — then clues, delivery at `t`, accusation and finish.
 */
function v4Run(o: { t?: number; hints?: number; detections?: number; suspect?: string | null; clues?: number; noHits?: boolean } = {}) {
  const { raw, push } = builder();
  const t = o.t ?? 150.04;
  const hints = o.hints ?? 3;
  const detections = o.detections ?? 2;
  push('enemy_spawned', 1, SAMPLES.enemy_spawned);
  push('slurp_mode', 2, { from: 'WANDER', to: 'INVESTIGATE', reason: 'heard_noise' });
  push('cabinet', 3, { spotId: 'cab_archive_1', action: 'enter', loud: true });
  push('cabinet', 3.5, { spotId: 'cab_archive_1', action: 'close', loud: false });
  push('cabinet', 9, { spotId: 'cab_archive_1', action: 'open', loud: false });
  push('cabinet', 9.6, { spotId: 'cab_archive_1', action: 'exit', loud: false });
  const vias = ['sight', 'sound', 'proximity', 'scan', 'witnessed_hide'];
  for (let i = 0; i < detections; i++) push('enemy_detected', 10 + i, { enemy: ENEMY_IDS[i % 3], via: vias[i % vias.length] });
  for (let i = 0; i < hints; i++) push('hint_requested', 20 + i, i % 2 === 0 ? { level: ((i % 3) + 1) as 1 | 2 | 3 } : {});
  let hits = 0;
  if (!o.noHits) {
    push('catch', 30, { catchNumber: 1, hpLost: 35, eggSecurityLost: 0, blocked: false });
    push('enemy_hit', 30, { enemy: 'hyde', hpLost: 35, blocked: false });
    push('curse', 40, { phase: 'hit', hpLost: 25, blocked: false });
    push('enemy_hit', 40, { enemy: 'crackstone', hpLost: 25, blocked: false });
    push('enemy_hit', 50, { enemy: 'slurp', hpLost: 0, blocked: true }); // blocked hits count
    hits = 3;
  }
  push('enemy_despawned', 55, { enemy: 'slurp', reason: 'encounter_resolved' });
  const clues = CLUES.slice(0, o.clues ?? 3);
  clues.forEach((c, i) => push('clue_found', 60 + i, { clueId: c, cluesFound: i + 1 }));
  push('egg_pickup', 70);
  push('egg_delivered', t, { tier: TIER, points: POINTS, security: 100 });
  const suspect = o.suspect === undefined ? KASE.solution.culprit : o.suspect;
  const correct = suspect === KASE.solution.culprit;
  const evidence = suspect === null ? [] : [...KASE.solution.supportingEvidence].filter((c) => clues.includes(c));
  const deductionCorrect = suspect !== null && evidence.length === 3;
  const verdict = suspect === null ? 'not_accused' : correct && deductionCorrect && clues.length === 3 ? 'case_solved' : 'egg_secured_mystery_unsolved';
  const breakdown = contractScore({ delivered: true, correct, clues: clues.length, detections, hints, hits, t: round1(t) });
  push('accusation', t, { suspectId: suspect, correct, cluesFound: clues.length, evidence, deductionCorrect });
  push('finish', t, { verdict, score: breakdown.total });
  return { raw, breakdown, verdict, correct, hits, hints, detections, evidence, deductionCorrect };
}

// ------------------------------------------------------------------------------------------------- parsing
describe('final-wave events: structure', () => {
  it('accepts each new type with its exact payload and every enum value', () => {
    for (const [type, payload] of Object.entries(SAMPLES)) expect(ev(type, payload)).toEqual({ seq: 0, t: 1, type, payload });
    for (const enemy of ENEMY_IDS) {
      expect(ev('enemy_spawned', { ...SAMPLES.enemy_spawned, enemy }).payload.enemy).toBe(enemy);
      expect(ev('enemy_hit', { enemy, hpLost: 20, blocked: false }).payload.enemy).toBe(enemy);
    }
    for (const reason of DESPAWN_REASONS) expect(ev('enemy_despawned', { enemy: 'crackstone', reason }).payload.reason).toBe(reason);
    for (const via of DETECT_VIA) expect(ev('enemy_detected', { enemy: 'hyde', via }).payload.via).toBe(via);
    for (const mode of SLURP_MODES) expect(ev('slurp_mode', { from: mode, to: mode, reason: 'deferred' }).payload.to).toBe(mode);
    for (const reason of SLURP_REASONS) expect(ev('slurp_mode', { from: 'CHASE', to: 'SEARCH', reason }).payload.reason).toBe(reason);
    for (const action of CABINET_ACTIONS) expect(ev('cabinet', { spotId: 'cab_1', action, loud: true }).payload.action).toBe(action);
    expect(ev('hint_requested').payload).toEqual({});
    for (const level of [1, 2, 3]) expect(ev('hint_requested', { level }).payload.level).toBe(level);
    expect(ev('dnf', { reason: 'second_catch' }).payload).toEqual({ reason: 'second_catch' });
    expect(ev('dnf', { reason: 'hp_depleted', by: null }).payload.by).toBeNull();
    for (const by of ENEMY_IDS) expect(ev('dnf', { reason: 'hp_depleted', by }).payload.by).toBe(by);
  });

  it('rejects unknown enum values, wrong types, missing keys and bad ids', () => {
    const bad: [string, Record<string, unknown>][] = [
      ['enemy_spawned', { ...SAMPLES.enemy_spawned, enemy: 'isaac' }], // Isaac is Slurp; the id is 'slurp'
      ['enemy_spawned', { ...SAMPLES.enemy_spawned, enemy: 'Hyde' }],
      ['enemy_spawned', { ...SAMPLES.enemy_spawned, spawnId: 'Sp-1' }],
      ['enemy_spawned', { ...SAMPLES.enemy_spawned, x: Number.NaN }],
      ['enemy_spawned', { ...SAMPLES.enemy_spawned, z: 1e5 }],
      ['enemy_despawned', { enemy: 'hyde', reason: 'killed' }],
      ['enemy_detected', { enemy: 'slurp', via: 'smell' }],
      ['enemy_detected', { enemy: 'nobody', via: 'sight' }],
      ['enemy_hit', { enemy: 'slurp', hpLost: -1, blocked: false }],
      ['enemy_hit', { enemy: 'slurp', hpLost: MAX_HIT_HP + 1, blocked: false }],
      ['enemy_hit', { enemy: 'slurp', hpLost: '30', blocked: false }],
      ['enemy_hit', { enemy: 'slurp', hpLost: 30, blocked: 'no' }],
      ['slurp_mode', { from: 'PATROL', to: 'CHASE', reason: 'saw_player' }], // Hyde / Crackstone mode, not his
      ['slurp_mode', { from: 'WANDER', to: 'CHASE', reason: 'scan_hit' }],
      ['cabinet', { spotId: 'cab 1', action: 'enter', loud: false }],
      ['cabinet', { spotId: 'cab_1', action: 'slam', loud: false }],
      ['cabinet', { spotId: 'cab_1', action: 'enter', loud: 1 }],
      ['hint_requested', { level: 0 }],
      ['hint_requested', { level: 4 }],
      ['hint_requested', { level: 1.5 }],
      ['hint_requested', { level: '2' }],
      ['hint_requested', { level: null }],
      ['dnf', { reason: 'hp_depleted', by: 'isaac' }],
      ['dnf', { reason: 'hp_depleted', by: 3 }],
    ];
    for (const [type, payload] of bad) expect(code(() => ev(type, payload)), `${type} ${JSON.stringify(payload)}`).toBe('EVENT_REJECTED:payload');
    for (const [type, payload] of Object.entries(SAMPLES)) {
      for (const key of Object.keys(payload)) {
        const { [key]: _drop, ...missing } = payload;
        expect(code(() => ev(type, missing)), `${type} without ${key}`).toBe('EVENT_REJECTED:payload');
      }
    }
  });

  it('rule events are strict (exact keys); telemetry tolerates ≤ 6 extra short primitives', () => {
    for (const type of ['enemy_detected', 'enemy_hit', 'hint_requested', 'dnf'] as const) expect(isStrictEvent(type), type).toBe(true);
    for (const type of DIRECTOR_TELEMETRY_TYPES) expect(isStrictEvent(type), type).toBe(false);
    expect(code(() => ev('enemy_detected', { ...SAMPLES.enemy_detected, distanceM: 4 }))).toBe('EVENT_REJECTED:payload');
    expect(code(() => ev('enemy_hit', { ...SAMPLES.enemy_hit, x: 1 }))).toBe('EVENT_REJECTED:payload');
    expect(code(() => ev('hint_requested', { level: 1, source: 'thing' }))).toBe('EVENT_REJECTED:payload');
    expect(code(() => ev('dnf', { reason: 'second_catch', by: 'hyde', t2: 1 }))).toBe('EVENT_REJECTED:payload');
    expect(ev('enemy_spawned', { ...SAMPLES.enemy_spawned, zoneId: 'z_mid', w: 0.4 }).payload.zoneId).toBe('z_mid');
    expect(ev('cabinet', { ...SAMPLES.cabinet, noise: 0.6 }).payload.noise).toBe(0.6);
    expect(code(() => ev('slurp_mode', { ...SAMPLES.slurp_mode, at: { x: 1 } }))).toBe('EVENT_REJECTED:payload');
  });

  it('enemy_detected and enemy_hit are rule events; the director / Slurp / cabinet types are telemetry', () => {
    expect(RULE_EVENT_TYPES).toEqual(expect.arrayContaining(['enemy_detected', 'enemy_hit', 'hint_requested', 'curse']));
    expect(DIRECTOR_TELEMETRY_TYPES.filter((t) => RULE_EVENT_TYPES.includes(t))).toEqual([]);
    expect([...DIRECTOR_TELEMETRY_TYPES, 'enemy_detected', 'enemy_hit'].every((t) => (MYSTERY_EVENT_TYPES as readonly string[]).includes(t))).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------- rules / counting
describe('v4 progress counting (rule events only)', () => {
  it('hints = hint_requested (any level), detections = enemy_detected, hits = enemy_hit (blocked hits count)', () => {
    const r = v4Run({ hints: 4, detections: 3 });
    const p = verify(r.raw);
    expect([p.hints, p.detections, totalHits(p), p.hits]).toEqual([4, 3, 3, { hyde: 1, crackstone: 1, slurp: 1 }]);
    expect([p.catches, p.curses, p.hpLost, p.hitHpLost, p.lastHitBy]).toEqual([1, 1, 60, 60, 'slurp']);
    expect(progressSummary(p)).toMatchObject({ hintsUsed: 4, detections: 3, hits: 3, catches: 1, terminal: 'finish' });
  });

  it('telemetry (director, Slurp modes, cabinets) never changes the rule state', () => {
    const r = v4Run();
    const all = verify(r.raw);
    const telemetry = new Set<string>(DIRECTOR_TELEMETRY_TYPES);
    const ruleOnly = applyBatch(initialProgress(), parseEventBatch(r.raw, false).filter((e) => !telemetry.has(e.type)), CTX4);
    expect(ruleFingerprint(ruleOnly)).toBe(ruleFingerprint(all));
    expect(computeResult(ruleOnly, KASE, TIER, undefined, V4)).toEqual(computeResult(all, KASE, TIER, undefined, V4));
  });

  it('enemy_hit consistency: blocked => 0 HP, never after the deposit; Slurp hits cost HP (hp_depleted)', () => {
    const one = (payload: Record<string, unknown>, before: Record<string, unknown>[] = []) =>
      code(() => verify([...before, { type: 'enemy_hit', t: 50, seq: before.length, ...payload }]));
    expect(one({ enemy: 'slurp', hpLost: 30, blocked: true })).toBe('EVENT_REJECTED:hit_hp');
    expect(one({ enemy: 'slurp', hpLost: 0, blocked: true })).toBe('no-error');
    const deposit = [{ type: 'egg_pickup', t: 10, seq: 0 }, { type: 'egg_delivered', t: 20, seq: 1, tier: TIER, points: POINTS, security: 100 }];
    expect(one({ enemy: 'slurp', hpLost: 30, blocked: false }, deposit)).toBe('EVENT_REJECTED:hit_after_deposit');
    // three Slurp attacks of 30 + one of 10 = 100 HP: a valid HP death named after Slurp
    const { raw, push } = builder();
    [30, 30, 30, 10].forEach((hp, i) => push('enemy_hit', 10 + i, { enemy: 'slurp', hpLost: hp, blocked: false }));
    push('dnf', 14, { reason: 'hp_depleted', by: 'slurp' });
    const p = verify(raw);
    expect([p.hits.slurp, p.hpLost, p.terminal]).toEqual([4, 100, { type: 'dnf', seq: 4, t: 14, reason: 'hp_depleted', by: 'slurp' }]);
    // too little recorded HP loss is still refused
    const short = builder();
    short.push('enemy_hit', 10, { enemy: 'slurp', hpLost: 30, blocked: false });
    short.push('dnf', 11, { reason: 'hp_depleted', by: 'slurp' });
    expect(code(() => verify(short.raw))).toBe('EVENT_REJECTED:dnf_reason');
  });

  it('v4 hp_depleted accepts either HP accounting (catch / curse events or the enemy_hit sum)', () => {
    // the hits report the damage; the catch event reports a nominal 35 (e.g. a different rounding) — enemy_hit sum = 100
    const { raw, push } = builder();
    push('catch', 10, { catchNumber: 1, hpLost: 35, eggSecurityLost: 0, blocked: false });
    push('enemy_hit', 10, { enemy: 'hyde', hpLost: 40, blocked: false });
    push('curse', 20, { phase: 'hit', hpLost: 25, blocked: false });
    push('enemy_hit', 20, { enemy: 'crackstone', hpLost: 30, blocked: false });
    push('enemy_hit', 30, { enemy: 'slurp', hpLost: 30, blocked: false });
    push('dnf', 30, { reason: 'hp_depleted', by: 'slurp' });
    const p = verify(raw);
    expect([p.hpLost, p.hitHpLost]).toEqual([90, 100]);
    expect(code(() => verify(raw, CTX31))).toBe('EVENT_REJECTED:dnf_reason'); // v3.1 keeps its own accounting
  });

  it('dnf.by must name the enemy of the last enemy_hit; null / absent defers to it', () => {
    const base = () => {
      const b = builder();
      b.push('catch', 10, { catchNumber: 1, hpLost: 35, eggSecurityLost: 0, blocked: false });
      b.push('enemy_hit', 10, { enemy: 'hyde', hpLost: 35, blocked: false });
      b.push('catch', 20, { catchNumber: 2, hpLost: 35, eggSecurityLost: 0, blocked: false });
      b.push('enemy_hit', 20, { enemy: 'hyde', hpLost: 35, blocked: false });
      return b;
    };
    const ok = base();
    ok.push('dnf', 20, { reason: 'second_catch', by: 'hyde' });
    expect(computeResult(verify(ok.raw), KASE, TIER, undefined, V4)).toMatchObject({ outcome: 'dnf', defeatedBy: 'hyde', hits: 2, score: null });
    const wrong = base();
    wrong.push('dnf', 20, { reason: 'second_catch', by: 'slurp' });
    expect(code(() => verify(wrong.raw))).toBe('EVENT_REJECTED:dnf_by');
    const nobody = builder();
    nobody.push('catch', 10, { catchNumber: 1, hpLost: 35, eggSecurityLost: 0, blocked: false });
    nobody.push('catch', 20, { catchNumber: 2, hpLost: 35, eggSecurityLost: 0, blocked: false });
    nobody.push('dnf', 20, { reason: 'second_catch', by: 'hyde' });
    expect(code(() => verify(nobody.raw, CTX31))).toBe('EVENT_REJECTED:dnf_by'); // no hit recorded at all
    for (const by of [null, undefined]) {
      const b = base();
      b.push('dnf', 20, by === null ? { reason: 'second_catch', by: null } : { reason: 'second_catch' });
      const p = verify(b.raw);
      expect(p.terminal).toEqual({ type: 'dnf', seq: 4, t: 20, reason: 'second_catch' });
      expect(computeResult(p, KASE, TIER, undefined, V4).defeatedBy).toBe('hyde');
    }
  });

  it('v4: every Hyde catch and every landed curse needs its enemy_hit by the terminal event (extra hits are fine)', () => {
    const noHit = builder();
    noHit.push('catch', 10, { catchNumber: 1, hpLost: 35, eggSecurityLost: 0, blocked: false });
    noHit.push('catch', 20, { catchNumber: 2, hpLost: 35, eggSecurityLost: 0, blocked: false });
    noHit.push('enemy_hit', 20, { enemy: 'hyde', hpLost: 35, blocked: false });
    noHit.push('dnf', 20, { reason: 'second_catch' });
    expect(code(() => verify(noHit.raw))).toBe('EVENT_REJECTED:hits_missing');
    expect(verify(noHit.raw, CTX31).terminal?.type).toBe('dnf'); // v3.1 sessions never carry enemy_hit
    const curse = v4Run({ noHits: true });
    const at = curse.raw.findIndex((e) => e.type === 'clue_found');
    curse.raw.splice(at, 0, { type: 'curse', t: 59, seq: -1, phase: 'hit', hpLost: 25, blocked: false });
    curse.raw.forEach((e, i) => { e.seq = i; });
    expect(code(() => verify(curse.raw))).toBe('EVENT_REJECTED:hits_missing');
    // the enemy_hit after the dnf is too late (the run already ended)
    const late = builder();
    late.push('catch', 10, { catchNumber: 1, hpLost: 35, eggSecurityLost: 0, blocked: false });
    late.push('enemy_hit', 10, { enemy: 'hyde', hpLost: 35, blocked: false });
    late.push('catch', 20, { catchNumber: 2, hpLost: 35, eggSecurityLost: 0, blocked: false });
    late.push('dnf', 20, { reason: 'second_catch' });
    late.push('enemy_hit', 20, { enemy: 'hyde', hpLost: 35, blocked: false });
    expect(code(() => verify(late.raw))).toBe('EVENT_REJECTED:hits_missing');
    // a cabinet pull-out by Crackstone: an enemy_hit without a curse is allowed
    const pull = v4Run({ noHits: true });
    const k = pull.raw.findIndex((e) => e.type === 'clue_found');
    pull.raw.splice(k, 0, { type: 'cabinet', t: 58, seq: -1, spotId: 'cab_archive_1', action: 'pulled_out', loud: true },
      { type: 'enemy_hit', t: 58, seq: -1, enemy: 'crackstone', hpLost: 25, blocked: false });
    pull.raw.forEach((e, i) => { e.seq = i; });
    expect(verify(pull.raw).hits.crackstone).toBe(1);
  });

  it('progress stored before v4 restores with zero counts (fingerprint-identical)', () => {
    const old = { ...initialProgress() } as Partial<MysteryProgress>;
    delete old.detections; delete old.hits; delete old.hitHpLost; delete old.lastHitBy;
    const p = progressFromRow(JSON.parse(JSON.stringify(old)));
    expect([p.detections, p.hits, p.hitHpLost, p.lastHitBy]).toEqual([0, { hyde: 0, crackstone: 0, slurp: 0 }, 0, null]);
    expect(ruleFingerprint(p)).toBe(ruleFingerprint(initialProgress()));
    const partial = progressFromRow({ ...initialProgress(), hits: { hyde: 2 } });
    expect(partial.hits).toEqual({ hyde: 2, crackstone: 0, slurp: 0 });
  });
});

// ------------------------------------------------------------------------------------------------- scoring
describe('v4 computeResult = shared scoreV4 from validated progress (FINAL_CONTRACT §1 vectors)', () => {
  it('the shared scoreV4 matches the written contract on a grid of inputs (incl. the clamp at 0)', () => {
    let n = 0;
    for (const delivered of [true, false]) for (const correct of [true, false]) for (const clues of [0, 1, 3, 5])
      for (const detections of [0, 1, 7]) for (const hints of [0, 1, 4, 30]) for (const hits of [0, 1, 3, 20])
        for (const t of [0, 0.4, 59.9, 299, 299.9, 300, 300.1, 1234.5]) {
          const got = scoreV4({ delivered, correct, cluesFound: clues, detections, hintsUsed: hints, hits, activeTimeS: t });
          expect(got, JSON.stringify({ delivered, correct, clues, detections, hints, hits, t })).toEqual(
            contractScore({ delivered, correct, clues, detections, hints, hits, t }));
          n++;
        }
    expect(n).toBeGreaterThan(5000);
    expect(scoreV4({ delivered: true, correct: false, cluesFound: 0, detections: 3, hintsUsed: 10, hits: 10, activeTimeS: 400 }).total).toBe(0);
  });

  it('contract vectors through the server path', () => {
    // perfect run: 1000 + 300 + 300 + 150 + 150 + (300 − 95) = 2105
    const perfect = v4Run({ t: 95.43, hints: 0, detections: 0, noHits: true });
    const a = computeResult(verify(perfect.raw), KASE, TIER, undefined, V4);
    expect(a).toMatchObject({ rulesVersion: V4, outcome: 'finished', verdict: 'case_solved', score: 2105, hintsUsed: 0, detections: 0, hits: 0,
      activeTimeS: 95.4, defeatedBy: null, claimMatches: true });
    expect(a.scoreBreakdown).toEqual({ delivery: 1000, accusation: 300, clues: 300, noDetection: 150, noHints: 150, timeBonus: 205,
      hintPenalty: 0, hitPenalty: 0, total: 2105 });
    // messy run: 3 hints, 2 detections, 3 hits (one blocked), t 150.04 → 1000 + 300 + 300 + 0 + 0 + 150 − 150 − 225 = 1375
    const messy = v4Run();
    const b = computeResult(verify(messy.raw), KASE, TIER, undefined, V4);
    expect([b.score, b.hintsUsed, b.detections, b.hits, b.catches, b.claimMatches]).toEqual([1375, 3, 2, 3, 1, true]);
    expect(b.scoreBreakdown).toEqual(messy.breakdown);
    // wrong suspect, two clues, slow (≥ 300 s): 1000 + 0 + 200 + 0 + 0 + 0 − 50 − 225 = 925
    const wrong = v4Run({ t: 312, hints: 1, detections: 1, suspect: KASE.caseDef.suspects.find((s) => s.id !== KASE.solution.culprit)!.id, clues: 2 });
    const c = computeResult(verify(wrong.raw), KASE, TIER, undefined, V4);
    expect([c.verdict, c.correct, c.score, c.scoreBreakdown?.timeBonus, c.scoreBreakdown?.accusation]).toEqual(['egg_secured_mystery_unsolved', false, 925, 0, 0]);
    // left unsolved (accuse null): no accusation bonus, still a finisher
    const unsolved = v4Run({ suspect: null, hints: 0, detections: 0, noHits: true, t: 200 });
    expect(computeResult(verify(unsolved.raw), KASE, TIER, undefined, V4)).toMatchObject({ verdict: 'not_accused', score: 1000 + 300 + 150 + 150 + 100 });
  });

  it('the time bonus uses the stored 1-dp active time (round1 of egg_delivered t), exactly like the SQL CHECK', () => {
    for (const [t, bonus] of [[299.94, 1], [299.95, 0], [70.04, 230], [119.999, 180]] as const) {
      const r = computeResult(verify(v4Run({ t, hints: 0, detections: 0, noHits: true }).raw), KASE, TIER, undefined, V4);
      expect([r.activeTimeS, r.scoreBreakdown?.timeBonus], `t=${t}`).toEqual([round1(t), bonus]);
    }
  });

  it('the total is clamped at 0 (many blocked Slurp hits + hints) and the run still finishes (ranked above every DNF)', () => {
    const { raw, push } = builder();
    for (let i = 0; i < 12; i++) push('hint_requested', 1 + i, { level: 3 });
    for (let i = 0; i < 16; i++) push('enemy_hit', 20 + i, { enemy: 'slurp', hpLost: 0, blocked: true });
    push('egg_pickup', 40);
    push('egg_delivered', 400, { tier: TIER, points: POINTS, security: 100 });
    push('accusation', 400, { suspectId: null, correct: false, cluesFound: 0, evidence: [], deductionCorrect: false });
    push('finish', 400, { verdict: 'not_accused', score: 0 });
    const r = computeResult(verify(raw), KASE, TIER, undefined, V4);
    expect([r.outcome, r.score, r.scoreBreakdown?.total, r.hits, r.hintsUsed]).toEqual(['finished', 0, 0, 16, 12]);
    expect(1000 + 0 + 0 + 150 + 0 + 0 - 600 - 1200).toBeLessThan(0);
    // DNF never outranks a finisher, even one with score 0
    const finisher = { outcome: 'finished' as const, score: 0, activeTimeS: 400 };
    const dnf = { outcome: 'dnf' as const, score: null, activeTimeS: 10 };
    expect([dnf, finisher].sort(compareResults)).toEqual([finisher, dnf]);
  });

  it('a v4 DNF: score null, no breakdown, counts kept, defeatedBy from the last hit', () => {
    const { raw, push } = builder();
    push('hint_requested', 5, { level: 1 });
    push('enemy_detected', 6, { enemy: 'slurp', via: 'proximity' });
    for (let i = 0; i < 4; i++) push('enemy_hit', 10 + i * 5, { enemy: 'slurp', hpLost: 25, blocked: false });
    push('dnf', 25, { reason: 'hp_depleted', by: 'slurp' });
    const r = computeResult(verify(raw), KASE, TIER, { outcome: 'dnf', score: null, defeatedBy: 'slurp', hits: 4, detections: 1, hintsUsed: 1 }, V4);
    expect(r).toMatchObject({ outcome: 'dnf', dnfReason: 'hp_depleted', score: null, scoreBreakdown: null, defeatedBy: 'slurp',
      hits: 4, detections: 1, hintsUsed: 1, eggPoints: 0, verdict: 'not_accused', claimMatches: true });
    expect(computeResult(verify(raw), KASE, TIER, { outcome: 'dnf', score: null, defeatedBy: 'hyde' }, V4).claimMatches).toBe(false);
  });

  it('honest v4 client claims (RunResult incl. the breakdown) match; lies are recorded and flagged, never trusted', () => {
    const r = v4Run();
    const p = verify(r.raw);
    const honest = sanitizeClientResult({
      rulesVersion: V4, outcome: 'finished', verdict: r.verdict, score: r.breakdown.total, activeTimeS: 150, caseId: KASE.caseDef.id,
      correct: true, deductionCorrect: true, evidence: r.evidence, hintsUsed: 3, detections: 2, hits: 3, defeatedBy: null,
      scoreBreakdown: { ...r.breakdown, extra: 99, timeBonus: r.breakdown.timeBonus },
    })!;
    expect(honest.scoreBreakdown).toEqual(r.breakdown); // unknown parts dropped
    expect(computeResult(p, KASE, TIER, honest, V4).claimMatches).toBe(true);
    for (const lie of [{ hintsUsed: 0 }, { detections: 0 }, { hits: 1 }, { rulesVersion: V31 }, { score: r.breakdown.total + 150 },
      { scoreBreakdown: { ...r.breakdown, noHints: 150 } }]) {
      const res = computeResult(p, KASE, TIER, { ...honest, ...lie }, V4);
      expect(res.claimMatches, JSON.stringify(lie)).toBe(false);
      expect(res.score).toBe(1375); // the server's number stands
    }
  });

  it('every case: accusing its culprit (Galpin in Case 02) earns the +300; Isaac Night is not a suspect any more', () => {
    for (const caseId of CASE_IDS) {
      const kase = resolveCase(caseId, data.cases[caseId].version);
      const ctx = rulesContext(SEED, kase.caseDef, egg, PLAYER_MAX_HP, V4);
      const tier = ctx.expectedTier!;
      const clues = kase.caseDef.clues.map((c) => c.id);
      const play = (suspectId: string) => {
        const { raw, push } = builder();
        clues.forEach((c, i) => push('clue_found', 10 + i, { clueId: c, cluesFound: i + 1 }));
        push('egg_pickup', 20);
        push('egg_delivered', 100, { tier, points: ctx.eggPoints[tier], security: 100 });
        push('accusation', 100, { suspectId, correct: false, cluesFound: 3, evidence: [...kase.solution.supportingEvidence], deductionCorrect: false });
        push('finish', 100, { verdict: 'case_solved', score: 0 });
        return computeResult(verify(raw, ctx), kase, tier, undefined, V4);
      };
      const solved = play(kase.solution.culprit);
      expect([solved.verdict, solved.correct, solved.scoreBreakdown?.accusation, solved.score], caseId).toEqual(['case_solved', true, 300, 2100]);
      for (const s of kase.caseDef.suspects.filter((x) => x.id !== kase.solution.culprit)) {
        expect([play(s.id).correct, play(s.id).scoreBreakdown?.accusation], `${caseId} ${s.id}`).toEqual([false, 0]);
      }
      expect(kase.caseDef.suspects.map((s) => s.id).sort(), caseId).toEqual([...SUSPECT_IDS].sort());
    }
    expect(data.solutions.crypt_last_witness.culprit, "Case 02's culprit is Françoise Galpin").toBe('galpin');
    // an unknown suspect id (e.g. the retired 'isaac') is refused by the validator
    const ctx = rulesContext(SEED, data.cases.crypt_last_witness, egg, PLAYER_MAX_HP, V4);
    const t = ctx.expectedTier!;
    const deposit = [{ type: 'egg_pickup', t: 10, seq: 0 }, { type: 'egg_delivered', t: 20, seq: 1, tier: t, points: ctx.eggPoints[t], security: 100 },
      { type: 'accusation', t: 20, seq: 2, suspectId: 'isaac', correct: false, cluesFound: 0, evidence: [], deductionCorrect: false }];
    expect(code(() => verify(deposit, ctx))).toBe('EVENT_REJECTED:suspect_unknown');
  });
});

// ------------------------------------------------------------------------------------------------- separation
describe('v3.1 / v4 separation (old scores never mix)', () => {
  it('new sessions are created under mystery-v4; both versions stay verifiable', () => {
    expect(MYSTERY_RULES_VERSION).toBe(V4);
    expect([...RULES_VERSIONS]).toEqual([V31, V4]);
    expect(sessionRulesVersion(V31)).toBe(V31);
    expect(code(() => sessionRulesVersion('mystery-v3'))).toBe('INTERNAL:');
    expect(rulesContext(SEED, KASE.caseDef, egg).rulesVersion).toBe(V4);
  });

  it('the SAME validated v3.1-shaped run scores with each session\'s own formula', () => {
    const { raw, push } = builder();
    CLUES.forEach((c, i) => push('clue_found', 10 + i, { clueId: c, cluesFound: i + 1 }));
    push('hint_requested', 15);
    push('egg_pickup', 20);
    push('egg_delivered', 123.45, { tier: TIER, points: POINTS, security: 100 });
    push('accusation', 123.45, { suspectId: KASE.solution.culprit, correct: true, cluesFound: 3, evidence: [...KASE.solution.supportingEvidence], deductionCorrect: true });
    push('finish', 123.45, { verdict: 'case_solved', score: scoreFor(POINTS, 123.45) });
    const p31 = verify(raw, CTX31);
    const p4 = verify(raw, CTX4);
    const old = computeResult(p31, KASE, TIER, undefined, V31);
    const neu = computeResult(p4, KASE, TIER, undefined, V4);
    expect(old).toMatchObject({ rulesVersion: V31, score: scoreFor(POINTS, 123.45), detections: null, hits: null, scoreBreakdown: null, claimMatches: true });
    expect(neu).toMatchObject({ rulesVersion: V4, score: 1000 + 300 + 300 + 150 + 0 + 177 - 50, detections: 0, hits: 0 });
    expect(neu.claimMatches).toBe(false); // the client claimed a v3.1 score in a v4 session
  });

  it('finalize body: v4 claim keys survive sanitizing; junk does not', () => {
    const body = parseMysteryFinalize({ sessionId: SID, clientResult: {
      outcome: 'finished', hintsUsed: 2, detections: 1, hits: 0, defeatedBy: null, rulesVersion: V4,
      scoreBreakdown: { delivery: 1000, total: 'lots', nested: { a: 1 } }, hp: 100, secret: 'x', accused: 'galpin',
    } });
    expect(body.clientResult).toEqual({ outcome: 'finished', hintsUsed: 2, detections: 1, hits: 0, defeatedBy: null, rulesVersion: V4,
      scoreBreakdown: { delivery: 1000 }, hp: 100, accused: 'galpin' });
    expect([...SCORE_BREAKDOWN_KEYS].sort()).toEqual(['accusation', 'clues', 'delivery', 'hintPenalty', 'hitPenalty', 'noDetection', 'noHints', 'timeBonus', 'total']);
  });
});

// ------------------------------------------------------------------------------------------------- drift guards
const sharedTypes = readFileSync(join(ROOT, 'supabase/functions/_shared/mystery/types.ts'), 'utf8');
const literals = (s: string) => [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);
function unionOf(name: string): string[] {
  const m = sharedTypes.match(new RegExp(`export type ${name} =([^;]*);`));
  if (!m) throw new Error(`type ${name} not found in the synced types.ts`);
  return literals(m[1]);
}
const gameEventLines = (() => {
  const start = sharedTypes.indexOf('export type GameEvent =');
  const end = sharedTypes.indexOf('};', start);
  return sharedTypes.slice(start, end + 2).split('\n');
})();
const member = (type: string) => {
  const l = gameEventLines.find((x) => x.includes(`type: '${type}'`));
  if (!l) throw new Error(`GameEvent member ${type} not found in the synced types.ts`);
  return l;
};
const between = (l: string, from: string, to?: string) => l.slice(l.indexOf(from) + from.length, to ? l.indexOf(to, l.indexOf(from)) : undefined);
const sorted = (xs: readonly (string | number)[]) => [...new Set(xs.map(String))].sort();

const MIGRATIONS = join(ROOT, 'supabase/migrations');
const migrationFiles = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
/** The literal list of the LATEST definition (migration order) of `<constraint> check (<col> in (...))`. */
function latestCheckList(constraint: string, column: string): string[] {
  let last: string[] | null = null;
  for (const file of migrationFiles) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    for (const m of sql.matchAll(new RegExp(`${constraint}\\s+check\\s*\\(\\s*${column}\\s+in\\s*\\(([^)]*)\\)`, 'gi'))) last = literals(m[1]);
  }
  if (!last) throw new Error(`${constraint} not found in supabase/migrations`);
  return last;
}
const v4Sql = readFileSync(join(MIGRATIONS, '20261025000100_mystery_v4.sql'), 'utf8');

describe('drift guards: server enums == synced types.ts == SQL CHECKs', () => {
  it('EnemyId, SlurpMode and the inline unions of the final-wave GameEvent members', () => {
    expect(sorted(ENEMY_IDS)).toEqual(sorted(unionOf('EnemyId')));
    expect(sorted(SLURP_MODES)).toEqual(sorted(unionOf('SlurpMode')));
    expect(member('enemy_spawned')).toMatch(/enemy: EnemyId; spawnId: string; x: number; z: number/);
    expect(sorted(DESPAWN_REASONS)).toEqual(sorted(literals(between(member('enemy_despawned'), 'reason:'))));
    expect(sorted(DETECT_VIA)).toEqual(sorted(literals(between(member('enemy_detected'), 'via:'))));
    expect(member('enemy_hit')).toMatch(/enemy: EnemyId; hpLost: number; blocked: boolean/);
    expect(member('slurp_mode')).toMatch(/from: SlurpMode; to: SlurpMode; reason:/);
    expect(sorted(SLURP_REASONS)).toEqual(sorted(literals(between(member('slurp_mode'), 'reason:'))));
    expect(sorted(CABINET_ACTIONS)).toEqual(sorted(literals(between(member('cabinet'), 'action:', 'loud'))));
    expect(sorted([...between(member('hint_requested'), 'level?:', '}').matchAll(/\d+/g)].map((m) => m[0]))).toEqual(['1', '2', '3']);
    expect(member('dnf')).toMatch(/by\?: EnemyId \| null/);
    for (const type of [...DIRECTOR_TELEMETRY_TYPES, 'enemy_detected', 'enemy_hit']) {
      const keys = [...between(member(type), `type: '${type}';`, '}').matchAll(/(\w+)\??:/g)].map((k) => k[1]);
      expect(sorted(keys), type).toEqual(sorted(eventFieldNames(type as never)));
    }
  });

  it('ScoreBreakdown parts == the claim sanitizer keys == the SQL v4 score CHECK keys', () => {
    const block = sharedTypes.slice(sharedTypes.indexOf('export interface ScoreBreakdown'), sharedTypes.indexOf('}', sharedTypes.indexOf('export interface ScoreBreakdown')));
    const keys = [...block.matchAll(/^\s+(\w+): number;/gm)].map((m) => m[1]);
    expect(sorted(keys)).toEqual(sorted(SCORE_BREAKDOWN_KEYS));
    for (const k of SCORE_BREAKDOWN_KEYS) expect(v4Sql, `SQL checks score_breakdown -> '${k}'`).toContain(`score_breakdown -> '${k}'`);
  });

  it('SQL CHECKs: rules versions, suspects (+ galpin, isaac kept), defeated_by, clue ids, event types, rule index', () => {
    expect(sorted(latestCheckList('mystery_sessions_rules_version_check', 'rules_version'))).toEqual(sorted(RULES_VERSIONS));
    expect(sorted(latestCheckList('mystery_results_rules_version_check', 'rules_version'))).toEqual(sorted(RULES_VERSIONS));
    const accused = latestCheckList('mystery_results_accused_check', 'accused');
    expect(SUSPECT_IDS.filter((s) => !accused.includes(s)), 'every current suspect id is storable').toEqual([]);
    expect(accused, 'v3.1 rows that accused Isaac stay valid').toContain('isaac');
    const defeated = v4Sql.match(/mystery_results_defeated_by_check check \([^;]*?defeated_by in \(([^)]*)\)/);
    expect(defeated, 'defeated_by CHECK').not.toBeNull();
    expect(sorted(literals(defeated![1]))).toEqual(sorted(ENEMY_IDS));
    const clueCheck = latestCheckList('mystery_clue_events_clue_id_check', 'clue_id');
    expect(CLUE_IDS.filter((c) => !clueCheck.includes(c)), 'every ClueId fits mystery_clue_events').toEqual([]);
    expect(sorted(latestCheckList('mystery_events_type_check', 'type'))).toEqual(sorted(MYSTERY_EVENT_TYPES));
    const idx = [...v4Sql.matchAll(/create index mystery_events_rule_idx[^;]*?where type in \(([^)]*)\)/gi)].map((m) => literals(m[1]));
    expect(idx).toHaveLength(1);
    expect(sorted(idx[0]!)).toEqual(sorted(RULE_EVENT_TYPES));
  });

  it('forecast targets: slurp_risk / enemy_spawn are accepted probabilities; server == SQL CHECK ⊇ every client target', async () => {
    const f = (target: string, value: number, features: Record<string, unknown>) =>
      ({ forecastNo: 0, t: 30, target, value, modelLabel: 'rule_based', features });
    const body = parseMysteryAppend({ sessionId: SID, events: [], forecasts: [
      f('slurp_risk', 0.31, { enemy: 'slurp', zone: 'z_crypt' }),
      { ...f('slurp_risk', 0.05, { enemy: 'slurp', cell: '12_7' }), forecastNo: 1 },
      { ...f('enemy_spawn', 0.42, { enemy: 'crackstone', spawn: 'sp_crypt_gate', area: 'a_crypt' }), forecastNo: 2 },
      { ...f('enemy_spawn', 1.2, { enemy: 'hyde', spawn: 'sp_east', area: 'a_east' }), forecastNo: 3 },
      { ...f('slurp_risk', -0.1, { enemy: 'slurp' }), forecastNo: 4 },
    ] });
    expect(body.forecasts.map((x) => [x.target, x.value])).toEqual([['slurp_risk', 0.31], ['slurp_risk', 0.05], ['enemy_spawn', 0.42]]);
    expect(body.dropped.forecasts).toBe(2); // out-of-range probabilities are dropped, never rejecting the batch
    expect(sorted(latestCheckList('mystery_forecasts_target_check', 'target'))).toEqual(sorted(FORECAST_TARGETS));
    const client = await import('../../../src/mystery/analytics/types.ts') as {
      FORECAST_TARGETS?: readonly string[]; LOCAL_ONLY_FORECAST_TARGETS?: readonly string[];
    };
    const tele = await import('../../../src/mystery/analytics/telemetry.ts') as { UPLOAD_FORECAST_TARGETS?: readonly string[] };
    const clientAll = [...(client.FORECAST_TARGETS ?? []), ...(client.LOCAL_ONLY_FORECAST_TARGETS ?? []), ...(tele.UPLOAD_FORECAST_TARGETS ?? [])];
    expect(clientAll.length).toBeGreaterThan(8);
    expect(clientAll.filter((t) => !(FORECAST_TARGETS as readonly string[]).includes(t)), 'every client target is accepted by the server').toEqual([]);
    const union = readFileSync(join(ROOT, 'src/mystery/analytics/types.ts'), 'utf8').match(/export type ForecastTarget =([^;]*);/);
    expect(union, 'ForecastTarget union').not.toBeNull();
    expect(sorted(literals(union![1])), 'ForecastTarget union == server FORECAST_TARGETS').toEqual(sorted(FORECAST_TARGETS));
  });

  it('every case is at content version ≥ 3 (final wave) with a matching answer key', () => {
    for (const caseId of CASE_IDS) {
      expect(data.cases[caseId].version, caseId).toBeGreaterThanOrEqual(3);
      expect(data.solutions[caseId].version, caseId).toBe(data.cases[caseId].version);
    }
  });

  it('the public v4 views never expose secrets', () => {
    for (const view of ['mystery_leaderboard_v4', 'mystery_defeated_v4', 'mystery_standings_v4', 'mystery_top5']) {
      const def = v4Sql.slice(v4Sql.indexOf(`create view public.${view}`), v4Sql.indexOf(';', v4Sql.indexOf(`create view public.${view}`)));
      expect(def.length, view).toBeGreaterThan(50);
      for (const secret of ['seed', 'accused', 'evidence', 'client_claim', 'claim_matches']) expect(def, `${view} exposes ${secret}`).not.toMatch(new RegExp(`\\b${secret}\\b`));
    }
  });
});
