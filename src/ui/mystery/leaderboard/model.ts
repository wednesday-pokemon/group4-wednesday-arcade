// Home-page / results / dashboard leaderboard model (docs/final/UX_FINAL.md §5–§6, FINAL_CONTRACT §1 + §10). Pure.
// One entry shape for every source: LOCAL DEMO records of this laptop (raven.mystery.records, recomputed with the shared
// scoreV4 from their RULE events) and the LIVE v4 views (mystery_top5 / mystery_leaderboard_v4 / mystery_defeated_v4 /
// mystery_standings_v4). mystery-v4 ONLY: a record or row that is not provably v4 is dropped — v3.1 scores never mix.
// Order = the SQL views and the shared compareResults: finishers (score desc, active time asc, finalized asc) with SQL
// rank() ties; DNFs never ranked (defeat log, newest first).
import type { SessionRecord } from '../../../mystery/analytics/types.ts';
import { scoreV4 } from '../../../mystery/scoring.ts';
import { CASE_IDS, ENEMY_IDS, type CaseId, type Duo, type EnemyId, type ScoreBreakdown } from '../../../mystery/types.ts';

export const BOARD_RULES_VERSION = 'mystery-v4';
/** Home panel rows / full-board rows (UX_FINAL §5). */
export const HOME_TOP_N = 5;
export const FULL_TOP_N = 20;

export interface BoardEntry {
  id: string;
  nickname: string;
  outcome: 'finished' | 'dnf';
  /** v4 total (finishers); null for a DNF. */
  score: number | null;
  activeTimeS: number;
  caseId: CaseId | null;
  duo: Duo | null;
  hintsUsed: number | null;
  detections: number | null;
  hits: number | null;
  cluesFound: number | null;
  /** DNF only: the monster that ended the run. */
  defeatedBy: EnemyId | null;
  /** ISO time the run ended / was finalized. */
  finalizedAt: string;
  /** Board rank (finishers; SQL rank() semantics); null for DNFs / before ranking. */
  rank: number | null;
}

export type BoardSource = 'live' | 'local';
/** loading = first fetch pending (skeleton) · ready · reconnecting = LIVE lost its connection (last data kept). */
export type BoardStatus = 'loading' | 'ready' | 'reconnecting';

export interface HomeBoardSnapshot {
  source: BoardSource;
  status: BoardStatus;
  /** Ranked v4 finishers, best first (at most FULL_TOP_N kept). */
  top: BoardEntry[];
  /** v4 DNFs, newest first (the defeat log; never ranked). */
  defeats: BoardEntry[];
  updatedAt: number;
}

/** Anything the home panel can subscribe to (local records, or the LIVE Supabase feed adapted by `liveBoardFeed`). */
export interface HomeBoardFeed {
  subscribe(listener: (s: HomeBoardSnapshot) => void): () => void;
}

const isCase = (v: unknown): v is CaseId => typeof v === 'string' && (CASE_IDS as readonly string[]).includes(v);
const isEnemy = (v: unknown): v is EnemyId => typeof v === 'string' && (ENEMY_IDS as readonly string[]).includes(v);
const epoch = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

// ------------------------------------------------------------------------------------------------------- ranking

/** Board order for finishers: score desc, active time asc, finalized asc, id asc (ties broken like the SQL views). */
export function compareFinishers(a: BoardEntry, b: BoardEntry): number {
  return (b.score ?? -Infinity) - (a.score ?? -Infinity)
    || a.activeTimeS - b.activeTimeS
    || epoch(a.finalizedAt) - epoch(b.finalizedAt)
    || a.id.localeCompare(b.id);
}

/** Ranked finishers only (DNFs and score-less rows dropped). Equal (score, time, finalized) share a rank. */
export function rankFinishers(entries: readonly BoardEntry[]): BoardEntry[] {
  const fin = entries.filter((e) => e.outcome === 'finished' && e.score !== null && Number.isFinite(e.score)).sort(compareFinishers);
  let rank = 0;
  return fin.map((e, i) => {
    const prev = fin[i - 1];
    if (!prev || prev.score !== e.score || prev.activeTimeS !== e.activeTimeS || epoch(prev.finalizedAt) !== epoch(e.finalizedAt)) rank = i + 1;
    return { ...e, rank };
  });
}

/** DNFs, newest first (the defeat log). */
export function defeatLog(entries: readonly BoardEntry[]): BoardEntry[] {
  return entries.filter((e) => e.outcome === 'dnf')
    .map((e) => ({ ...e, score: null, rank: null }))
    .sort((a, b) => epoch(b.finalizedAt) - epoch(a.finalizedAt) || a.id.localeCompare(b.id));
}

/** Full standings: every ranked finisher above every DNF (DNFs by survival time desc, like mystery_standings_v4). */
export function standings(entries: readonly BoardEntry[]): BoardEntry[] {
  const dnf = entries.filter((e) => e.outcome === 'dnf').map((e) => ({ ...e, score: null, rank: null }))
    .sort((a, b) => b.activeTimeS - a.activeTimeS || epoch(a.finalizedAt) - epoch(b.finalizedAt) || a.id.localeCompare(b.id));
  return [...rankFinishers(entries), ...dnf];
}

/** A snapshot from entries of one source (ranked + defeat log, trimmed). */
export function boardSnapshot(source: BoardSource, entries: readonly BoardEntry[], status: BoardStatus = 'ready', now = Date.now()): HomeBoardSnapshot {
  return { source, status, top: rankFinishers(entries).slice(0, FULL_TOP_N), defeats: defeatLog(entries).slice(0, FULL_TOP_N), updatedAt: now };
}

/**
 * Where a run would stand on a board: its own rank when present, else 1 + the finishers strictly ahead of it (a DNF or
 * a score-less run → null).
 */
export function rankOf(entries: readonly BoardEntry[], id: string, fallback?: { score: number | null; activeTimeS: number } | null): number | null {
  const ranked = rankFinishers(entries);
  const own = ranked.find((e) => e.id === id);
  if (own) return own.rank;
  if (!fallback || fallback.score === null) return null;
  const me: BoardEntry = {
    id, nickname: '', outcome: 'finished', score: fallback.score, activeTimeS: fallback.activeTimeS, caseId: null, duo: null, hintsUsed: null,
    detections: null, hits: null, cluesFound: null, defeatedBy: null, finalizedAt: new Date(8.64e15).toISOString(), rank: null,
  };
  return 1 + ranked.filter((e) => compareFinishers(e, me) < 0).length;
}

// ------------------------------------------------------------------------------------------------------- local records

/** Case data version introduced with mystery-v4 (Galpin, Slurp, compact maps); every v3.1 case was ≤ 2. */
export const V4_CASE_VERSION = 3;
/** Event types that exist only in mystery-v4 runs (encounter director, Slurp, cabinets, v4 rule events). */
const V4_ONLY_EVENTS = new Set(['enemy_spawned', 'enemy_despawned', 'enemy_detected', 'enemy_hit', 'slurp_mode', 'cabinet']);

type VersionCarrier = { rulesVersion?: unknown };

/**
 * Is this local record a mystery-v4 run? An explicit rulesVersion (record or result) decides; otherwise a v4 score
 * breakdown, a v4 case version (≥ 3), a v4-only event or a levelled Weems hint proves it. Anything else (v3.1, legacy,
 * unknown) → false.
 */
export function isV4Record(rec: SessionRecord): boolean {
  const explicit = (rec as VersionCarrier).rulesVersion ?? (rec.result as VersionCarrier | null | undefined)?.rulesVersion;
  if (explicit !== undefined && explicit !== null) return explicit === BOARD_RULES_VERSION;
  if ((rec.result as { scoreBreakdown?: unknown } | null | undefined)?.scoreBreakdown) return true;
  const caseVersion = rec.caseVersion ?? rec.result?.caseVersion ?? null;
  if (typeof caseVersion === 'number' && caseVersion >= V4_CASE_VERSION) return true;
  return rec.events.some((e) => V4_ONLY_EVENTS.has(e.type) || (e.type === 'hint_requested' && typeof e.level === 'number') || (e.type === 'dnf' && !!e.by));
}

/** RULE-event counts of a record (what the server recomputes). */
export function ruleCounts(rec: SessionRecord): { detections: number; hits: number; hintsUsed: number; delivered: boolean; lastHitBy: EnemyId | null; dnfBy: EnemyId | null } {
  let detections = 0;
  let hits = 0;
  let hintsUsed = 0;
  let delivered = false;
  let lastHitBy: EnemyId | null = null;
  let dnfBy: EnemyId | null = null;
  for (const e of rec.events) {
    if (e.type === 'enemy_detected') detections++;
    else if (e.type === 'enemy_hit') {
      hits++;
      lastHitBy = e.enemy;
    } else if (e.type === 'hint_requested') hintsUsed++;
    else if (e.type === 'egg_delivered') delivered = true;
    else if (e.type === 'dnf' && isEnemy(e.by)) dnfBy = e.by;
  }
  return { detections, hits, hintsUsed, delivered, lastHitBy, dnfBy };
}

/** The local-record shape this module reads (records.ts StoredRecord, structurally). */
export interface LocalStoredRecord { record: SessionRecord; nickname: string; stationId?: string; endedAt: string }

/** A v4 local record as a board entry (null: not v4, not ended, or no result). Score = breakdown total, else scoreV4. */
export function entryFromLocal(s: LocalStoredRecord): BoardEntry | null {
  const rec = s.record;
  const r = rec.result;
  if (!r || (r.outcome !== 'finished' && r.outcome !== 'dnf') || !isV4Record(rec)) return null;
  const c = ruleCounts(rec);
  const extra = r as typeof r & { scoreBreakdown?: ScoreBreakdown | null; defeatedBy?: EnemyId | null; hintsUsed?: number; detections?: number; hits?: number };
  const finished = r.outcome === 'finished';
  const score = finished
    ? extra.scoreBreakdown && Number.isFinite(extra.scoreBreakdown.total)
      ? extra.scoreBreakdown.total
      : scoreV4({
        // a finisher delivered the egg by definition (finish = delivery + the accusation step)
        delivered: true, correct: r.correct === true, cluesFound: r.cluesFound.length,
        detections: c.detections, hintsUsed: c.hintsUsed, hits: c.hits, activeTimeS: r.activeTimeS,
      }).total
    : null;
  return {
    id: rec.sessionId,
    nickname: s.nickname || 'Guest',
    outcome: r.outcome,
    score,
    activeTimeS: r.activeTimeS,
    caseId: isCase(rec.caseId) ? rec.caseId : isCase(r.caseId) ? r.caseId : null,
    duo: rec.duo ?? null,
    hintsUsed: extra.hintsUsed ?? c.hintsUsed,
    detections: extra.detections ?? c.detections,
    hits: extra.hits ?? c.hits,
    cluesFound: r.cluesFound.length,
    defeatedBy: finished ? null : isEnemy(extra.defeatedBy) ? extra.defeatedBy : c.dnfBy ?? c.lastHitBy,
    finalizedAt: s.endedAt,
    rank: null,
  };
}

/** Every v4 entry of this laptop's records (v3.1 / legacy / unfinished records dropped). */
export function localEntries(records: readonly LocalStoredRecord[]): BoardEntry[] {
  return records.map(entryFromLocal).filter((e): e is BoardEntry => e !== null);
}

/** LOCAL DEMO board from this laptop's records. */
export function localBoard(records: readonly LocalStoredRecord[], now = Date.now()): HomeBoardSnapshot {
  return boardSnapshot('local', localEntries(records), 'ready', now);
}

// ------------------------------------------------------------------------------------------------------- LIVE rows

/**
 * A row of the v4 views (mystery_top5 / mystery_leaderboard_v4 / mystery_defeated_v4 / mystery_standings_v4) as an
 * entry. The row MUST say rules_version 'mystery-v4' (null otherwise) — the v3.1 views never reach the board.
 */
export function entryFromRow(raw: unknown, kind: 'finished' | 'dnf' | 'auto' = 'auto'): BoardEntry | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.rules_version !== BOARD_RULES_VERSION) return null;
  const id = typeof r.session_id === 'string' ? r.session_id : null;
  if (!id) return null;
  const outcome = kind !== 'auto' ? kind : r.outcome === 'dnf' ? 'dnf' : r.outcome === 'finished' || num(r.score) !== null ? 'finished' : null;
  if (!outcome) return null;
  const score = outcome === 'finished' ? num(r.score) : null;
  if (outcome === 'finished' && score === null) return null;
  const duo = typeof r.character_id === 'string' && typeof r.pokemon_id === 'string'
    ? ({ characterId: r.character_id, pokemonId: r.pokemon_id } as Duo) : null;
  return {
    id,
    nickname: typeof r.nickname === 'string' && r.nickname ? r.nickname : 'Guest',
    outcome,
    score,
    activeTimeS: num(r.active_time_s) ?? 0,
    caseId: isCase(r.case_id) ? r.case_id : null,
    duo,
    hintsUsed: num(r.hints_used),
    detections: num(r.detections),
    hits: num(r.hits),
    cluesFound: num(r.clue_count),
    defeatedBy: outcome === 'dnf' && isEnemy(r.defeated_by) ? r.defeated_by : null,
    finalizedAt: typeof r.finalized_at === 'string' ? r.finalized_at : '',
    rank: outcome === 'finished' ? num(r.rank) : null,
  };
}

const rows = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Tolerant adapter for whatever the LIVE feed emits (feature-detected; fullstack owns the Supabase side):
 *  (a) a HomeBoardSnapshot already (source 'live', top / defeats entries), or
 *  (b) raw view rows: { top5? | leaderboard? | top? | standings?, defeated? | defeats?, connection?, loaded? }.
 * Unknown shapes → null (the panel keeps its last data).
 */
export function adaptLiveBoard(raw: unknown, now = Date.now()): HomeBoardSnapshot | null {
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const status: BoardStatus = o.status === 'loading' || o.loaded === false ? 'loading'
    : o.status === 'reconnecting' || (typeof o.connection === 'string' && o.connection !== 'connected') ? 'reconnecting' : 'ready';
  if (o.source === 'live' && Array.isArray(o.top)) {
    const top = rows(o.top).filter((e): e is BoardEntry => !!e && typeof e === 'object' && typeof (e as BoardEntry).id === 'string');
    const defeats = rows(o.defeats).filter((e): e is BoardEntry => !!e && typeof e === 'object' && typeof (e as BoardEntry).id === 'string');
    return { source: 'live', status, top: rankFinishers(top).slice(0, FULL_TOP_N), defeats: defeatLog(defeats).slice(0, FULL_TOP_N), updatedAt: num(o.updatedAt) ?? now };
  }
  const finRows = [...rows(o.leaderboard), ...rows(o.top), ...rows(o.top5), ...rows(o.standings)];
  const dnfRows = [...rows(o.defeated), ...rows(o.defeats)];
  if (finRows.length === 0 && dnfRows.length === 0 && !('leaderboard' in o || 'top5' in o || 'top' in o || 'standings' in o || 'defeated' in o)) return null;
  const seen = new Set<string>();
  const entries: BoardEntry[] = [];
  for (const row of finRows) {
    const e = entryFromRow(row, 'auto');
    if (e && !seen.has(e.id)) {
      seen.add(e.id);
      entries.push(e);
    }
  }
  for (const row of dnfRows) {
    const e = entryFromRow(row, 'dnf');
    if (e && !seen.has(e.id)) {
      seen.add(e.id);
      entries.push(e);
    }
  }
  return boardSnapshot('live', entries, status, now);
}

/** The LIVE station's leaderboard feed when the controller exposes one (`live.leaderboard.subscribe`), else null. */
export function liveBoardFeed(live: unknown): HomeBoardFeed | null {
  const lb = (live as { leaderboard?: { subscribe?: unknown } } | null | undefined)?.leaderboard;
  if (!lb || typeof lb.subscribe !== 'function') return null;
  const subscribe = lb.subscribe.bind(lb) as (l: (raw: unknown) => void) => () => void;
  return {
    subscribe(listener) {
      return subscribe((raw) => {
        const snap = adaptLiveBoard(raw);
        if (snap) listener(snap);
      });
    },
  };
}

// ------------------------------------------------------------------------------------------------------- formatting

/** "1,708" (en-US grouping, integers). */
export function fmtPoints(v: number): string {
  return Math.round(v).toLocaleString('en-US');
}

/** m:ss of whole seconds. */
export function fmtClock(s: number): string {
  const v = Math.max(0, Math.floor(s + 1e-9));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}
