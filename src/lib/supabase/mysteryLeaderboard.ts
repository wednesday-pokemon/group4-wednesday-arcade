// Home-page leaderboard feed (FINAL_BRIEF §9, FINAL_CONTRACT §10, UX_FINAL §5) — anon key, mystery-v4 only.
//   REST:      mystery_top5 (best 5 verified v4 finishers, ties share rank) · mystery_leaderboard_v4 (full board, "Top
//              scores") · mystery_defeated_v4 (defeat log, never ranked). Views are not Realtime sources, so:
//   Realtime:  postgres_changes INSERT / DELETE on public.mystery_results → REFETCH mystery_top5 (debounced 300 ms),
//              plus a refetch after every (re)subscribe; REST polling while Realtime is down.
// Rows are strictly parsed (unknown / malformed rows dropped; test runs never reach these views). The LOCAL DEMO
// equivalent is src/mystery/analytics/leaderboard.ts rankLocalRecords() over the localStorage records.
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { isCaseId } from '../../mystery/data/cases.ts';
import { rankEntries, type DefeatEntry, type LeaderboardEntry } from '../../mystery/analytics/leaderboard.ts';
import { ENEMY_IDS, MYSTERY_RULES_VERSION, type EnemyId } from '../../mystery/types.ts';
import type { ConnectionState } from '../backend.ts';
import { breakdownOf, toNum } from './mysteryWire.ts';
import { browserOnline, connectionFrom, openManagedChannel, type ChannelPhase, type ManagedChannel, type OnlineSource, type RealtimeHost } from './realtime.ts';

export type { DefeatEntry, LeaderboardEntry } from '../../mystery/analytics/leaderboard.ts';

export const TOP5_VIEW = 'mystery_top5';
export const LEADERBOARD_V4_VIEW = 'mystery_leaderboard_v4';
export const DEFEATED_V4_VIEW = 'mystery_defeated_v4';
export const TOP5_COLUMNS = 'rank,session_id,nickname,score,character_id,pokemon_id,case_id,active_time_s,finalized_at,rules_version';
export const LEADERBOARD_V4_COLUMNS =
  'rank,case_rank,session_id,nickname,case_id,character_id,pokemon_id,score,active_time_s,hints_used,detections,hits,score_breakdown,finalized_at,rules_version';
export const DEFEATED_V4_COLUMNS =
  'session_id,nickname,case_id,character_id,pokemon_id,dnf_reason,defeated_by,active_time_s,clue_count,hints_used,detections,hits,finalized_at,rules_version';

type Rest = Pick<SupabaseClient, 'from'>;

function str(v: unknown, max = 64): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;
}

function count(v: unknown): number | null {
  const n = toNum(v as number | string | null | undefined);
  return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
}

/** One top-5 / full-board row (strict; null = dropped). Rows of another rules version are dropped too. */
export function parseLeaderboardRow(raw: unknown): LeaderboardEntry | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.rules_version !== undefined && r.rules_version !== MYSTERY_RULES_VERSION) return null;
  const sessionId = str(r.session_id);
  const rank = count(r.rank);
  const score = toNum(r.score as number | string | null | undefined);
  const time = toNum(r.active_time_s as number | string | null | undefined);
  if (!sessionId || rank === null || rank < 1 || score === null || time === null) return null;
  const nickname = typeof r.nickname === 'string' ? r.nickname.slice(0, 40) : '';
  const entry: LeaderboardEntry = {
    rank, sessionId, nickname, score, characterId: str(r.character_id, 40), pokemonId: str(r.pokemon_id, 40),
    caseId: isCaseId(r.case_id) ? r.case_id : null, activeTimeS: time, finalizedAt: typeof r.finalized_at === 'string' ? r.finalized_at : '',
  };
  if ('hints_used' in r) entry.hintsUsed = count(r.hints_used);
  if ('detections' in r) entry.detections = count(r.detections);
  if ('hits' in r) entry.hits = count(r.hits);
  if ('score_breakdown' in r) entry.scoreBreakdown = breakdownOf(r.score_breakdown);
  return entry;
}

export function parseDefeatRow(raw: unknown): DefeatEntry | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.rules_version !== undefined && r.rules_version !== MYSTERY_RULES_VERSION) return null;
  const sessionId = str(r.session_id);
  const time = toNum(r.active_time_s as number | string | null | undefined);
  if (!sessionId || time === null) return null;
  return {
    sessionId, nickname: typeof r.nickname === 'string' ? r.nickname.slice(0, 40) : '', characterId: str(r.character_id, 40), pokemonId: str(r.pokemon_id, 40),
    caseId: isCaseId(r.case_id) ? r.case_id : null,
    defeatedBy: (ENEMY_IDS as readonly unknown[]).includes(r.defeated_by) ? (r.defeated_by as EnemyId) : null,
    activeTimeS: time, clueCount: count(r.clue_count) ?? 0, hintsUsed: count(r.hints_used), detections: count(r.detections), hits: count(r.hits),
    finalizedAt: typeof r.finalized_at === 'string' ? r.finalized_at : '',
  };
}

/** Keeps the view's ranks but re-sorts defensively (REST order is not guaranteed through every proxy). */
function ordered(rows: LeaderboardEntry[]): LeaderboardEntry[] {
  return [...rows].sort((a, b) => a.rank - b.rank || b.score - a.score || a.activeTimeS - b.activeTimeS || a.finalizedAt.localeCompare(b.finalizedAt) || a.sessionId.localeCompare(b.sessionId));
}

/** The home panel's five rows (mystery_top5). */
export async function fetchTop5(rest: Rest): Promise<LeaderboardEntry[]> {
  const { data, error } = await rest.from(TOP5_VIEW).select(TOP5_COLUMNS).order('rank', { ascending: true }).limit(5);
  if (error) throw new Error(error.message);
  return ordered(((data ?? []) as unknown[]).map(parseLeaderboardRow).filter((x): x is LeaderboardEntry => x !== null)).slice(0, 5);
}

/** "View Full Leaderboard" → Top scores (default top 20 of mystery_leaderboard_v4; optional case filter = case_rank). */
export async function fetchFullLeaderboard(rest: Rest, o: { limit?: number; caseId?: string } = {}): Promise<LeaderboardEntry[]> {
  let q = rest.from(LEADERBOARD_V4_VIEW).select(LEADERBOARD_V4_COLUMNS);
  if (o.caseId) q = q.eq('case_id', o.caseId);
  const { data, error } = await q.order('rank', { ascending: true }).limit(o.limit ?? 20);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => (o.caseId ? { ...r, rank: r.case_rank } : r));
  return ordered(rows.map(parseLeaderboardRow).filter((x): x is LeaderboardEntry => x !== null));
}

/** "Defeat log" tab (mystery_defeated_v4, newest first, never ranked). */
export async function fetchDefeatLog(rest: Rest, o: { limit?: number } = {}): Promise<DefeatEntry[]> {
  const { data, error } = await rest.from(DEFEATED_V4_VIEW).select(DEFEATED_V4_COLUMNS).order('finalized_at', { ascending: false }).limit(o.limit ?? 20);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown[]).map(parseDefeatRow).filter((x): x is DefeatEntry => x !== null);
}

export interface Top5Snapshot {
  mode: 'live';
  entries: LeaderboardEntry[];
  connection: ConnectionState;
  /** First REST load done (show skeleton rows before). */
  loaded: boolean;
  error: string | null;
  /** The #1 changed to a different session since the first load (UX "New #1!" chip, 4 s — the panel owns the timer). */
  newTop: string | null;
  /** Session ids that entered the top 5 with the latest refresh (row slide-in + flash). */
  entered: string[];
  updatedAt: number;
  /**
   * Raw v4 view rows (frontend B's adapter maps them; only rules_version 'mystery-v4' rows are kept): mystery_top5, and
   * with `full` also mystery_leaderboard_v4 (top FULL_LIMIT) and mystery_defeated_v4 (newest FULL_LIMIT).
   */
  top5: Record<string, unknown>[];
  leaderboard: Record<string, unknown>[];
  defeated: Record<string, unknown>[];
}

export interface Top5Feed {
  subscribe(listener: (s: Top5Snapshot) => void): () => void;
  refresh(): Promise<void>;
  connection(): ConnectionState;
}

export interface Top5FeedDeps {
  rest: Rest;
  realtime: RealtimeHost;
  online?: OnlineSource;
  pollMs?: number;
  debounceMs?: number;
  now?: () => number;
  retryDelaysMs?: number[];
  /** Also load the full board + defeat log on every refresh (the "View Full Leaderboard" modal). */
  full?: boolean;
}

export const FULL_LIMIT = 20;

const v4Rows = (data: unknown): Record<string, unknown>[] =>
  (Array.isArray(data) ? data : []).filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r)
    && ((r as Record<string, unknown>).rules_version === undefined || (r as Record<string, unknown>).rules_version === MYSTERY_RULES_VERSION));

/** Pure state of the panel (unit-testable): applies a fresh top-5 and derives "entered" / "new #1". */
export class Top5State {
  entries: LeaderboardEntry[] = [];
  loaded = false;
  error: string | null = null;
  newTop: string | null = null;
  entered: string[] = [];

  apply(rows: readonly LeaderboardEntry[]): boolean {
    const next = ordered([...rows]).slice(0, 5);
    const before = new Set(this.entries.map((e) => e.sessionId));
    const same = next.length === this.entries.length && next.every((e, i) => {
      const o = this.entries[i];
      return o && o.sessionId === e.sessionId && o.rank === e.rank && o.score === e.score && o.nickname === e.nickname;
    });
    const prevTop = this.entries[0]?.sessionId ?? null;
    this.entered = this.loaded ? next.filter((e) => !before.has(e.sessionId)).map((e) => e.sessionId) : [];
    const top = next[0]?.sessionId ?? null;
    this.newTop = this.loaded && top !== null && top !== prevTop ? top : null;
    this.entries = next;
    const changed = !same || !this.loaded || this.error !== null;
    this.loaded = true;
    this.error = null;
    return changed;
  }
}

export function createTop5Feed(deps: Top5FeedDeps): Top5Feed {
  const online = deps.online ?? browserOnline;
  const now = deps.now ?? Date.now;
  const state = new Top5State();
  let raw: { top5: Record<string, unknown>[]; leaderboard: Record<string, unknown>[]; defeated: Record<string, unknown>[] } = { top5: [], leaderboard: [], defeated: [] };
  const listeners = new Set<(s: Top5Snapshot) => void>();
  let phase: ChannelPhase | null = null;
  let isOnline = online.isOnline();
  let channel: ManagedChannel | null = null;
  let stopOnline: (() => void) | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let loadSeq = 0;

  const connection = () => connectionFrom(isOnline, phase);
  const snapshot = (): Top5Snapshot => ({
    mode: 'live', entries: state.entries, connection: connection(), loaded: state.loaded, error: state.error, newTop: state.newTop,
    entered: state.entered, updatedAt: now(), top5: raw.top5, leaderboard: raw.leaderboard, defeated: raw.defeated,
  });
  const emit = () => {
    const s = snapshot();
    listeners.forEach((l) => l(s));
  };

  async function load(): Promise<void> {
    const id = ++loadSeq;
    try {
      const [t5, lb, df] = await Promise.all([
        deps.rest.from(TOP5_VIEW).select(TOP5_COLUMNS).order('rank', { ascending: true }).limit(5),
        deps.full ? deps.rest.from(LEADERBOARD_V4_VIEW).select(LEADERBOARD_V4_COLUMNS).order('rank', { ascending: true }).limit(FULL_LIMIT) : Promise.resolve({ data: [], error: null }),
        deps.full ? deps.rest.from(DEFEATED_V4_VIEW).select(DEFEATED_V4_COLUMNS).order('finalized_at', { ascending: false }).limit(FULL_LIMIT) : Promise.resolve({ data: [], error: null }),
      ]);
      const error = t5.error ?? lb.error ?? df.error;
      if (error) throw new Error(error.message);
      if (id !== loadSeq) return;
      raw = { top5: v4Rows(t5.data), leaderboard: v4Rows(lb.data), defeated: v4Rows(df.data) };
      state.apply(raw.top5.map(parseLeaderboardRow).filter((x): x is LeaderboardEntry => x !== null));
      emit();
    } catch (err) {
      if (id !== loadSeq) return;
      state.error = err instanceof Error ? err.message : String(err);
      emit(); // keep the last rows ("Reconnecting…" + last data)
      throw err;
    }
  }
  const safeLoad = () => void load().catch(() => undefined);
  const soon = () => {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      safeLoad();
    }, deps.debounceMs ?? 300);
  };

  function bind(ch: RealtimeChannel): RealtimeChannel {
    // results rows are the Realtime source; a v4 finisher (or a moderation DELETE) may change the top 5 → refetch
    return ch
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mystery_results' }, (p: { new?: Record<string, unknown> }) => {
        const r = p?.new ?? {};
        if (r.is_test === true || (r.rules_version !== undefined && r.rules_version !== MYSTERY_RULES_VERSION) || (r.outcome !== undefined && r.outcome !== 'finished')) return;
        soon();
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'mystery_results' }, () => soon());
  }

  function start(): void {
    channel = openManagedChannel(deps.realtime, {
      topic: 'mystery-top5', bind, onPhase: (p) => {
        phase = p;
        emit();
      }, onSubscribed: safeLoad, retryDelaysMs: deps.retryDelaysMs,
    });
    stopOnline = online.subscribe((v) => {
      isOnline = v;
      emit();
      if (v) {
        channel?.kick();
        safeLoad();
      }
    });
    poll = setInterval(() => {
      if (connection() !== 'connected') safeLoad();
    }, deps.pollMs ?? 15_000);
    safeLoad();
  }

  function stop(): void {
    channel?.stop();
    channel = null;
    stopOnline?.();
    stopOnline = null;
    if (poll !== null) clearInterval(poll);
    if (timer !== null) clearTimeout(timer);
    poll = null;
    timer = null;
    phase = null;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) start();
      else listener(snapshot());
      return () => {
        if (!listeners.delete(listener)) return;
        if (listeners.size === 0) stop();
      };
    },
    refresh: load,
    connection,
  };
}

/** LIVE wiring with the shared anon client (dynamic import keeps supabase-js out of the LOCAL DEMO bundle). */
export async function createLiveTop5Feed(): Promise<Top5Feed & { fetchFull: typeof fetchFullLeaderboard; fetchDefeats: typeof fetchDefeatLog; rest: Rest }> {
  const { readLiveConfig, sharedSupabase } = await import('./client.ts');
  const client = sharedSupabase(readLiveConfig(), null);
  const feed = createTop5Feed({ rest: client, realtime: client, full: true });
  return { ...feed, fetchFull: fetchFullLeaderboard, fetchDefeats: fetchDefeatLog, rest: client };
}

/** Re-rank helper for callers that merge rows themselves (e.g. a local optimistic row): SQL rank() semantics. */
export { rankEntries };
