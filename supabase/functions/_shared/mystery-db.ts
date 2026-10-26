// mystery-v3.1 + mystery-v4 data access (service role) + client-facing views. Reads are narrow selects; every write is an RPC.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import type { StationId } from './game/index.ts';
import type {
  CaseId, DuoCard, DuoOffer, EnemyId, MysteryRulesVersion, NightshadeId, PokemonId, ScoreBreakdown, SuspectId,
} from './mystery/types.ts';
import { callRpc } from './db.ts';
import { HttpError } from './errors.ts';
import {
  RULE_EVENT_TYPES, progressFromRow, progressSummary, type MysteryEventType, type MysteryProgress, type ParsedEvent,
  type ProgressSummary,
} from './mystery-events.ts';

export type MysteryStatus = 'offered' | 'playing' | 'finished' | 'dnf' | 'abandoned';
export type AbandonReason = 'player_reset' | 'operator_reset' | 'superseded';

export interface MysterySessionRow {
  id: string;
  station_id: StationId;
  rules_version: MysteryRulesVersion;
  seed: string;
  is_test: boolean;
  nickname: string;
  case_id: CaseId;
  case_version: number;
  status: MysteryStatus;
  selected_slot: number | null;
  character_id: NightshadeId | null;
  pokemon_id: PokemonId | null;
  selected_at: string | null;
  last_seq: number;
  last_t: number;
  event_count: number;
  progress: unknown;
  abandoned_reason: AbandonReason | null;
  created_at: string;
  finalized_at: string | null;
}

// One literal (supabase-js parses select strings at the type level).
const SESSION_COLUMNS =
  'id, station_id, rules_version, seed, is_test, nickname, case_id, case_version, status, selected_slot, character_id, pokemon_id, selected_at, last_seq, last_t, event_count, progress, abandoned_reason, created_at, finalized_at';

export interface MysteryResultRow {
  session_id: string;
  station_id: StationId;
  nickname: string;
  character_id: NightshadeId;
  pokemon_id: PokemonId;
  rules_version: MysteryRulesVersion;
  case_id: CaseId;
  case_version: number;
  outcome: 'finished' | 'dnf';
  dnf_reason: 'second_catch' | 'hp_depleted' | null;
  verdict: 'case_solved' | 'egg_secured_mystery_unsolved' | 'not_accused';
  accused: SuspectId | null;
  correct: boolean;
  evidence: string[];
  deduction_correct: boolean;
  clues_found: string[];
  egg_tier: 'common' | 'rare' | 'legendary' | null;
  egg_points: number;
  egg_security: number | string;
  active_time_s: number | string;
  score: number | string | null;
  catches: number;
  sightings: number;
  hints_used: number;
  /** mystery-v4 columns (20261025000100): null on v3.1 rows. */
  detections: number | null;
  hits: number | null;
  defeated_by: EnemyId | null;
  score_breakdown: ScoreBreakdown | null;
  claim_matches: boolean | null;
  is_test: boolean;
  finalized_at: string;
}

function dbFault(context: string, error: { message?: string; code?: string } | null): HttpError {
  console.error(JSON.stringify({ level: 'error', msg: 'db_error', context, code: error?.code, detail: error?.message }));
  return new HttpError('INTERNAL', 'Database request failed');
}

/** A session of ANOTHER station is reported exactly like a missing one (404), so ids cannot be probed. */
export async function loadMysterySession(admin: SupabaseClient, sessionId: string, stationId: StationId | null): Promise<MysterySessionRow> {
  const { data, error } = await admin.from('mystery_sessions').select(SESSION_COLUMNS).eq('id', sessionId).maybeSingle();
  if (error) throw dbFault('loadMysterySession', error);
  if (!data || (stationId !== null && (data as MysterySessionRow).station_id !== stationId)) {
    throw new HttpError('SESSION_NOT_FOUND', 'Session not found for this station');
  }
  return data as MysterySessionRow;
}

export async function loadOpenMysterySession(admin: SupabaseClient, stationId: StationId): Promise<MysterySessionRow | null> {
  const { data, error } = await admin.from('mystery_sessions').select(SESSION_COLUMNS)
    .eq('station_id', stationId).in('status', ['offered', 'playing']).maybeSingle();
  if (error) throw dbFault('loadOpenMysterySession', error);
  return (data as MysterySessionRow | null) ?? null;
}

export async function loadOffer(admin: SupabaseClient, row: MysterySessionRow): Promise<DuoOffer> {
  const { data, error } = await admin.from('mystery_offered_duos').select('slot, card')
    .eq('session_id', row.id).order('slot', { ascending: true });
  if (error) throw dbFault('loadOffer', error);
  const cards = (data ?? []).map((r: { card: DuoCard }) => r.card);
  if (cards.length !== 3) throw new HttpError('INTERNAL', 'Stored offer is incomplete');
  return { seed: row.seed, cards: [cards[0], cards[1], cards[2]] };
}

export async function loadResult(admin: SupabaseClient, sessionId: string): Promise<MysteryResultRow | null> {
  const { data, error } = await admin.from('mystery_results').select('*').eq('session_id', sessionId).maybeSingle();
  if (error) throw dbFault('loadResult', error);
  return (data as MysteryResultRow | null) ?? null;
}

/** The ranked board of a rules version (leaderboards never mix versions). */
export function leaderboardView(rulesVersion: MysteryRulesVersion): 'mystery_leaderboard' | 'mystery_leaderboard_v4' {
  return rulesVersion === 'mystery-v4' ? 'mystery_leaderboard_v4' : 'mystery_leaderboard';
}

export async function loadRank(admin: SupabaseClient, sessionId: string, rulesVersion: MysteryRulesVersion): Promise<number | null> {
  const { data, error } = await admin.from(leaderboardView(rulesVersion)).select('rank').eq('session_id', sessionId).maybeSingle();
  if (error) throw dbFault('loadRank', error);
  return (data as { rank: number } | null)?.rank ?? null;
}

interface EventRow { seq: number; t: number; type: MysteryEventType; payload: Record<string, unknown> }

/** Stored events with the given seqs (duplicate detection on resend). */
export async function loadEventsBySeq(admin: SupabaseClient, sessionId: string, seqs: number[]): Promise<Map<number, ParsedEvent>> {
  const out = new Map<number, ParsedEvent>();
  if (seqs.length === 0) return out;
  const { data, error } = await admin.from('mystery_events').select('seq, t, type, payload')
    .eq('session_id', sessionId).in('seq', seqs);
  if (error) throw dbFault('loadEventsBySeq', error);
  for (const r of (data ?? []) as EventRow[]) out.set(r.seq, { seq: r.seq, t: Number(r.t), type: r.type, payload: r.payload });
  return out;
}

/** Every rule-relevant event of a session in seq order (paged: PostgREST caps responses at max_rows). */
export async function loadRuleEvents(admin: SupabaseClient, sessionId: string): Promise<ParsedEvent[]> {
  const out: ParsedEvent[] = [];
  const page = 500;
  for (let from = 0; ; from += page) {
    const { data, error } = await admin.from('mystery_events').select('seq, t, type, payload')
      .eq('session_id', sessionId).in('type', RULE_EVENT_TYPES as MysteryEventType[])
      .order('seq', { ascending: true }).range(from, from + page - 1);
    if (error) throw dbFault('loadRuleEvents', error);
    const rows = (data ?? []) as EventRow[];
    for (const r of rows) out.push({ seq: r.seq, t: Number(r.t), type: r.type, payload: r.payload });
    if (rows.length < page) return out;
  }
}

// ------------------------------------------------------------------------------------------------- views
/** The station's OWN verified result (service role -> owning station only; includes the accusation). */
export interface MysteryResultView {
  sessionId: string;
  rulesVersion: MysteryRulesVersion;
  caseId: CaseId;
  caseVersion: number;
  outcome: 'finished' | 'dnf';
  dnfReason: MysteryResultRow['dnf_reason'];
  verdict: MysteryResultRow['verdict'];
  accused: MysteryResultRow['accused'];
  correct: boolean;
  evidence: string[];
  deductionCorrect: boolean;
  cluesFound: string[];
  eggTier: MysteryResultRow['egg_tier'];
  eggPoints: number;
  eggSecurity: number;
  activeTimeS: number;
  score: number | null;
  catches: number;
  sightings: number;
  hintsUsed: number;
  /** mystery-v4: server-counted enemy_detected / enemy_hit events (null on v3.1 results). */
  detections: number | null;
  hits: number | null;
  /** DNF only (v4): the monster that ended the run. */
  defeatedBy: EnemyId | null;
  /** mystery-v4 finishers: every score part (null for DNFs and v3.1 results). */
  scoreBreakdown: ScoreBreakdown | null;
  duo: { characterId: NightshadeId; pokemonId: PokemonId };
  nickname: string;
  stationId: StationId;
  isTest: boolean;
  claimMatches: boolean | null;
  verified: true;
  finalizedAt: string;
}

export function resultView(r: MysteryResultRow): MysteryResultView {
  return {
    sessionId: r.session_id,
    rulesVersion: r.rules_version,
    caseId: r.case_id,
    caseVersion: r.case_version,
    outcome: r.outcome,
    dnfReason: r.dnf_reason,
    verdict: r.verdict,
    accused: r.accused,
    correct: r.correct,
    evidence: r.evidence ?? [],
    deductionCorrect: r.deduction_correct === true,
    cluesFound: r.clues_found,
    eggTier: r.egg_tier,
    eggPoints: r.egg_points,
    eggSecurity: Number(r.egg_security),
    activeTimeS: Number(r.active_time_s),
    score: r.score === null ? null : Number(r.score),
    catches: r.catches,
    sightings: r.sightings,
    hintsUsed: r.hints_used,
    detections: r.detections ?? null,
    hits: r.hits ?? null,
    defeatedBy: r.defeated_by ?? null,
    scoreBreakdown: r.score_breakdown ?? null,
    duo: { characterId: r.character_id, pokemonId: r.pokemon_id },
    nickname: r.nickname,
    stationId: r.station_id,
    isTest: r.is_test,
    claimMatches: r.claim_matches,
    verified: true,
    finalizedAt: r.finalized_at,
  };
}

export interface MysterySessionView {
  sessionId: string;
  stationId: StationId;
  rulesVersion: MysteryRulesVersion;
  status: MysteryStatus;
  abandonedReason: AbandonReason | null;
  seed: string;
  nickname: string;
  isTest: boolean;
  /** The case assigned at creation (never changes; the culprit is NOT part of any session response). */
  caseId: CaseId;
  caseVersion: number;
  selected: { characterId: NightshadeId; pokemonId: PokemonId; slot: number } | null;
  lastSeq: number;
  lastT: number;
  eventCount: number;
  progress: ProgressSummary;
  createdAt: string;
  selectedAt: string | null;
  finalizedAt: string | null;
}

/** Response body of mystery-create-session, mystery-get-session and mystery-select-duo. */
export interface MysterySessionEnvelope {
  session: MysterySessionView;
  offer: DuoOffer;
  result: MysteryResultView | null;
}

export function sessionView(row: MysterySessionRow): MysterySessionView {
  const progress: MysteryProgress = progressFromRow(row.progress);
  return {
    sessionId: row.id,
    stationId: row.station_id,
    rulesVersion: row.rules_version,
    status: row.status,
    abandonedReason: row.abandoned_reason,
    seed: row.seed,
    nickname: row.nickname,
    isTest: row.is_test,
    caseId: row.case_id,
    caseVersion: row.case_version,
    selected: row.selected_slot === null || !row.character_id || !row.pokemon_id
      ? null
      : { characterId: row.character_id, pokemonId: row.pokemon_id, slot: row.selected_slot },
    lastSeq: row.last_seq,
    lastT: Number(row.last_t),
    eventCount: row.event_count,
    progress: progressSummary(progress),
    createdAt: row.created_at,
    selectedAt: row.selected_at,
    finalizedAt: row.finalized_at,
  };
}

export async function loadEnvelope(admin: SupabaseClient, row: MysterySessionRow): Promise<MysterySessionEnvelope> {
  const [offer, result] = await Promise.all([
    loadOffer(admin, row),
    row.status === 'finished' || row.status === 'dnf' ? loadResult(admin, row.id) : Promise.resolve(null),
  ]);
  return { session: sessionView(row), offer, result: result ? resultView(result) : null };
}

/**
 * The session's murderer (server only). Idempotent: the first call stores `draw` (a fresh crypto-random suspect), every
 * later call returns the stored one, so a refresh / replay / retry can never reroll it. Never put the result in a
 * response before finalize.
 */
export async function sessionCulprit(admin: SupabaseClient, sessionId: string, draw: SuspectId): Promise<SuspectId> {
  const out = await callRpc(admin, 'mystery_assign_culprit', { p_session_id: sessionId, p_culprit: draw });
  const c = out.culprit;
  if (c !== 'thornhill' && c !== 'galpin' && c !== 'barry') throw new HttpError('INTERNAL', 'Unexpected culprit from the database');
  return c;
}
