// Strict request-body parsers. Pure module (no Deno APIs); unit-tested under Node/Vitest.
// Rules: body must be a plain JSON object, unknown keys are rejected, every field is type- and range-checked.
// Game-domain guards (ids, nickname sanitizing) come from the shared engine so the server and browser agree.
import {
  isCharacterId, isEggDecision, isPokemonId, isPushLevel, isRouteId, isStationId, sanitizeNickname,
} from './game/index.ts';
import type { CharacterId, EggDecision, PokemonId, PushLevel, RouteId, StationId } from './game/index.ts';
import { HttpError } from './errors.ts';

export const MAX_BODY_BYTES = 4096;
const ACTION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MODEL_VERSION_RE = /^[A-Za-z0-9._-]{1,32}$/;
const MAX_REVISION = 1000;
// Control chars, zero-width/bidi format chars and markup-significant characters (same family as the engine).
const NOTE_STRIP_RE = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤﻿<>&"'`]/g;

type Json = Record<string, unknown>;

function invalid(field: string, message: string): never {
  throw new HttpError('INVALID_INPUT', message, { field });
}

export function asObject(raw: unknown): Json {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpError('INVALID_INPUT', 'Request body must be a JSON object', { field: '(body)' });
  }
  return raw as Json;
}

function onlyKeys(body: Json, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) invalid(key, `Unknown field "${key.slice(0, 40)}"`);
  }
}

export function parseJsonText(text: string): unknown {
  if (text.length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError('MALFORMED_JSON', 'Request body is not valid JSON');
  }
}

export function isActionId(x: unknown): x is string {
  return typeof x === 'string' && ACTION_ID_RE.test(x);
}

export function isUuid(x: unknown): x is string {
  return typeof x === 'string' && UUID_RE.test(x);
}

function actionId(body: Json): string {
  const v = body.actionId;
  if (!isActionId(v)) invalid('actionId', 'actionId must be 8-64 characters of [A-Za-z0-9_-] (use crypto.randomUUID())');
  return v;
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

function expectedRevision(body: Json): number {
  const v = body.expectedRevision;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MAX_REVISION) {
    invalid('expectedRevision', `expectedRevision must be an integer between 0 and ${MAX_REVISION}`);
  }
  return v;
}

// ------------------------------------------------------------------------------------------------
export interface CreateSessionBody {
  nickname: string; // sanitized
  characterId: CharacterId;
  pokemonId: PokemonId;
  actionId: string;
  modelVersion?: string;
}

export function parseCreateSession(raw: unknown): CreateSessionBody {
  const body = asObject(raw);
  onlyKeys(body, ['nickname', 'characterId', 'pokemonId', 'actionId', 'modelVersion']);
  if (typeof body.nickname !== 'string' || body.nickname.length > 64) invalid('nickname', 'nickname must be a string');
  const nick = sanitizeNickname(body.nickname);
  if (!nick.ok) invalid('nickname', nick.message);
  if (!isCharacterId(body.characterId)) invalid('characterId', 'Unknown characterId');
  if (!isPokemonId(body.pokemonId)) invalid('pokemonId', 'Unknown pokemonId');
  const out: CreateSessionBody = {
    nickname: nick.value,
    characterId: body.characterId,
    pokemonId: body.pokemonId,
    actionId: actionId(body),
  };
  if (body.modelVersion !== undefined && body.modelVersion !== null) {
    if (typeof body.modelVersion !== 'string' || !MODEL_VERSION_RE.test(body.modelVersion)) {
      invalid('modelVersion', 'modelVersion must match [A-Za-z0-9._-]{1,32}');
    }
    out.modelVersion = body.modelVersion;
  }
  return out;
}

export interface GetSessionBody {
  sessionId?: string;
}

export function parseGetSession(raw: unknown): GetSessionBody {
  const body = asObject(raw);
  onlyKeys(body, ['sessionId']);
  const id = sessionId(body, false);
  return id === undefined ? {} : { sessionId: id };
}

export interface PrepareLegBody {
  sessionId: string;
  expectedRevision: number;
  route: RouteId;
  pushLevel: PushLevel;
  actionId: string;
}

export function parsePrepareLeg(raw: unknown): PrepareLegBody {
  const body = asObject(raw);
  onlyKeys(body, ['sessionId', 'expectedRevision', 'route', 'pushLevel', 'actionId']);
  if (!isRouteId(body.route)) invalid('route', 'route must be "safe" or "shortcut"');
  if (!isPushLevel(body.pushLevel)) invalid('pushLevel', 'pushLevel must be 1, 2 or 3');
  return {
    sessionId: sessionId(body, true),
    expectedRevision: expectedRevision(body),
    route: body.route,
    pushLevel: body.pushLevel,
    actionId: actionId(body),
  };
}

export interface ResolveLegBody {
  sessionId: string;
  expectedRevision: number;
  eggDecision: EggDecision;
  actionId: string;
}

export function parseResolveLeg(raw: unknown): ResolveLegBody {
  const body = asObject(raw);
  onlyKeys(body, ['sessionId', 'expectedRevision', 'eggDecision', 'actionId']);
  if (!isEggDecision(body.eggDecision)) invalid('eggDecision', 'eggDecision must be "collect" or "skip"');
  return {
    sessionId: sessionId(body, true),
    expectedRevision: expectedRevision(body),
    eggDecision: body.eggDecision,
    actionId: actionId(body),
  };
}

export interface FinishSessionBody {
  sessionId: string;
  actionId: string;
  reason: 'player_reset';
}

export function parseFinishSession(raw: unknown): FinishSessionBody {
  const body = asObject(raw);
  onlyKeys(body, ['sessionId', 'actionId', 'reason']);
  if (body.reason !== 'player_reset') invalid('reason', 'reason must be "player_reset"');
  return { sessionId: sessionId(body, true), actionId: actionId(body), reason: 'player_reset' };
}

export interface AdminResetBody {
  stationId: StationId;
  reason: string; // sanitized free-text operator note (audit)
  actionId: string;
}

export function sanitizeNote(raw: string): string {
  return raw.replace(/\s+/g, ' ').replace(NOTE_STRIP_RE, '').replace(/\s+/g, ' ').trim();
}

export function parseAdminReset(raw: unknown): AdminResetBody {
  const body = asObject(raw);
  onlyKeys(body, ['stationId', 'reason', 'actionId']);
  if (!isStationId(body.stationId)) invalid('stationId', 'stationId must be "station_a" or "station_b"');
  if (typeof body.reason !== 'string' || body.reason.length > 400) invalid('reason', 'reason must be a short string');
  const note = sanitizeNote(body.reason);
  if (note.length < 3 || note.length > 200) invalid('reason', 'reason must be 3-200 characters');
  return { stationId: body.stationId, reason: note, actionId: actionId(body) };
}

// ------------------------------------------------------------------------------------------------
/** Order-insensitive structural JSON equality (jsonb normalizes key order, so receipts must be compared this way). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
  }
  const ak = Object.keys(a as Json).filter((k) => (a as Json)[k] !== undefined);
  const bk = Object.keys(b as Json).filter((k) => (b as Json)[k] !== undefined);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => Object.prototype.hasOwnProperty.call(b, k) && jsonEqual((a as Json)[k], (b as Json)[k]));
}
