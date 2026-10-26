// mystery-v3.1 event-stream validation. Pure module (no Deno APIs); unit-tested under Node/Vitest.
//
// The browser runs the sim; the server cannot replay movement (no inputs are sent), so it validates what it CAN:
//   * structure: known event type, typed payload, finite numbers, bounded strings, no extra top-level fields
//   * ordering:  strictly increasing seq, non-decreasing t (active sim seconds)
//   * rules:     clue ids valid and unique; egg_pickup before egg_drop/egg_delivered; delivered tier = seed tier and
//                points = tier points; accusation only after egg_delivered, at most once (≤ 5 cited evidence ids,
//                kept raw here and sanitized by finalize with the shared caseLogic.sanitizeEvidence); finish only after the
//                accusation; at most one terminal event (finish | dnf); nothing after it; catches numbered 1, 2;
//                dnf 'second_catch' only after catch #2; no catch / dnf / clue after the deposit.
// Claims the client makes (accusation.correct / deductionCorrect, finish.verdict/score) are NOT trusted: finalize
// recomputes them from the session's case + the server's own answer key and records whether they matched
// (mystery_results.claim_matches). The clue ids come from the SESSION'S case (RulesContext.clueIds).
//
// Overhaul telemetry (2026-10-23, docs/overhaul/OVERHAUL_CONTRACT.md): hyde_emerged, site_checked, trace_found,
// examined, passage_opened, hazard_triggered (+ noise source 'hazard'). They are TELEMETRY, not rule events: typed and
// bounded here, stored for analytics, never part of RULE_EVENT_TYPES / ruleFingerprint / computeResult. The server never
// needs clue or egg POSITIONS (the per-session layout is drawn by the browser sim from the seed); it only checks ids.
//
// Joseph Crackstone (2026-10-24, docs/overhaul/ENEMY_CONTRACT.md, migration 20261024000100): crackstone_mode,
// crackstone_sighted, crackstone_lost and crackstone_scan are TELEMETRY (same policy as above; crackstone_sighted does
// NOT feed `sightings`, which stays the Hyde-sighting count of mystery_sessions / mystery_results). `curse` is a RULE
// event (rule R7: a landed curse costs HP but is not a catch): strict payload; phase 'hit' adds hpLost to progress.hpLost
// and counts in progress.curses (both in ruleFingerprint); a blocked hit (block_grab) must report hpLost 0; 'cast' /
// 'miss' must report hpLost 0; no hit after the deposit. A dnf 'hp_depleted' is accepted only when the recorded HP loss
// (catches + curse hits) reaches the player's max HP (RulesContext.maxHp; heals only raise the bar, so this is a
// necessary condition of a genuine HP death) — the sim must emit `curse {phase:'hit'}` BEFORE its `dnf`.
import type { ClueId, DnfReason, EggState, SuspectId, Verdict } from './mystery/types.ts';
import { HttpError } from './errors.ts';
import { jsonEqual } from './validation.ts';

export type LiveEggTier = 'common' | 'rare' | 'legendary';

export const MYSTERY_EVENT_TYPES = [
  'noise', 'stance', 'room_enter', 'hyde_mode', 'hyde_heard', 'hyde_sighted', 'hyde_lost', 'catch',
  'clue_search_start', 'clue_found', 'egg_pickup', 'egg_drop', 'egg_damage', 'egg_delivered',
  'ability_used', 'ability_denied', 'hint_requested',
  // overhaul telemetry (not rule events)
  'hyde_emerged', 'site_checked', 'trace_found', 'examined', 'passage_opened', 'hazard_triggered',
  // Joseph Crackstone (enemy contract): four telemetry types + the `curse` rule event
  'crackstone_mode', 'crackstone_sighted', 'crackstone_lost', 'crackstone_scan', 'curse',
  'accusation', 'finish', 'dnf',
] as const;
export type MysteryEventType = (typeof MYSTERY_EVENT_TYPES)[number];

/**
 * Types the rules depend on (finalize re-validates exactly these from the database). Mirrored by the partial index
 * mystery_events_rule_idx (latest definition: migration 20261024000100, which added 'curse').
 */
export const RULE_EVENT_TYPES: readonly MysteryEventType[] = [
  'catch', 'clue_found', 'egg_pickup', 'egg_drop', 'egg_damage', 'egg_delivered', 'accusation', 'finish', 'dnf',
  'hyde_sighted', 'hint_requested', 'curse',
];

/** The six overhaul telemetry types (stored for analytics; no rule depends on them). */
export const OVERHAUL_TELEMETRY_TYPES: readonly MysteryEventType[] = [
  'hyde_emerged', 'site_checked', 'trace_found', 'examined', 'passage_opened', 'hazard_triggered',
];

/** Joseph Crackstone telemetry (analytics only; `curse` is NOT here — it is a rule event). */
export const CRACKSTONE_TELEMETRY_TYPES: readonly MysteryEventType[] = [
  'crackstone_mode', 'crackstone_sighted', 'crackstone_lost', 'crackstone_scan',
];

/** Content ids carried by telemetry (site / spawn / examine / passage / hazard / clue ids): snake_case, ≤ 40 chars. */
export const SAFE_ID_RE = /^[a-z][a-z0-9_]{0,39}$/;
/** Bound for world coordinates in telemetry payloads (the island is ~90 × 120 m). */
export const MAX_COORD_M = 1000;

export const MAX_T = 14400; // 4 h of ACTIVE play: far beyond any real run, rejects garbage
export const MAX_SEQ = 10_000_000;
export const MAX_BATCH_EVENTS = 500;
export const MAX_STRING = 160;
/** Evidence ids cited with one accusation (the deduction board offers three clues + two case-file notes). */
export const MAX_EVIDENCE = 5;
/** Distances carried by enemy telemetry (m). */
export const MAX_DISTANCE_M = 1000;
/** Crackstone's scan radius cap (m): a tuning radius is ~10–20 m; the whole island fits in ~150 m. */
export const MAX_SCAN_RADIUS_M = 100;
/** HP one landed curse may cost (the player has 100 max HP; a curse can never cost more than a full bar). */
export const MAX_CURSE_HP = 100;
/** Tolerance of the hp_depleted check (HP values are integers; this only absorbs float noise). */
export const HP_EPSILON = 0.5;

export interface RulesContext {
  clueIds: readonly ClueId[];
  suspectIds: readonly SuspectId[];
  eggPoints: Record<LiveEggTier, number>;
  /** Tier drawn from the session seed with the shared scoring module; null = do not check. */
  expectedTier: LiveEggTier | null;
  /**
   * The player's max HP (shared DEFAULT_TUNING.player.maxHp). A dnf 'hp_depleted' needs recorded HP loss (catch +
   * curse hits) ≥ maxHp. null / absent = do not check.
   */
  maxHp?: number | null;
}

/** A parsed, structurally valid event as stored in mystery_events. */
export interface ParsedEvent {
  seq: number;
  t: number;
  type: MysteryEventType;
  payload: Record<string, unknown>;
}

/** Rule-relevant state of a run, persisted in mystery_sessions.progress after every accepted batch. */
export interface MysteryProgress {
  v: 1;
  lastSeq: number; // -1 = nothing yet
  lastT: number;
  cluesFound: ClueId[];
  egg: EggState;
  eggSecurity: number;
  pickups: number;
  delivered: { seq: number; t: number; tier: LiveEggTier; points: number; security: number } | null;
  /**
   * suspectId null = the player left the case unsolved (verdict not_accused). `evidence` is the RAW cited list (≤ 5
   * short strings, unvalidated ids); finalize sanitizes it against the case. Claims are audit-only.
   */
  accusation: {
    seq: number; t: number; suspectId: SuspectId | null; evidence: string[];
    claimedCorrect: boolean; claimedClues: number; claimedDeduction: boolean;
  } | null;
  catches: number;
  /** HP lost to Hyde catches + landed Crackstone curses (as reported by the events; blocked hits report 0). */
  hpLost: number;
  /** Landed Crackstone curses (curse phase 'hit', blocked or not). Not a catch (rule R7). */
  curses: number;
  sightings: number;
  hints: number;
  terminal:
    | { type: 'finish'; seq: number; t: number; claimedVerdict: Verdict; claimedScore: number }
    | { type: 'dnf'; seq: number; t: number; reason: DnfReason }
    | null;
}

export function initialProgress(): MysteryProgress {
  return {
    v: 1, lastSeq: -1, lastT: 0, cluesFound: [], egg: 'resting', eggSecurity: 100, pickups: 0, delivered: null,
    accusation: null, catches: 0, hpLost: 0, curses: 0, sightings: 0, hints: 0, terminal: null,
  };
}

/** Restores progress from the jsonb column ({} for a fresh session). */
export function progressFromRow(raw: unknown): MysteryProgress {
  if (raw && typeof raw === 'object' && (raw as { v?: unknown }).v === 1) {
    const p = structuredClone(raw as MysteryProgress);
    // progress stored before the Crackstone fields existed: a curse-free run (no curse event could have been accepted)
    if (typeof p.curses !== 'number') p.curses = 0;
    if (typeof p.hpLost !== 'number') p.hpLost = 0;
    return p;
  }
  return initialProgress();
}

// ------------------------------------------------------------------------------------------------- errors
export function reject(seq: number | null, rule: string, message: string): never {
  throw new HttpError('EVENT_REJECTED', message, { seq, rule });
}

// ------------------------------------------------------------------------------------------------- payload schemas
type Field =
  | { k: 'num'; min: number; max: number }
  | { k: 'int'; min: number; max: number }
  | { k: 'bool' }
  | { k: 'enum'; values: readonly string[] }
  | { k: 'str' }
  | { k: 'id' } // SAFE_ID_RE
  | { k: 'nstr' } // string or null
  | { k: 'strs'; max: number; len: number };

const num = (min = -1e6, max = 1e6): Field => ({ k: 'num', min, max });
const int = (min: number, max: number): Field => ({ k: 'int', min, max });
const bool: Field = { k: 'bool' };
const en = (...values: readonly string[]): Field => ({ k: 'enum', values });
const str: Field = { k: 'str' };
const id: Field = { k: 'id' };
const coord = num(-MAX_COORD_M, MAX_COORD_M);
const strs: Field = { k: 'strs', max: 16, len: 40 };
const evidenceIds: Field = { k: 'strs', max: MAX_EVIDENCE, len: 40 };

// Enums mirror the unions in src/mystery/types.ts (NoiseSource, Stance, RoomId, HydeMode, hyde_mode reason). Exported so
// supabase/tests/unit/mystery-overhaul.test.ts can compare them with the synced types.ts and catch drift before a live
// run is rejected (e.g. the sim's 'gave_up' reason was missing here until 2026-10-23).
export const NOISE_SOURCES = ['footstep', 'egg_drop', 'ability', 'interact', 'impact', 'decoy', 'hazard'] as const;
export const STANCES = ['idle', 'walk', 'crouch', 'sprint'] as const;
export const ROOMS = ['pier', 'path', 'research_room', 'crypt', 'egg_chamber', 'shortcut', 'courtyard', 'tower'] as const;
export const HYDE_MODES = ['PATROL', 'INVESTIGATE_SOUND', 'SEARCH', 'CHASE', 'COOLDOWN'] as const;
export const HYDE_REASONS = [
  'heard_noise', 'saw_player', 'lost_sight', 'search_timeout', 'cooldown_done', 'reached_target', 'stunned', 'lured',
  'grabbed', 'gave_up',
] as const;
// Joseph Crackstone (types.ts CrackstoneMode / CrackstoneModeReason / CrackstoneDetectVia and the inline phase unions of
// crackstone_scan / curse). Drift-checked against the synced types.ts by mystery-overhaul.test.ts.
export const CRACKSTONE_MODES = ['PATROL', 'INVESTIGATE', 'CHASE', 'ATTACK', 'SEARCH', 'RETURN'] as const;
export const CRACKSTONE_REASONS = [
  'saw_player', 'sensed_player', 'scan_hit', 'lost_sight', 'leash', 'reached_target', 'gave_up', 'search_timeout',
  'returned', 'curse_cast', 'curse_done', 'curse_missed', 'stunned', 'lured', 'deferred',
] as const;
export const CRACKSTONE_VIA = ['sight', 'proximity', 'scan'] as const;
export const CRACKSTONE_SCAN_PHASES = ['warning', 'pulse'] as const;
export const CURSE_PHASES = ['cast', 'hit', 'miss'] as const;
const VERDICTS: readonly Verdict[] = ['case_solved', 'egg_secured_mystery_unsolved', 'not_accused'];

/**
 * Payload schema per type, mirroring the GameEvent union in src/mystery/types.ts. Rule types are strict (exact keys);
 * the rest validate every declared key (required, typed, bounded) and tolerate up to MAX_EXTRA_KEYS extra short
 * primitive keys, so a cosmetic sim addition cannot turn a whole live run "unverified" (a rejected batch stops the
 * upload). The overhaul telemetry types follow the same policy; their ids must match SAFE_ID_RE.
 */
const SCHEMAS: Record<MysteryEventType, { fields: Record<string, Field>; strict: boolean }> = {
  noise: { fields: { source: en(...NOISE_SOURCES), x: num(), z: num(), loudness: num(0, 10), radiusM: num(0, 1000) }, strict: false },
  stance: { fields: { stance: en(...STANCES) }, strict: false },
  room_enter: { fields: { roomId: en(...ROOMS) }, strict: false },
  hyde_mode: { fields: { from: en(...HYDE_MODES), to: en(...HYDE_MODES), reason: en(...HYDE_REASONS) }, strict: false },
  hyde_heard: { fields: { source: en(...NOISE_SOURCES), loudness: num(0, 10), distanceM: num(0, 1000), occluded: bool }, strict: false },
  hyde_sighted: { fields: { distanceM: num(0, 1000) }, strict: false },
  hyde_lost: { fields: {}, strict: false },
  catch: { fields: { catchNumber: int(1, 2), hpLost: num(0, 1000), eggSecurityLost: num(0, 100), blocked: bool }, strict: true },
  clue_search_start: { fields: { clueId: str }, strict: false },
  clue_found: { fields: { clueId: str, cluesFound: int(1, 3) }, strict: true },
  egg_pickup: { fields: {}, strict: true },
  egg_drop: { fields: { reason: en('manual', 'impact', 'grab'), security: num(0, 100) }, strict: true },
  egg_damage: { fields: { amount: num(0, 100), cause: en('grab', 'impact', 'drop'), security: num(0, 100) }, strict: true },
  egg_delivered: { fields: { tier: en('common', 'rare', 'legendary'), points: int(1, 6), security: num(0, 100) }, strict: true },
  ability_used: { fields: { key: en('F', 'Q'), abilityId: str, kinds: strs, success: bool, detail: str }, strict: false },
  ability_denied: { fields: { key: en('F', 'Q'), reason: en('cooldown', 'no_target') }, strict: false },
  hint_requested: { fields: {}, strict: false },
  // ---- overhaul telemetry (not rule events)
  hyde_emerged: { fields: { spawnId: id, x: coord, z: coord }, strict: false },
  site_checked: { fields: { site: en('clue', 'egg'), siteId: id, found: bool }, strict: false },
  trace_found: { fields: { sourceId: id, siteId: id }, strict: false },
  examined: { fields: { examineId: id }, strict: false },
  passage_opened: { fields: { passageId: id }, strict: false },
  hazard_triggered: { fields: { hazardId: id }, strict: false },
  // ---- Joseph Crackstone: telemetry (lenient like the Hyde telemetry) + the curse RULE event (strict)
  crackstone_mode: {
    fields: { from: en(...CRACKSTONE_MODES), to: en(...CRACKSTONE_MODES), reason: en(...CRACKSTONE_REASONS) }, strict: false,
  },
  crackstone_sighted: { fields: { via: en(...CRACKSTONE_VIA), distanceM: num(0, MAX_DISTANCE_M) }, strict: false },
  crackstone_lost: { fields: {}, strict: false },
  crackstone_scan: {
    fields: { phase: en(...CRACKSTONE_SCAN_PHASES), radiusM: num(0, MAX_SCAN_RADIUS_M), hit: bool }, strict: false,
  },
  curse: { fields: { phase: en(...CURSE_PHASES), hpLost: num(0, MAX_CURSE_HP), blocked: bool }, strict: true },
  accusation: {
    fields: { suspectId: { k: 'nstr' }, correct: bool, cluesFound: int(0, 3), evidence: evidenceIds, deductionCorrect: bool },
    strict: true,
  },
  finish: { fields: { verdict: en(...VERDICTS), score: num(-1e6, 1e6) }, strict: true },
  dnf: { fields: { reason: en('second_catch', 'hp_depleted') }, strict: true },
};

/** Declared payload keys of a type (drift tests compare them with the GameEvent union of the synced types.ts). */
export function eventFieldNames(type: MysteryEventType): string[] {
  return Object.keys(SCHEMAS[type].fields);
}

/** True when a type accepts exactly its declared keys (rule events); telemetry tolerates a few extra primitives. */
export function isStrictEvent(type: MysteryEventType): boolean {
  return SCHEMAS[type].strict;
}

const MAX_EXTRA_KEYS = 6;

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function checkField(seq: number, name: string, f: Field, v: unknown): void {
  const bad = (what: string) => reject(seq, 'payload', `event ${seq}: "${name}" ${what}`);
  switch (f.k) {
    case 'num':
      if (typeof v !== 'number' || !Number.isFinite(v)) bad('must be a finite number');
      if ((v as number) < f.min || (v as number) > f.max) bad(`must be between ${f.min} and ${f.max}`);
      return;
    case 'int':
      if (typeof v !== 'number' || !Number.isInteger(v)) bad('must be an integer');
      if ((v as number) < f.min || (v as number) > f.max) bad(`must be between ${f.min} and ${f.max}`);
      return;
    case 'bool':
      if (typeof v !== 'boolean') bad('must be a boolean');
      return;
    case 'enum':
      if (typeof v !== 'string' || !f.values.includes(v)) bad('has an unknown value');
      return;
    case 'str':
      if (typeof v !== 'string' || v.length > MAX_STRING) bad(`must be a string of at most ${MAX_STRING} characters`);
      return;
    case 'id':
      if (typeof v !== 'string' || !SAFE_ID_RE.test(v)) bad('must be a snake_case id of at most 40 characters');
      return;
    case 'nstr':
      if (v !== null && (typeof v !== 'string' || v.length > MAX_STRING)) bad('must be a short string or null');
      return;
    case 'strs':
      if (!Array.isArray(v) || v.length > f.max || v.some((s) => typeof s !== 'string' || s.length > f.len)) {
        bad(`must be a list of at most ${f.max} strings of at most ${f.len} characters`);
      }
      return;
  }
}

/** Structural parse of ONE StampedEvent (`{ type, t, seq, ...payload }`). */
export function parseEvent(raw: unknown, index: number): ParsedEvent {
  if (!isPlainObject(raw)) reject(null, 'shape', `events[${index}] must be an object`);
  const { type, t, seq, ...payload } = raw;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0 || seq > MAX_SEQ) {
    reject(null, 'seq', `events[${index}].seq must be an integer between 0 and ${MAX_SEQ}`);
  }
  if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > MAX_T) {
    reject(seq, 't', `event ${seq}: t must be a number of active seconds between 0 and ${MAX_T}`);
  }
  if (typeof type !== 'string' || !(MYSTERY_EVENT_TYPES as readonly string[]).includes(type)) {
    reject(seq, 'type', `event ${seq}: unknown event type`);
  }
  const schema = SCHEMAS[type as MysteryEventType];
  for (const [name, f] of Object.entries(schema.fields)) checkField(seq, name, f, payload[name]);
  const extra = Object.keys(payload).filter((k) => !(k in schema.fields));
  if (schema.strict && extra.length > 0) reject(seq, 'payload', `event ${seq}: unexpected field "${extra[0].slice(0, 40)}"`);
  if (extra.length > MAX_EXTRA_KEYS) reject(seq, 'payload', `event ${seq}: too many fields`);
  for (const k of extra) {
    const v = payload[k];
    const ok = v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))
      || (typeof v === 'string' && v.length <= MAX_STRING);
    if (!ok || k.length > 40) reject(seq, 'payload', `event ${seq}: field "${k.slice(0, 40)}" must be a short primitive`);
  }
  return { seq, t, type: type as MysteryEventType, payload };
}

/** Parses a batch: 1..MAX_BATCH_EVENTS events, strictly increasing seq, non-decreasing t. */
export function parseEventBatch(raw: unknown, allowEmpty: boolean): ParsedEvent[] {
  if (!Array.isArray(raw)) throw new HttpError('INVALID_INPUT', 'events must be an array', { field: 'events' });
  if (raw.length > MAX_BATCH_EVENTS) {
    throw new HttpError('INVALID_INPUT', `send at most ${MAX_BATCH_EVENTS} events per batch`, { field: 'events' });
  }
  if (raw.length === 0 && !allowEmpty) throw new HttpError('INVALID_INPUT', 'events must not be empty', { field: 'events' });
  const out = raw.map((e, i) => parseEvent(e, i));
  for (let i = 1; i < out.length; i++) {
    if (out[i].seq <= out[i - 1].seq) reject(out[i].seq, 'order', `event ${out[i].seq}: seq must increase within a batch`);
    if (out[i].t < out[i - 1].t) reject(out[i].seq, 'order', `event ${out[i].seq}: t must not go backwards`);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------- rules
/**
 * Applies one event to `p` (mutates and returns it). Throws EVENT_REJECTED on any order/rule violation.
 * `p.lastSeq/lastT` advance for every event, so the same reducer can replay a subset (rule events only).
 */
export function applyEvent(p: MysteryProgress, e: ParsedEvent, ctx: RulesContext): MysteryProgress {
  const { seq, t, payload } = e;
  if (seq <= p.lastSeq) reject(seq, 'order', `event ${seq}: seq must be greater than ${p.lastSeq}`);
  if (t < p.lastT) reject(seq, 'order', `event ${seq}: t went backwards (${t} < ${p.lastT})`);
  if (p.terminal) reject(seq, 'after_terminal', `event ${seq}: the run already ended (${p.terminal.type})`);
  const afterDeposit = p.delivered !== null;

  switch (e.type) {
    case 'clue_found': {
      const clueId = payload.clueId as ClueId;
      if (!ctx.clueIds.includes(clueId)) reject(seq, 'clue_unknown', `event ${seq}: unknown clue id`);
      if (p.cluesFound.includes(clueId)) reject(seq, 'clue_duplicate', `event ${seq}: clue "${clueId}" was already found`);
      if (afterDeposit) reject(seq, 'clue_after_deposit', `event ${seq}: clues cannot be found after the egg deposit`);
      if (payload.cluesFound !== p.cluesFound.length + 1) {
        reject(seq, 'clue_count', `event ${seq}: cluesFound must be ${p.cluesFound.length + 1}`);
      }
      p.cluesFound.push(clueId);
      break;
    }
    case 'clue_search_start':
      if (!ctx.clueIds.includes(payload.clueId as ClueId)) reject(seq, 'clue_unknown', `event ${seq}: unknown clue id`);
      break;
    case 'egg_pickup':
      if (p.egg !== 'resting' && p.egg !== 'dropped') reject(seq, 'egg_order', `event ${seq}: egg_pickup while the egg is ${p.egg}`);
      p.egg = 'carried';
      p.pickups++;
      break;
    case 'egg_drop':
      if (p.egg !== 'carried') reject(seq, 'egg_order', `event ${seq}: egg_drop while the egg is ${p.egg}`);
      p.egg = 'dropped';
      p.eggSecurity = payload.security as number;
      break;
    case 'egg_damage':
      if (p.pickups === 0 || afterDeposit) reject(seq, 'egg_order', `event ${seq}: egg_damage before pickup or after the deposit`);
      p.eggSecurity = payload.security as number;
      break;
    case 'egg_delivered': {
      if (p.egg !== 'carried') reject(seq, 'egg_order', `event ${seq}: egg_delivered requires egg_pickup first (egg is ${p.egg})`);
      const tier = payload.tier as LiveEggTier;
      if (ctx.expectedTier !== null && tier !== ctx.expectedTier) {
        reject(seq, 'egg_tier', `event ${seq}: egg tier does not match this session's seed`);
      }
      if (payload.points !== ctx.eggPoints[tier]) reject(seq, 'egg_points', `event ${seq}: points do not match the ${tier} tier`);
      p.egg = 'delivered';
      p.eggSecurity = payload.security as number;
      p.delivered = { seq, t, tier, points: payload.points as number, security: payload.security as number };
      break;
    }
    case 'accusation': {
      if (!afterDeposit) reject(seq, 'accusation_order', `event ${seq}: accusation only after egg_delivered`);
      if (p.accusation) reject(seq, 'accusation_duplicate', `event ${seq}: only one accusation per run`);
      const suspectId = payload.suspectId as SuspectId | null;
      if (suspectId !== null && !ctx.suspectIds.includes(suspectId)) reject(seq, 'suspect_unknown', `event ${seq}: unknown suspect id`);
      // (evidence cited with a null suspect is ignored by finalize, never an error: the run stays verifiable)
      p.accusation = {
        seq, t, suspectId, evidence: [...(payload.evidence as string[])], claimedCorrect: payload.correct as boolean,
        claimedClues: payload.cluesFound as number, claimedDeduction: payload.deductionCorrect as boolean,
      };
      break;
    }
    case 'catch': {
      if (afterDeposit) reject(seq, 'catch_after_deposit', `event ${seq}: no catches after the deposit`);
      if (payload.catchNumber !== p.catches + 1) reject(seq, 'catch_order', `event ${seq}: catchNumber must be ${p.catches + 1}`);
      p.catches++;
      p.hpLost += payload.hpLost as number;
      break;
    }
    case 'curse': {
      // rule R7: a landed curse costs HP (never a catch, never the egg); cast / miss cost nothing
      const hpLost = payload.hpLost as number;
      if (payload.phase !== 'hit') {
        if (hpLost !== 0) reject(seq, 'curse_hp', `event ${seq}: a curse ${String(payload.phase)} costs no HP (hpLost must be 0)`);
        break;
      }
      if (afterDeposit) reject(seq, 'curse_after_deposit', `event ${seq}: no curse can land after the deposit`);
      if (payload.blocked === true && hpLost !== 0) reject(seq, 'curse_hp', `event ${seq}: a blocked curse costs no HP (hpLost must be 0)`);
      p.curses++;
      p.hpLost += hpLost;
      break;
    }
    case 'finish':
      if (!p.accusation) reject(seq, 'finish_order', `event ${seq}: finish only after the accusation`);
      p.terminal = { type: 'finish', seq, t, claimedVerdict: payload.verdict as Verdict, claimedScore: payload.score as number };
      break;
    case 'dnf': {
      if (afterDeposit) reject(seq, 'dnf_after_deposit', `event ${seq}: dnf after the egg was delivered`);
      const reason = payload.reason as DnfReason;
      if (reason === 'second_catch' && p.catches < 2) reject(seq, 'dnf_reason', `event ${seq}: second_catch DNF before catch #2`);
      if (reason === 'hp_depleted' && typeof ctx.maxHp === 'number' && p.hpLost < ctx.maxHp - HP_EPSILON) {
        reject(seq, 'dnf_reason', `event ${seq}: hp_depleted DNF with only ${p.hpLost} of ${ctx.maxHp} HP lost (catch + curse hits)`);
      }
      p.terminal = { type: 'dnf', seq, t, reason };
      break;
    }
    case 'hyde_sighted':
      p.sightings++;
      break;
    case 'hint_requested':
      p.hints++;
      break;
    default:
      break;
  }
  p.lastSeq = seq;
  p.lastT = t;
  return p;
}

/** Applies a batch to a COPY of `progress`; the input is never mutated. */
export function applyBatch(progress: MysteryProgress, events: readonly ParsedEvent[], ctx: RulesContext): MysteryProgress {
  const p = structuredClone(progress);
  for (const e of events) applyEvent(p, e, ctx);
  return p;
}

/** JSON with object keys sorted recursively (jsonb reorders keys, so plain JSON.stringify is not comparable). */
export function canonicalJson(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonicalJson).join(',')}]`;
  if (x !== null && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(x);
}

/**
 * The rule-relevant fields two progress values must agree on (append-time state stored as jsonb vs finalize replay).
 * hpLost + curses since 20261024000100 (both derive only from rule events: catch + curse).
 */
export function ruleFingerprint(p: MysteryProgress): string {
  return canonicalJson([
    p.cluesFound, p.delivered, p.accusation, p.catches, p.terminal, p.egg, p.eggSecurity, p.sightings, p.hints,
    p.hpLost ?? 0, p.curses ?? 0,
  ]);
}

/** Compact public summary of progress for API responses / station status. */
export function progressSummary(p: MysteryProgress) {
  return {
    cluesFound: [...p.cluesFound],
    egg: p.egg,
    eggSecurity: p.eggSecurity,
    catches: p.catches,
    sightings: p.sightings,
    delivered: p.delivered !== null,
    accused: p.accusation !== null,
    terminal: p.terminal?.type ?? null,
  };
}
export type ProgressSummary = ReturnType<typeof progressSummary>;

// ------------------------------------------------------------------------------------------------- resend / dedupe
/** Exact equality of two stored/sent events (jsonb normalises key order, so compare structurally). */
export function sameEvent(a: ParsedEvent, b: ParsedEvent): boolean {
  return a.seq === b.seq && a.type === b.type && a.t === b.t && jsonEqual(a.payload, b.payload);
}

/**
 * Splits a batch into already-stored duplicates (seq ≤ lastSeq, identical to the stored row → ignored) and fresh
 * events (seq > lastSeq). A seq ≤ lastSeq that is missing or different is a 409 SEQ_CONFLICT: the client must resync
 * via mystery-get-session (session.lastSeq) and resend from lastSeq + 1. Batches are strictly increasing, so the
 * duplicates are always a prefix.
 */
export function splitResend(
  events: readonly ParsedEvent[], lastSeq: number, stored: ReadonlyMap<number, ParsedEvent>,
): { duplicates: number; fresh: ParsedEvent[] } {
  let duplicates = 0;
  const fresh: ParsedEvent[] = [];
  for (const e of events) {
    if (e.seq > lastSeq) {
      fresh.push(e);
      continue;
    }
    const prev = stored.get(e.seq);
    if (!prev || !sameEvent(prev, e)) {
      throw new HttpError('SEQ_CONFLICT', prev
        ? `event ${e.seq} differs from the event already stored with that seq`
        : `event ${e.seq} is older than the last stored event and was never stored (gaps cannot be back-filled)`,
      { seq: e.seq, lastSeq });
    }
    duplicates++;
  }
  return { duplicates, fresh };
}
