// Leaderboard rows for the home-page top-5 panel and the full board (FINAL_BRIEF §9, FINAL_CONTRACT §10, UX_FINAL §5).
// One row shape for both sources:
//   LIVE        src/lib/supabase/mysteryLeaderboard.ts (mystery_top5 / mystery_leaderboard_v4 / mystery_defeated_v4);
//   LOCAL DEMO  rankLocalRecords() below over the localStorage records (src/app/mystery/records.ts StoredRecord).
// Pure and rules-version strict: only `mystery-v4` finishers are ranked; DNFs never outrank (they are not ranked at all —
// they go to the defeat log); legacy / v3.1 records are ignored. Ranks use SQL rank() semantics (ties share a rank).
import { MYSTERY_RULES_VERSION, type CaseId, type EnemyId, type MysteryRulesVersion, type ScoreBreakdown } from '../types.ts';
import type { SessionRecord } from './types.ts';

export interface LeaderboardEntry {
  rank: number;
  sessionId: string;
  nickname: string;
  score: number;
  characterId: string | null;
  pokemonId: string | null;
  caseId: CaseId | null;
  activeTimeS: number;
  finalizedAt: string;
  /** Present on full-board rows (mystery_leaderboard_v4 / local records). */
  hintsUsed?: number | null;
  detections?: number | null;
  hits?: number | null;
  scoreBreakdown?: ScoreBreakdown | null;
}

export interface DefeatEntry {
  sessionId: string;
  nickname: string;
  characterId: string | null;
  pokemonId: string | null;
  caseId: CaseId | null;
  defeatedBy: EnemyId | null;
  activeTimeS: number;
  clueCount: number;
  hintsUsed: number | null;
  detections: number | null;
  hits: number | null;
  finalizedAt: string;
}

/** The fields of a stored local record this module needs (src/app/mystery/records.ts StoredRecord). */
export interface LocalRecordLike {
  record: Pick<SessionRecord, 'sessionId' | 'caseId' | 'duo' | 'result'>;
  nickname: string;
  endedAt: string;
}

/** Board order: score desc, active time asc, finalized asc, session id asc. */
export function compareEntries(a: Pick<LeaderboardEntry, 'score' | 'activeTimeS' | 'finalizedAt' | 'sessionId'>, b: typeof a): number {
  return b.score - a.score || a.activeTimeS - b.activeTimeS || a.finalizedAt.localeCompare(b.finalizedAt) || a.sessionId.localeCompare(b.sessionId);
}

/** Sorts and assigns SQL rank() ranks (equal score + time + finalized time share a rank). */
export function rankEntries<T extends Omit<LeaderboardEntry, 'rank'>>(rows: readonly T[]): (T & { rank: number })[] {
  const sorted = [...rows].sort(compareEntries);
  let rank = 0;
  return sorted.map((r, i) => {
    const prev = sorted[i - 1];
    if (!prev || prev.score !== r.score || prev.activeTimeS !== r.activeTimeS || prev.finalizedAt !== r.finalizedAt) rank = i + 1;
    return { ...r, rank };
  });
}

function versionOf(r: LocalRecordLike): MysteryRulesVersion | null {
  const v = (r.record.result as { rulesVersion?: unknown } | null | undefined)?.rulesVersion;
  return v === 'mystery-v3.1' || v === 'mystery-v4' ? v : null;
}

/**
 * LOCAL DEMO ranking: the verified-style board of this laptop — `mystery-v4` finishers only (score not null), best
 * first, SQL ranks; `limit` rows (default 5 = the home panel). Records without a rules version (older builds) are ignored.
 */
export function rankLocalRecords(records: readonly LocalRecordLike[], o: { limit?: number; rulesVersion?: MysteryRulesVersion; caseId?: CaseId } = {}): LeaderboardEntry[] {
  const version = o.rulesVersion ?? MYSTERY_RULES_VERSION;
  const seen = new Set<string>();
  const rows: Omit<LeaderboardEntry, 'rank'>[] = [];
  for (const r of records) {
    const res = r.record.result;
    if (!res || res.outcome !== 'finished' || typeof res.score !== 'number' || !Number.isFinite(res.score)) continue;
    if (versionOf(r) !== version || seen.has(r.record.sessionId)) continue;
    const caseId = r.record.caseId ?? res.caseId ?? null;
    if (o.caseId && caseId !== o.caseId) continue;
    seen.add(r.record.sessionId);
    const x = res as typeof res & { hintsUsed?: number; detections?: number; hits?: number; scoreBreakdown?: ScoreBreakdown | null };
    rows.push({
      sessionId: r.record.sessionId, nickname: r.nickname, score: res.score, characterId: r.record.duo?.characterId ?? null,
      pokemonId: r.record.duo?.pokemonId ?? null, caseId, activeTimeS: res.activeTimeS, finalizedAt: r.endedAt,
      hintsUsed: x.hintsUsed ?? null, detections: x.detections ?? null, hits: x.hits ?? null, scoreBreakdown: x.scoreBreakdown ?? null,
    });
  }
  return rankEntries(rows).slice(0, o.limit ?? 5);
}

/** LOCAL DEMO defeat log (DNFs of this rules version, newest first, never ranked). */
export function localDefeatLog(records: readonly LocalRecordLike[], o: { limit?: number; rulesVersion?: MysteryRulesVersion } = {}): DefeatEntry[] {
  const version = o.rulesVersion ?? MYSTERY_RULES_VERSION;
  return records
    .filter((r) => r.record.result?.outcome === 'dnf' && versionOf(r) === version)
    .map((r) => {
      const res = r.record.result as NonNullable<SessionRecord['result']> & { hintsUsed?: number; detections?: number; hits?: number; defeatedBy?: EnemyId | null };
      return {
        sessionId: r.record.sessionId, nickname: r.nickname, characterId: r.record.duo?.characterId ?? null, pokemonId: r.record.duo?.pokemonId ?? null,
        caseId: r.record.caseId ?? res.caseId ?? null, defeatedBy: res.defeatedBy ?? null, activeTimeS: res.activeTimeS, clueCount: res.cluesFound.length,
        hintsUsed: res.hintsUsed ?? null, detections: res.detections ?? null, hits: res.hits ?? null, finalizedAt: r.endedAt,
      };
    })
    .sort((a, b) => b.finalizedAt.localeCompare(a.finalizedAt) || a.sessionId.localeCompare(b.sessionId))
    .slice(0, o.limit ?? 50);
}

/** The rank a new local finisher would get on this laptop (results "#n on this laptop"), null when not rankable. */
export function localRankOf(records: readonly LocalRecordLike[], sessionId: string): number | null {
  return rankLocalRecords(records, { limit: Number.MAX_SAFE_INTEGER }).find((e) => e.sessionId === sessionId)?.rank ?? null;
}
