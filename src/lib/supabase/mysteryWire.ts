// Wire shapes of the mystery-v3.1 contract (docs/SUPABASE_SETUP.md §12.3) and pure mappers to the app's domain types.
// No supabase-js import: this module is shared by the station adapter, the dashboard feed and the tests.
import { isStationId } from '../../game/index.ts';
import type { StationId } from '../../game/index.ts';
import { eventFromRow } from '../../mystery/analytics/telemetry.ts';
import type { SessionRecord } from '../../mystery/analytics/types.ts';
import type {
  ClueId, DnfReason, Duo, DuoCard, DuoOffer, EggState, NightshadeId, RunResult, SuspectId, Verdict,
} from '../../mystery/types.ts';
import { NIGHTSHADE_IDS } from '../../mystery/types.ts';
import type { PokemonId } from '../../game/types.ts';
import { BackendError } from '../backend.ts';

export type MysteryStatus = 'offered' | 'playing' | 'finished' | 'dnf' | 'abandoned';
export type MysteryAbandonReason = 'player_reset' | 'operator_reset' | 'superseded';
export type LiveEggTier = 'common' | 'rare' | 'legendary';

export interface MysteryProgressSummary {
  cluesFound: string[];
  egg: EggState;
  eggSecurity: number;
  catches: number;
  sightings: number;
  delivered: boolean;
  accused: boolean;
  terminal: 'finish' | 'dnf' | null;
}

export interface MysterySessionView {
  sessionId: string;
  stationId: StationId;
  rulesVersion: 'mystery-v3.1';
  status: MysteryStatus;
  abandonedReason: MysteryAbandonReason | null;
  seed: string;
  nickname: string;
  isTest: boolean;
  selected: { characterId: NightshadeId; pokemonId: PokemonId; slot: number } | null;
  lastSeq: number;
  lastT: number;
  eventCount: number;
  progress: MysteryProgressSummary;
  createdAt: string;
  selectedAt: string | null;
  finalizedAt: string | null;
}

/** Server-recomputed, immutable result (mystery_results row as returned by the functions). */
export interface MysteryResultView {
  sessionId: string;
  rulesVersion: 'mystery-v3.1';
  outcome: 'finished' | 'dnf';
  dnfReason: DnfReason | null;
  verdict: Verdict;
  accused: SuspectId | null;
  correct: boolean;
  cluesFound: string[];
  eggTier: LiveEggTier | null;
  eggPoints: number;
  eggSecurity: number;
  activeTimeS: number;
  score: number | null;
  catches: number;
  sightings: number;
  hintsUsed: number;
  duo: Duo;
  nickname: string;
  stationId: StationId;
  isTest: boolean;
  claimMatches: boolean | null;
  verified: true;
  finalizedAt: string;
}

export interface MysterySessionEnvelope {
  session: MysterySessionView;
  offer: DuoOffer;
  result: MysteryResultView | null;
}

export interface MysteryAppendAck {
  sessionId: string;
  accepted: number;
  duplicates: number;
  lastSeq: number;
  lastT: number;
  eventCount: number;
  terminal: 'finish' | 'dnf' | null;
  progress: MysteryProgressSummary;
  forecastsInserted: number;
  recommendationsUpserted: number;
}

export interface MysteryFinalizeResponse {
  sessionId: string;
  result: MysteryResultView;
  /** Rank on the verified board (null for DNF / test runs). */
  rank: number | null;
}

export interface MysteryAdminResetResponse {
  stationId: StationId;
  scope: 'all' | 'legacy' | 'mystery';
  abandonedSessionIds: string[];
  abandonedMysterySessionIds: string[];
  notice: 'operator_reset';
}

// ------------------------------------------------------------------------------------------------- parsing
const STATUSES: readonly MysteryStatus[] = ['offered', 'playing', 'finished', 'dnf', 'abandoned'];

function bad(what: string): never {
  throw new BackendError('SERVER', `The case server sent an unexpected answer (${what}).`, true);
}

function obj(x: unknown, what: string): Record<string, unknown> {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) bad(what);
  return x as Record<string, unknown>;
}

function str(x: unknown, what: string): string {
  if (typeof x !== 'string') bad(what);
  return x;
}

function num(x: unknown, what: string): number {
  const n = typeof x === 'string' ? Number(x) : x;
  if (typeof n !== 'number' || !Number.isFinite(n)) bad(what);
  return n;
}

function isNightshade(x: unknown): x is NightshadeId {
  return typeof x === 'string' && (NIGHTSHADE_IDS as readonly string[]).includes(x);
}

function parseCard(raw: unknown, i: number): DuoCard {
  const c = obj(raw, `offer.cards[${i}]`);
  if (!isNightshade(c.characterId) || typeof c.pokemonId !== 'string') bad(`offer.cards[${i}] ids`);
  if (typeof c.duoName !== 'string' || !c.stats || typeof c.stats !== 'object') bad(`offer.cards[${i}] fields`);
  return c as unknown as DuoCard;
}

export function parseOffer(raw: unknown, seed: string): DuoOffer {
  const o = obj(raw, 'offer');
  if (o.seed !== seed) bad('offer.seed');
  if (!Array.isArray(o.cards) || o.cards.length !== 3) bad('offer.cards');
  const cards = o.cards.map(parseCard);
  return { seed, cards: [cards[0]!, cards[1]!, cards[2]!] };
}

export function parseResult(raw: unknown): MysteryResultView {
  const r = obj(raw, 'result');
  const outcome = r.outcome;
  if (outcome !== 'finished' && outcome !== 'dnf') bad('result.outcome');
  const duo = obj(r.duo, 'result.duo');
  if (!isNightshade(duo.characterId) || typeof duo.pokemonId !== 'string') bad('result.duo');
  if (!isStationId(r.stationId)) bad('result.stationId');
  return {
    sessionId: str(r.sessionId, 'result.sessionId'),
    rulesVersion: 'mystery-v3.1',
    outcome,
    dnfReason: (r.dnfReason ?? null) as DnfReason | null,
    verdict: str(r.verdict, 'result.verdict') as Verdict,
    accused: (r.accused ?? null) as SuspectId | null,
    correct: r.correct === true,
    cluesFound: Array.isArray(r.cluesFound) ? r.cluesFound.filter((c): c is string => typeof c === 'string') : [],
    eggTier: (r.eggTier ?? null) as LiveEggTier | null,
    eggPoints: num(r.eggPoints, 'result.eggPoints'),
    eggSecurity: num(r.eggSecurity, 'result.eggSecurity'),
    activeTimeS: num(r.activeTimeS, 'result.activeTimeS'),
    score: r.score === null || r.score === undefined ? null : num(r.score, 'result.score'),
    catches: num(r.catches, 'result.catches'),
    sightings: Number(r.sightings ?? 0),
    hintsUsed: Number(r.hintsUsed ?? 0),
    duo: { characterId: duo.characterId, pokemonId: duo.pokemonId as PokemonId },
    nickname: typeof r.nickname === 'string' ? r.nickname : '',
    stationId: r.stationId,
    isTest: r.isTest === true,
    claimMatches: typeof r.claimMatches === 'boolean' ? r.claimMatches : null,
    verified: true,
    finalizedAt: typeof r.finalizedAt === 'string' ? r.finalizedAt : '',
  };
}

export function parseSessionView(raw: unknown): MysterySessionView {
  const s = obj(raw, 'session');
  if (!isStationId(s.stationId)) bad('session.stationId');
  if (!STATUSES.includes(s.status as MysteryStatus)) bad('session.status');
  const seed = str(s.seed, 'session.seed');
  let selected: MysterySessionView['selected'] = null;
  if (s.selected !== null && s.selected !== undefined) {
    const sel = obj(s.selected, 'session.selected');
    if (!isNightshade(sel.characterId) || typeof sel.pokemonId !== 'string') bad('session.selected');
    selected = { characterId: sel.characterId, pokemonId: sel.pokemonId as PokemonId, slot: Number(sel.slot ?? 0) };
  }
  const p = obj(s.progress ?? {}, 'session.progress');
  return {
    sessionId: str(s.sessionId, 'session.sessionId'),
    stationId: s.stationId,
    rulesVersion: 'mystery-v3.1',
    status: s.status as MysteryStatus,
    abandonedReason: (s.abandonedReason ?? null) as MysteryAbandonReason | null,
    seed,
    nickname: typeof s.nickname === 'string' ? s.nickname : '',
    isTest: s.isTest === true,
    selected,
    lastSeq: num(s.lastSeq ?? -1, 'session.lastSeq'),
    lastT: num(s.lastT ?? 0, 'session.lastT'),
    eventCount: num(s.eventCount ?? 0, 'session.eventCount'),
    progress: {
      cluesFound: Array.isArray(p.cluesFound) ? p.cluesFound.filter((c): c is string => typeof c === 'string') : [],
      egg: (p.egg ?? 'resting') as EggState,
      eggSecurity: Number(p.eggSecurity ?? 100),
      catches: Number(p.catches ?? 0),
      sightings: Number(p.sightings ?? 0),
      delivered: p.delivered === true,
      accused: p.accused === true,
      terminal: p.terminal === 'finish' || p.terminal === 'dnf' ? p.terminal : null,
    },
    createdAt: typeof s.createdAt === 'string' ? s.createdAt : '',
    selectedAt: typeof s.selectedAt === 'string' ? s.selectedAt : null,
    finalizedAt: typeof s.finalizedAt === 'string' ? s.finalizedAt : null,
  };
}

/** Envelope of create / get / select. `null` = get-session found nothing open. */
export function parseEnvelope(raw: unknown): MysterySessionEnvelope | null {
  const e = obj(raw, 'envelope');
  if (e.session === null) return null;
  const session = parseSessionView(e.session);
  return {
    session,
    offer: parseOffer(e.offer, session.seed),
    result: e.result === null || e.result === undefined ? null : parseResult(e.result),
  };
}

export function parseAppendAck(raw: unknown): MysteryAppendAck {
  const a = obj(raw, 'append');
  const p = obj(a.progress ?? {}, 'append.progress');
  return {
    sessionId: str(a.sessionId, 'append.sessionId'),
    accepted: num(a.accepted ?? 0, 'append.accepted'),
    duplicates: num(a.duplicates ?? 0, 'append.duplicates'),
    lastSeq: num(a.lastSeq, 'append.lastSeq'),
    lastT: num(a.lastT ?? 0, 'append.lastT'),
    eventCount: num(a.eventCount ?? 0, 'append.eventCount'),
    terminal: a.terminal === 'finish' || a.terminal === 'dnf' ? a.terminal : null,
    progress: p as unknown as MysteryProgressSummary,
    forecastsInserted: Number(a.forecastsInserted ?? 0),
    recommendationsUpserted: Number(a.recommendationsUpserted ?? 0),
  };
}

export function parseFinalize(raw: unknown): MysteryFinalizeResponse {
  const f = obj(raw, 'finalize');
  const rank = f.rank === null || f.rank === undefined ? null : num(f.rank, 'finalize.rank');
  return { sessionId: str(f.sessionId, 'finalize.sessionId'), result: parseResult(f.result), rank };
}

/**
 * The verified result as the app's RunResult (what MysteryResults renders). `hp` is not stored server-side (heals are
 * not events), so it comes from the local run; everything else is the server's recomputation.
 */
export function serverRunResult(server: MysteryResultView, local: RunResult | null): RunResult {
  return {
    rulesVersion: 'mystery-v3.1',
    outcome: server.outcome,
    dnfReason: server.dnfReason,
    verdict: server.verdict,
    accused: server.accused,
    correct: server.correct,
    cluesFound: server.cluesFound as ClueId[],
    eggTier: server.eggTier ?? local?.eggTier ?? 'common',
    eggPoints: server.eggPoints,
    eggSecurity: server.eggSecurity,
    activeTimeS: server.activeTimeS,
    score: server.score,
    catches: server.catches,
    hp: local?.hp ?? 0,
    duo: server.duo,
  };
}

// ------------------------------------------------------------------------------------------------- public rows
/** Row of `public.mystery_station_status` (REST select or Realtime payload). Never carries a seed. */
export interface MysteryStationRow {
  station_id: string;
  label: string | null;
  session_id: string | null;
  nickname: string | null;
  character_id: string | null;
  pokemon_id: string | null;
  status: 'idle' | 'offered' | 'playing' | 'finished' | 'dnf';
  clues_found: number | null;
  catches: number | null;
  sightings: number | null;
  egg_state: string | null;
  active_time_s: number | string | null;
  verdict: string | null;
  score: number | string | null;
  is_test: boolean;
  notice: string | null;
  revision: number;
  updated_at: string;
}

export const MYSTERY_STATION_COLUMNS =
  'station_id,label,session_id,nickname,character_id,pokemon_id,status,clues_found,catches,sightings,egg_state,active_time_s,verdict,score,is_test,notice,revision,updated_at';

/** Row of `public.mystery_standings` (finishers above DNFs; DNF rank null). */
export interface MysteryStandingRow {
  standing_group: 0 | 1;
  rank: number | null;
  session_id: string;
  nickname: string;
  station_id: string;
  character_id: string;
  pokemon_id: string;
  outcome: 'finished' | 'dnf';
  dnf_reason: string | null;
  score: number | string | null;
  active_time_s: number | string;
  verdict: string;
  correct: boolean;
  clue_count: number;
  catches: number;
  finalized_at: string;
}

export const MYSTERY_STANDING_COLUMNS =
  'standing_group,rank,session_id,nickname,station_id,character_id,pokemon_id,outcome,dnf_reason,score,active_time_s,verdict,correct,clue_count,catches,finalized_at';

/** Public columns of `public.mystery_results` the dashboard needs (no client claim). */
export interface MysteryResultRow {
  session_id: string;
  station_id: string;
  nickname: string;
  character_id: string;
  pokemon_id: string;
  outcome: 'finished' | 'dnf';
  dnf_reason: string | null;
  verdict: Verdict;
  correct: boolean;
  clues_found: string[];
  egg_tier: string | null;
  egg_points: number;
  active_time_s: number | string;
  score: number | string | null;
  catches: number;
  sightings: number;
  hints_used: number;
  is_test: boolean;
  finalized_at: string;
}

export const MYSTERY_RESULT_COLUMNS =
  'session_id,station_id,nickname,character_id,pokemon_id,outcome,dnf_reason,verdict,correct,clues_found,egg_tier,egg_points,active_time_s,score,catches,sightings,hints_used,is_test,finalized_at';

export const toNum = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const epoch = (iso: string | null | undefined) => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? t : 0;
};

/** Keeps a station row only when newer (Realtime may deliver duplicates / out of order; REST may be stale). */
export function isNewerMysteryRow(incoming: MysteryStationRow, current: MysteryStationRow | undefined): boolean {
  if (!current) return true;
  if (incoming.revision !== current.revision) return incoming.revision > current.revision;
  return epoch(incoming.updated_at) > epoch(current.updated_at);
}

/**
 * Standings order (same as the SQL view and the shared compareResults): every finisher (score desc, time asc,
 * finalized asc) above every DNF (longest survival first). Finisher ranks use SQL `rank()` semantics.
 */
export function orderStandings(rows: readonly MysteryStandingRow[]): MysteryStandingRow[] {
  const fin = rows.filter((r) => r.outcome === 'finished');
  const dnf = rows.filter((r) => r.outcome === 'dnf');
  fin.sort((a, b) => (toNum(b.score) ?? -Infinity) - (toNum(a.score) ?? -Infinity)
    || (toNum(a.active_time_s) ?? 0) - (toNum(b.active_time_s) ?? 0)
    || epoch(a.finalized_at) - epoch(b.finalized_at) || a.session_id.localeCompare(b.session_id));
  dnf.sort((a, b) => (toNum(b.active_time_s) ?? 0) - (toNum(a.active_time_s) ?? 0)
    || epoch(a.finalized_at) - epoch(b.finalized_at) || a.session_id.localeCompare(b.session_id));
  let rank = 0;
  let prev: MysteryStandingRow | null = null;
  const ranked = fin.map((r, i) => {
    const tie = prev && toNum(prev.score) === toNum(r.score) && toNum(prev.active_time_s) === toNum(r.active_time_s)
      && epoch(prev.finalized_at) === epoch(r.finalized_at);
    if (!tie) rank = i + 1;
    prev = r;
    return { ...r, standing_group: 0 as const, rank };
  });
  return [...ranked, ...dnf.map((r) => ({ ...r, standing_group: 1 as const, rank: null }))];
}

/** A standings row from a results row (Realtime INSERT arrives before the next standings refetch). */
export function standingFromResult(r: MysteryResultRow): MysteryStandingRow {
  return {
    standing_group: r.outcome === 'finished' ? 0 : 1, rank: null, session_id: r.session_id, nickname: r.nickname,
    station_id: r.station_id, character_id: r.character_id, pokemon_id: r.pokemon_id, outcome: r.outcome,
    dnf_reason: r.dnf_reason, score: r.score, active_time_s: r.active_time_s, verdict: r.verdict, correct: r.correct,
    clue_count: r.clues_found?.length ?? 0, catches: r.catches, finalized_at: r.finalized_at,
  };
}

// ------------------------------------------------------------------------------------------------- heartbeat
/**
 * Ephemeral station heartbeat (Realtime broadcast, never stored). Liveness for the dashboard's "Signal lost" plus the
 * volatile numbers the database does not hold (HP, Hyde mode, risk). Broadcast on a public channel is spoofable by
 * anyone with the anon key, so it carries ONLY enums and clamped numbers — names, duos and results on the board always
 * come from server-written rows.
 */
export const HEARTBEAT_TOPIC = 'raven-mystery-live';
export const HEARTBEAT_EVENT = 'status';
export const HEARTBEAT_EVERY_MS = 2000;
export const SIGNAL_LOST_MS = 15_000;

export const HEARTBEAT_PHASES = ['idle', 'name', 'duo', 'tutorial', 'investigating', 'carrying', 'accusing', 'results', 'dnf'] as const;
export type HeartbeatPhase = (typeof HEARTBEAT_PHASES)[number];
const HYDE_MODES = ['PATROL', 'INVESTIGATE_SOUND', 'SEARCH', 'CHASE', 'COOLDOWN'] as const;
const EGG_STATES = ['resting', 'carried', 'dropped', 'delivered'] as const;
const EGG_TIERS = ['common', 'rare', 'legendary'] as const;
const SYNC_STATES = ['idle', 'live', 'offline', 'unverified', 'closed', 'reset'] as const;

export interface MysteryHeartbeat {
  v: 1;
  stationId: StationId;
  phase: HeartbeatPhase;
  clues: number;
  hp: number | null;
  catches: number | null;
  hydeMode: (typeof HYDE_MODES)[number] | null;
  risk: number | null;
  riskSource: 'ml' | 'rule_based' | null;
  eggState: (typeof EGG_STATES)[number] | null;
  eggTier: LiveEggTier | null;
  eggSecurity: number | null;
  activeTimeS: number | null;
  sync: (typeof SYNC_STATES)[number];
}

function oneOf<T extends string>(list: readonly T[], v: unknown): T | null {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null;
}

function clamp(v: unknown, lo: number, hi: number, digits = 1): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(Math.min(hi, Math.max(lo, v)) * f) / f;
}

/** Strict parse of a received heartbeat; anything malformed is dropped (null). */
export function parseHeartbeat(raw: unknown): MysteryHeartbeat | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const h = raw as Record<string, unknown>;
  if (h.v !== 1 || !isStationId(h.stationId)) return null;
  const phase = oneOf(HEARTBEAT_PHASES, h.phase);
  if (!phase) return null;
  return {
    v: 1,
    stationId: h.stationId,
    phase,
    clues: clamp(h.clues, 0, 3, 0) ?? 0,
    hp: clamp(h.hp, 0, 100, 0),
    catches: clamp(h.catches, 0, 2, 0),
    hydeMode: oneOf(HYDE_MODES, h.hydeMode),
    risk: clamp(h.risk, 0, 1, 2),
    riskSource: h.riskSource === 'ml' || h.riskSource === 'rule_based' ? h.riskSource : null,
    eggState: oneOf(EGG_STATES, h.eggState),
    eggTier: oneOf(EGG_TIERS, h.eggTier),
    eggSecurity: clamp(h.eggSecurity, 0, 100, 0),
    activeTimeS: clamp(h.activeTimeS, 0, 14_400, 1),
    sync: oneOf(SYNC_STATES, h.sync) ?? 'idle',
  };
}

// ------------------------------------------------------------------------------------------------- analytics records
export interface EventRow { seq: number; t: number | string; type: string; payload: Record<string, unknown> }

/** Operator-only detail rows of one finalized session (RLS: own station or operator). */
export interface SessionDetail {
  events: EventRow[];
  offered: { character_id: string; pokemon_id: string }[];
  forecasts: { t: number | string; target: string; value: number | string; model_label: string }[];
  recommendations: { action: string; accepted: boolean | null; outcome: string | null }[];
}

/**
 * Rebuilds an analytics SessionRecord from server rows (verified result + operator-visible details). Without the
 * details (anonymous board) the record carries the result only: outcome / verdict / clue / time aggregates still
 * work, event-level panels stay empty and the dashboard says so.
 */
export function recordFromRows(r: MysteryResultRow, detail: SessionDetail | null): SessionRecord {
  const duo: Duo = { characterId: r.character_id as NightshadeId, pokemonId: r.pokemon_id as PokemonId };
  const record: SessionRecord = {
    sessionId: r.session_id,
    duo,
    events: detail
      ? detail.events.map((e) => eventFromRow({ seq: e.seq, t: Number(e.t), type: e.type, payload: e.payload ?? {} })).sort((a, b) => a.seq - b.seq)
      : [],
    result: {
      outcome: r.outcome,
      verdict: r.verdict,
      activeTimeS: toNum(r.active_time_s) ?? 0,
      score: toNum(r.score),
      cluesFound: (r.clues_found ?? []) as ClueId[],
      catches: r.catches,
    },
  };
  if (detail) {
    if (detail.offered.length > 0) {
      record.offered = detail.offered.map((o) => ({ characterId: o.character_id as NightshadeId, pokemonId: o.pokemon_id as PokemonId }));
    }
    record.forecasts = detail.forecasts.map((f) => ({
      t: Number(f.t), target: f.target as 'detection_15s', value: Number(f.value), modelLabel: f.model_label === 'ml' ? 'ml' : 'rule_based',
    }));
    record.recommendations = detail.recommendations.map((x) => ({ action: x.action, accepted: x.accepted, outcome: x.outcome }));
  }
  return record;
}
