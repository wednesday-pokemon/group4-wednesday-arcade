// Strict request-body parsers for the mystery-v3.1 functions. Pure module; unit-tested under Node/Vitest.
// Same rules as validation.ts: JSON object bodies, unknown keys rejected, every field type/range checked.
// The station is NEVER taken from a body (it comes from the caller's JWT -> app_users binding).
import { isPokemonId, sanitizeNickname } from './game/index.ts';
import type { PokemonId } from './game/index.ts';
import { NIGHTSHADE_IDS } from './mystery/types.ts';
import type { CaseId, NightshadeId } from './mystery/types.ts';
import { isCaseId } from './mystery/data/cases.ts';
import { HttpError } from './errors.ts';
import { asObject, isActionId, isUuid, sanitizeNote } from './validation.ts';
import { MAX_T, parseEventBatch, type ParsedEvent } from './mystery-events.ts';

/** Body cap for mystery-append-events (≤ 500 events + analytics records). Other mystery functions use 4 KB. */
export const MAX_APPEND_BYTES = 262_144;
export const MAX_FINALIZE_BYTES = 8192;
export const MAX_ANALYTICS_PER_BATCH = 50;
const SEED_RE = /^[0-9a-f]{32}$/;
const MODEL_VERSION_RE = /^[A-Za-z0-9._-]{1,32}$/;
const ACTION_RE = /^[a-z][a-z0-9_]{0,39}$/;
const OUTCOME_RE = /^[a-z][a-z0-9_]{0,31}$/;

type Json = Record<string, unknown>;

function invalid(field: string, message: string): never {
  throw new HttpError('INVALID_INPUT', message, { field });
}

function onlyKeys(body: Json, allowed: readonly string[], prefix = ''): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) invalid(prefix + key, `Unknown field "${(prefix + key).slice(0, 60)}"`);
  }
}

function sessionId(body: Json, required: true): string;
function sessionId(body: Json, required: false): string | undefined;
function sessionId(body: Json, required: boolean): string | undefined {
  const v = body.sessionId;
  if (v === undefined && !required) return undefined;
  const lowered = typeof v === 'string' ? v.toLowerCase() : v;
  if (!isUuid(lowered)) invalid('sessionId', 'sessionId must be a UUID');
  return lowered;
}

export function isNightshadeId(x: unknown): x is NightshadeId {
  return typeof x === 'string' && (NIGHTSHADE_IDS as readonly string[]).includes(x);
}

// ------------------------------------------------------------------------------------------------- create
export interface MysteryCreateBody {
  actionId: string;
  nickname: string; // sanitized
  testSeed?: string; // only when MYSTERY_ALLOW_TEST_SEEDS=true; the session is then is_test (never ranked)
  testCase?: CaseId; // only together with testSeed (same flag): forces the session's case instead of the station bag
}

export function parseMysteryCreate(raw: unknown, allowTestSeeds: boolean): MysteryCreateBody {
  const body = asObject(raw);
  onlyKeys(body, ['actionId', 'nickname', 'testSeed', 'testCase']);
  if (!isActionId(body.actionId)) invalid('actionId', 'actionId must be 8-64 characters of [A-Za-z0-9_-] (use crypto.randomUUID())');
  if (typeof body.nickname !== 'string' || body.nickname.length > 64) invalid('nickname', 'nickname must be a string');
  const nick = sanitizeNickname(body.nickname);
  if (!nick.ok) invalid('nickname', nick.message);
  const out: MysteryCreateBody = { actionId: body.actionId, nickname: nick.value };
  if (body.testSeed !== undefined && body.testSeed !== null) {
    if (!allowTestSeeds) throw new HttpError('TEST_SEED_FORBIDDEN', 'Seed reuse is disabled on this deployment', { field: 'testSeed' });
    if (typeof body.testSeed !== 'string' || !SEED_RE.test(body.testSeed)) invalid('testSeed', 'testSeed must be 32 lowercase hex characters');
    out.testSeed = body.testSeed;
  }
  if (body.testCase !== undefined && body.testCase !== null) {
    if (!allowTestSeeds) throw new HttpError('TEST_SEED_FORBIDDEN', 'Forcing a case is disabled on this deployment', { field: 'testCase' });
    if (!isCaseId(body.testCase)) invalid('testCase', 'testCase must be one of the three case ids');
    if (out.testSeed === undefined) invalid('testCase', 'testCase is only accepted together with testSeed (an unranked test session)');
    out.testCase = body.testCase;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------- get / select
export function parseMysteryGet(raw: unknown): { sessionId?: string } {
  const body = asObject(raw);
  onlyKeys(body, ['sessionId']);
  const id = sessionId(body, false);
  return id === undefined ? {} : { sessionId: id };
}

export interface MysterySelectBody {
  sessionId: string;
  characterId: NightshadeId;
  pokemonId: PokemonId;
}

export function parseMysterySelect(raw: unknown): MysterySelectBody {
  const body = asObject(raw);
  onlyKeys(body, ['sessionId', 'characterId', 'pokemonId']);
  if (!isNightshadeId(body.characterId)) invalid('characterId', 'characterId must be one of the seven Nightshades');
  if (!isPokemonId(body.pokemonId)) invalid('pokemonId', 'Unknown pokemonId');
  return { sessionId: sessionId(body, true), characterId: body.characterId, pokemonId: body.pokemonId };
}

// ------------------------------------------------------------------------------------------------- append
/**
 * Forecast targets (mirrored by the mystery_forecasts_target_check constraint, latest: migration 20261024000100; the client list
 * is src/mystery/analytics/types.ts FORECAST_TARGETS). Every target except `eta_s` (seconds) is a probability in [0, 1].
 * Overhaul targets (2026-10-23) state the probability of ONE candidate, named by a flat string feature (the client
 * currently issues the top candidate; one row per candidate is equally valid):
 *   egg_site   P(the egg rests at site)            features.site  = EggSiteDef id   (Bayesian posterior)
 *   clue_area  P(area holds ≥ 1 uncollected clue)  features.area  = AreaDef id
 *   hyde_zone  P(the Hyde is in zone)              features.zone  = ZoneDef id      (zone filter, after emergence)
 *   hyde_spawn P(the Hyde emerges at spawn)        features.spawn = HydeSpawnDef id (before emergence)
 * Enemy contract (2026-10-24, migration 20261024000100):
 *   crackstone_risk  P(Joseph Crackstone can see / scan the player within the forecast horizon) — RULE-BASED estimate
 *                    from his public patrol route + sight / scan rules (modelLabel 'rule_based'); optional flat
 *                    features (e.g. horizon_s, area, mode) — none required.
 * Final wave (2026-10-24, migration 20261025000100):
 *   slurp_risk   P(Slurp finds the player within the horizon) — RULE-BASED; features e.g. {enemy:'slurp', zone?, cell?}
 *   enemy_spawn  P(an INACTIVE enemy appears at one spawn) — the director's exact distribution; features {enemy, spawn, area}
 * Features stay ≤ 40 flat primitives (keys ≤ 40 chars, strings ≤ 40 chars); nothing is required, so a renamed feature
 * can never reject an upload.
 */
export const FORECAST_TARGETS = [
  'detection_15s', 'extraction', 'eta_s', 'egg_site', 'clue_area', 'hyde_zone', 'hyde_spawn', 'crackstone_risk',
  'slurp_risk', 'enemy_spawn',
] as const;
export type ForecastTarget = (typeof FORECAST_TARGETS)[number];

export function isForecastTarget(x: unknown): x is ForecastTarget {
  return typeof x === 'string' && (FORECAST_TARGETS as readonly string[]).includes(x);
}

export interface ForecastIn {
  forecastNo: number;
  t: number;
  target: ForecastTarget;
  value: number;
  modelLabel: 'ml' | 'rule_based';
  modelVersion: string | null;
  features: Record<string, number | boolean | string | null>;
}

export interface RecommendationIn {
  recNo: number;
  t: number;
  action: string;
  advice: string;
  trigger: 'hint' | 'context';
  accepted: boolean | null;
  outcome: string | null;
}

function intIn(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) invalid(field, `${field} must be an integer between ${min} and ${max}`);
  return v;
}

function simTime(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_T) invalid(field, `${field} must be active seconds between 0 and ${MAX_T}`);
  return v;
}

export function parseForecast(raw: unknown, i: number): ForecastIn {
  const f = `forecasts[${i}]`;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) invalid(f, `${f} must be an object`);
  const o = raw as Json;
  onlyKeys(o, ['forecastNo', 't', 'target', 'value', 'modelLabel', 'modelVersion', 'features'], `${f}.`);
  const target = o.target;
  if (!isForecastTarget(target)) invalid(`${f}.target`, `target must be one of ${FORECAST_TARGETS.join(', ')}`);
  const value = o.value;
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(`${f}.value`, 'value must be a finite number');
  if (target !== 'eta_s' && (value < 0 || value > 1)) invalid(`${f}.value`, 'a probability must be between 0 and 1');
  if (target === 'eta_s' && (value < 0 || value > 100000)) invalid(`${f}.value`, 'eta_s must be between 0 and 100000');
  if (o.modelLabel !== 'ml' && o.modelLabel !== 'rule_based') invalid(`${f}.modelLabel`, 'modelLabel must be "ml" or "rule_based"');
  let modelVersion: string | null = null;
  if (o.modelVersion !== undefined && o.modelVersion !== null) {
    if (typeof o.modelVersion !== 'string' || !MODEL_VERSION_RE.test(o.modelVersion)) invalid(`${f}.modelVersion`, 'modelVersion must match [A-Za-z0-9._-]{1,32}');
    modelVersion = o.modelVersion;
  }
  const feats = o.features;
  if (feats === null || typeof feats !== 'object' || Array.isArray(feats)) invalid(`${f}.features`, 'features must be an object');
  const entries = Object.entries(feats as Json);
  if (entries.length > 40) invalid(`${f}.features`, 'at most 40 features');
  for (const [k, v] of entries) {
    const ok = k.length <= 40 && (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 40));
    if (!ok) invalid(`${f}.features`, 'features must map short names to numbers, booleans, short strings or null');
  }
  return {
    forecastNo: intIn(o.forecastNo, `${f}.forecastNo`, 0, 100000),
    t: simTime(o.t, `${f}.t`),
    target, value, modelLabel: o.modelLabel, modelVersion,
    features: feats as ForecastIn['features'],
  };
}

export function parseRecommendation(raw: unknown, i: number): RecommendationIn {
  const f = `recommendations[${i}]`;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) invalid(f, `${f} must be an object`);
  const o = raw as Json;
  onlyKeys(o, ['recNo', 't', 'action', 'advice', 'trigger', 'accepted', 'outcome'], `${f}.`);
  if (typeof o.action !== 'string' || !ACTION_RE.test(o.action)) invalid(`${f}.action`, 'action must be a snake_case id (≤ 40 chars)');
  if (typeof o.advice !== 'string' || o.advice.length > 480) invalid(`${f}.advice`, 'advice must be a short string');
  const advice = sanitizeNote(o.advice).slice(0, 240).trim();
  if (advice.length < 1) invalid(`${f}.advice`, 'advice must not be empty');
  const trigger = o.trigger ?? 'hint';
  if (trigger !== 'hint' && trigger !== 'context') invalid(`${f}.trigger`, 'trigger must be "hint" or "context"');
  if (o.accepted !== undefined && o.accepted !== null && typeof o.accepted !== 'boolean') invalid(`${f}.accepted`, 'accepted must be a boolean or null');
  if (o.outcome !== undefined && o.outcome !== null && (typeof o.outcome !== 'string' || !OUTCOME_RE.test(o.outcome))) {
    invalid(`${f}.outcome`, 'outcome must be a snake_case id (≤ 32 chars) or null');
  }
  return {
    recNo: intIn(o.recNo, `${f}.recNo`, 0, 100000),
    t: simTime(o.t, `${f}.t`),
    action: o.action, advice, trigger,
    accepted: (o.accepted as boolean | null | undefined) ?? null,
    outcome: (o.outcome as string | null | undefined) ?? null,
  };
}

/** Analytics records that failed validation and were left out of the batch (counts + up to 5 reasons for the log). */
export interface DroppedAnalytics {
  forecasts: number;
  recommendations: number;
  reasons: string[];
}

export interface MysteryAppendBody {
  sessionId: string;
  events: ParsedEvent[];
  forecasts: ForecastIn[];
  recommendations: RecommendationIn[];
  dropped: DroppedAnalytics;
}

const MAX_DROP_REASONS = 5;

/**
 * Analytics records are BEST-EFFORT (since the 2026-10-23 overhaul): the list itself must be well-formed (an array of at
 * most MAX_ANALYTICS_PER_BATCH entries), but a single invalid record — a NaN posterior, a 41-character feature string, an
 * unknown target, a repeated number — is DROPPED and counted instead of rejecting the request. A rejected append stops
 * the kiosk's upload and leaves the visitor's run unverified (off the leaderboard), which an analytics row must never
 * cause. Events stay strict (they are the verified record). Every accepted record still satisfies every SQL CHECK.
 */
function analyticsList<T>(
  raw: unknown, field: 'forecasts' | 'recommendations', parse: (x: unknown, i: number) => T, key: (x: T) => number,
  reasons: string[],
): { items: T[]; dropped: number } {
  if (raw === undefined || raw === null) return { items: [], dropped: 0 };
  if (!Array.isArray(raw)) invalid(field, `${field} must be an array`);
  if (raw.length > MAX_ANALYTICS_PER_BATCH) invalid(field, `at most ${MAX_ANALYTICS_PER_BATCH} ${field} per batch`);
  const items: T[] = [];
  const seen = new Set<number>();
  let dropped = 0;
  raw.forEach((x, i) => {
    try {
      const v = parse(x, i);
      if (seen.has(key(v))) invalid(`${field}[${i}]`, `${field}[${i}] repeats a number already in this batch`);
      seen.add(key(v));
      items.push(v);
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      dropped++;
      if (reasons.length < MAX_DROP_REASONS) reasons.push(`${String(e.details?.field ?? field)}: ${e.message}`.slice(0, 160));
    }
  });
  return { items, dropped };
}

export function parseMysteryAppend(raw: unknown): MysteryAppendBody {
  const body = asObject(raw);
  onlyKeys(body, ['sessionId', 'events', 'forecasts', 'recommendations']);
  const reasons: string[] = [];
  const forecasts = analyticsList(body.forecasts, 'forecasts', parseForecast, (x) => x.forecastNo, reasons);
  const recommendations = analyticsList(body.recommendations, 'recommendations', parseRecommendation, (x) => x.recNo, reasons);
  // an analytics-only call (no events) stays valid even when every record in it was dropped
  const sentAnalytics = forecasts.items.length + forecasts.dropped + recommendations.items.length + recommendations.dropped;
  const events = parseEventBatch(body.events ?? [], sentAnalytics > 0);
  return {
    sessionId: sessionId(body, true), events, forecasts: forecasts.items, recommendations: recommendations.items,
    dropped: { forecasts: forecasts.dropped, recommendations: recommendations.dropped, reasons },
  };
}

// ------------------------------------------------------------------------------------------------- finalize
export interface MysteryFinalizeBody {
  sessionId: string;
  clientResult?: Record<string, unknown>;
}

const CLAIM_KEYS = ['outcome', 'dnfReason', 'verdict', 'accused', 'correct', 'cluesFound', 'eggTier', 'eggPoints', 'eggSecurity',
  'activeTimeS', 'score', 'catches', 'hp', 'caseId', 'caseVersion', 'evidence', 'deductionCorrect',
  // mystery-v4 (RunResult final fields)
  'rulesVersion', 'hintsUsed', 'detections', 'hits', 'defeatedBy', 'scoreBreakdown'];
/** Array-valued claim keys and their maximum length. */
const CLAIM_LISTS: Record<string, number> = { cluesFound: 3, evidence: 5 };
/** RunResult.scoreBreakdown parts (types.ts ScoreBreakdown): the only keys kept from a claimed breakdown. */
export const SCORE_BREAKDOWN_KEYS = ['delivery', 'accusation', 'clues', 'noDetection', 'noHints', 'timeBonus', 'hintPenalty',
  'hitPenalty', 'total'] as const;

/**
 * Keeps only known RunResult fields with primitive values (the claim is audit data, never trusted). A claimed
 * scoreBreakdown is reduced to its known numeric parts (finite numbers only; anything else is dropped).
 */
export function sanitizeClientResult(raw: unknown): Record<string, unknown> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) invalid('clientResult', 'clientResult must be an object');
  const out: Record<string, unknown> = {};
  for (const k of CLAIM_KEYS) {
    const v = (raw as Json)[k];
    if (v === undefined) continue;
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 40)) out[k] = v;
    else if (k in CLAIM_LISTS && Array.isArray(v) && v.length <= CLAIM_LISTS[k]! && v.every((c) => typeof c === 'string' && c.length <= 40)) out[k] = v;
    else if (k === 'scoreBreakdown' && typeof v === 'object' && !Array.isArray(v)) {
      const b: Record<string, number> = {};
      for (const part of SCORE_BREAKDOWN_KEYS) {
        const x = (v as Json)[part];
        if (typeof x === 'number' && Number.isFinite(x)) b[part] = x;
      }
      out[k] = b;
    }
  }
  return out;
}

export function parseMysteryFinalize(raw: unknown): MysteryFinalizeBody {
  const body = asObject(raw);
  onlyKeys(body, ['sessionId', 'clientResult']);
  const out: MysteryFinalizeBody = { sessionId: sessionId(body, true) };
  const claim = sanitizeClientResult(body.clientResult);
  if (claim) out.clientResult = claim;
  return out;
}
