// Wire shapes of the live contract (docs/CLIENT_CONTRACT.md) and their mapping to the app's domain types.
// Pure functions only; unit-tested in tests/integration.
import { isCharacterId, isPokemonId, isStationId } from '../../game/index.ts';
import type { LegResolution, ScoreRecord, SessionStatus, SessionView, StationId } from '../../game/index.ts';
import { BackendError, type StationStatus } from '../backend.ts';

export type AbandonedReason = 'player_reset' | 'operator_reset' | 'superseded' | null;

export interface SessionMeta {
  sessionId: string;
  stationId: StationId;
  status: SessionStatus;
  abandonedReason: AbandonedReason;
}

export interface SessionEnvelope {
  view: SessionView;
  meta: SessionMeta;
  resolution?: LegResolution;
  released?: boolean;
}

export interface StationNotice {
  stationId: StationId;
  label: string;
  status: string;
  notice: AbandonedReason;
}

export interface GetSessionResponse {
  view: SessionView | null;
  meta: (SessionMeta & { createdAt?: string; completedAt?: string | null; verifiedAt?: string | null }) | null;
  station: StationNotice;
}

export interface AdminResetResponse {
  stationId: StationId;
  abandonedSessionIds: string[];
  notice: 'operator_reset';
}

/** Row of `public.station_status` (REST select or Realtime payload). */
export interface StationStatusRow {
  station_id: string;
  label?: string | null;
  session_id: string | null;
  nickname: string | null;
  character_id: string | null;
  pokemon_id: string | null;
  status: string;
  phase: string | null;
  leg_index: number | null;
  route?: string | null;
  push_level?: number | null;
  weather?: string | null;
  hp: number | null;
  stamina?: number | null;
  gap_m: number | null;
  catches: number | null;
  banked_eggs: number | null;
  sim_time_cs: number | null;
  final_score?: number | string | null;
  notice: string | null;
  revision: number;
  updated_at: string;
}

/** Row of `verified_leaderboard`, `defeated_log` or a `leaderboard_entries` Realtime payload. */
export interface LeaderboardRow {
  session_id: string;
  nickname: string;
  station_id: string;
  character_id: string;
  pokemon_id: string;
  status?: string; // leaderboard_entries only; views imply it
  final_egg_points?: number | string | null;
  total_simulated_time_cs: number | string;
  final_score?: number | string | null;
  dnf_reason?: string | null;
  dnf_leg?: number | null;
  rules_version: string;
  verified_at: string | null;
  rank?: number;
}

export const STATION_STATUS_COLUMNS =
  'station_id,label,session_id,nickname,character_id,pokemon_id,status,phase,leg_index,route,push_level,weather,hp,stamina,gap_m,catches,banked_eggs,sim_time_cs,final_score,notice,revision,updated_at';
export const LEADERBOARD_COLUMNS =
  'rank,session_id,nickname,station_id,character_id,pokemon_id,final_egg_points,total_simulated_time_cs,final_score,verified_at,rules_version';
export const DEFEATED_COLUMNS =
  'session_id,nickname,station_id,character_id,pokemon_id,dnf_reason,dnf_leg,total_simulated_time_cs,verified_at,rules_version';

function malformed(what: string): BackendError {
  return new BackendError('SERVER', `The race server sent a malformed ${what}.`, true);
}

function isObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

/** `draws` is null while a live session is in progress (T-06b); guarantee the key exists either way. */
export function normalizeResolution(r: LegResolution): LegResolution {
  return { ...r, draws: r.draws ?? null };
}

export function normalizeView(view: SessionView): SessionView {
  return { ...view, state: { ...view.state, legResults: (view.state.legResults ?? []).map(normalizeResolution) } };
}

function parseView(raw: unknown): SessionView {
  if (!isObject(raw) || !isObject(raw.state)) throw malformed('session view');
  const state = raw.state;
  if (typeof state.sessionId !== 'string' || typeof state.revision !== 'number' || !Array.isArray(state.legResults)) {
    throw malformed('session state');
  }
  if (raw.verified !== true) throw malformed('session (not server-verified)');
  return normalizeView(raw as unknown as SessionView);
}

function parseMeta(raw: unknown): SessionMeta {
  if (!isObject(raw) || typeof raw.sessionId !== 'string' || !isStationId(raw.stationId) || typeof raw.status !== 'string') {
    throw malformed('session meta');
  }
  return raw as unknown as SessionMeta;
}

export function parseEnvelope(raw: unknown, requireResolution = false): SessionEnvelope {
  if (!isObject(raw)) throw malformed('response');
  const envelope: SessionEnvelope = { view: parseView(raw.view), meta: parseMeta(raw.meta) };
  if (envelope.meta.sessionId !== envelope.view.state.sessionId) throw malformed('response (session mismatch)');
  if (raw.resolution !== undefined && raw.resolution !== null) {
    if (!isObject(raw.resolution)) throw malformed('leg resolution');
    envelope.resolution = normalizeResolution(raw.resolution as unknown as LegResolution);
  }
  if (requireResolution && !envelope.resolution) throw malformed('leg resolution');
  if (typeof raw.released === 'boolean') envelope.released = raw.released;
  return envelope;
}

export function parseGetSession(raw: unknown): GetSessionResponse {
  if (!isObject(raw) || !isObject(raw.station) || !isStationId(raw.station.stationId)) throw malformed('station state');
  const station = raw.station as unknown as StationNotice;
  if (raw.view === null || raw.view === undefined) return { view: null, meta: null, station };
  const { view, meta } = parseEnvelope({ view: raw.view, meta: raw.meta });
  return { view, meta: { ...(raw.meta as GetSessionResponse['meta']), ...meta }, station };
}

// ------------------------------------------------------------------------------------------------
// Rows -> domain

const STATION_STATES: ReadonlySet<string> = new Set(['idle', 'in_progress', 'completed', 'dnf', 'abandoned']);

function num(x: unknown): number | null {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export function mapStationRow(row: StationStatusRow): StationStatus | null {
  if (!isStationId(row.station_id) || !STATION_STATES.has(row.status)) return null;
  return {
    stationId: row.station_id,
    sessionId: row.session_id ?? null,
    nickname: row.nickname ?? null,
    characterId: isCharacterId(row.character_id) ? row.character_id : null,
    pokemonId: isPokemonId(row.pokemon_id) ? row.pokemon_id : null,
    status: row.status as StationStatus['status'],
    legIndex: num(row.leg_index),
    phase: row.phase ?? null,
    hp: num(row.hp),
    gapM: num(row.gap_m),
    catches: num(row.catches),
    bankedEggs: num(row.banked_eggs),
    simTimeCs: num(row.sim_time_cs),
    revision: num(row.revision) ?? 0,
    updatedAt: row.updated_at,
  };
}

/**
 * Leaderboard / defeated-log row -> ScoreRecord. `status` defaults to the view's implied status.
 * DNF rows score 0 (defeated_log has no score columns). Returns null for rows that fail validation.
 */
export function mapScoreRow(row: LeaderboardRow, impliedStatus: 'completed' | 'dnf'): ScoreRecord | null {
  const status = row.status ?? impliedStatus;
  if (status !== 'completed' && status !== 'dnf') return null;
  if (typeof row.session_id !== 'string' || typeof row.nickname !== 'string' || !isStationId(row.station_id)) return null;
  if (!isCharacterId(row.character_id) || !isPokemonId(row.pokemon_id)) return null;
  const time = num(row.total_simulated_time_cs);
  if (time === null) return null;
  return {
    sessionId: row.session_id,
    nickname: row.nickname,
    stationId: row.station_id,
    characterId: row.character_id,
    pokemonId: row.pokemon_id,
    status,
    finalEggPoints: status === 'dnf' ? 0 : num(row.final_egg_points) ?? 0,
    totalSimulatedTimeCs: time,
    finalScore: status === 'dnf' ? 0 : num(row.final_score) ?? 0,
    completedAt: row.verified_at ?? '',
    verified: true,
    rulesVersion: 'v2.5',
  };
}

// ------------------------------------------------------------------------------------------------
// Ordering of station rows (Realtime may deliver duplicates or out of order)

function epoch(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/**
 * True when `incoming` should replace `current` for the same station. Within one session the server
 * `revision` is authoritative (strictly increasing). Across sessions it is NOT (a new session restarts at
 * revision 0; an idle reset is previous+1), so the server's `updated_at` decides, then revision.
 */
export function isNewerStationRow(incoming: StationStatusRow, current: StationStatusRow | undefined): boolean {
  if (!current) return true;
  if (incoming.session_id && incoming.session_id === current.session_id) {
    if (incoming.revision !== current.revision) return incoming.revision > current.revision;
    return epoch(incoming.updated_at) > epoch(current.updated_at);
  }
  const dt = epoch(incoming.updated_at) - epoch(current.updated_at);
  if (dt !== 0) return dt > 0;
  return incoming.revision > current.revision;
}
