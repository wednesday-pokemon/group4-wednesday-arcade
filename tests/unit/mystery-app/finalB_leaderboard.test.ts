// Frontend B — final wave: the home / full leaderboard model (docs/final/UX_FINAL.md §5, FINAL_CONTRACT §1 + §10).
// Ranking = finishers (score desc, time asc) above DNFs; mystery-v3.1 records / rows never mix in; LOCAL DEMO scores are
// the shared scoreV4 recomputed from the record's RULE events; LIVE rows must say rules_version 'mystery-v4'.
import { describe, expect, it } from 'vitest';
import type { SessionRecord } from '../../../src/mystery/analytics/types.ts';
import { scoreV4 } from '../../../src/mystery/scoring.ts';
import type { StampedEvent } from '../../../src/mystery/types.ts';
import {
  adaptLiveBoard, boardSnapshot, defeatLog, entryFromLocal, entryFromRow, fmtClock, fmtPoints, isV4Record, liveBoardFeed, localBoard,
  rankFinishers, rankOf, standings, type BoardEntry, type HomeBoardSnapshot, type LocalStoredRecord,
} from '../../../src/ui/mystery/leaderboard/model.ts';

const entry = (over: Partial<BoardEntry> & { id: string }): BoardEntry => ({
  nickname: over.id, outcome: 'finished', score: 1000, activeTimeS: 100, caseId: 'poisoned_archive', duo: null, hintsUsed: 0, detections: 0,
  hits: 0, cluesFound: 3, defeatedBy: null, finalizedAt: '2026-10-27T18:00:00.000Z', rank: null, ...over,
});

let seq = 0;
function ev(t: number, e: Record<string, unknown>): StampedEvent {
  return { ...e, t, seq: seq++ } as unknown as StampedEvent;
}

function stored(id: string, o: { finished: boolean; time?: number; detections?: number; hits?: number; hints?: number; clues?: number; correct?: boolean; v4?: boolean; by?: 'hyde' | 'crackstone' | 'slurp'; endedAt?: string }): LocalStoredRecord {
  const time = o.time ?? 150;
  const events: StampedEvent[] = [];
  if (o.v4 !== false) events.push(ev(3, { type: 'enemy_spawned', enemy: 'hyde', spawnId: 's', x: 0, z: 0 }));
  for (let i = 0; i < (o.detections ?? 0); i++) events.push(ev(10 + i, { type: 'enemy_detected', enemy: 'hyde', via: 'sight' }));
  for (let i = 0; i < (o.hits ?? 0); i++) events.push(ev(20 + i, { type: 'enemy_hit', enemy: o.by ?? 'hyde', hpLost: 30, blocked: false }));
  for (let i = 0; i < (o.hints ?? 0); i++) events.push(ev(30 + i, { type: 'hint_requested', ...(o.v4 === false ? {} : { level: 1 }) }));
  if (o.finished) events.push(ev(time - 1, { type: 'egg_delivered', tier: 'common', points: 1, security: 90 }));
  else events.push(ev(time, { type: 'dnf', reason: 'hp_depleted', ...(o.v4 === false ? {} : { by: o.by ?? 'hyde' }) }));
  const record: SessionRecord = {
    sessionId: id, caseId: 'crypt_last_witness', caseVersion: o.v4 === false ? 2 : 3, duo: { characterId: 'enid', pokemonId: 'gengar' }, events,
    result: {
      caseVersion: o.v4 === false ? 2 : 3, outcome: o.finished ? 'finished' : 'dnf', verdict: o.finished ? 'case_solved' : 'not_accused', activeTimeS: time, score: o.finished ? 1 : null,
      cluesFound: ['a', 'b', 'c'].slice(0, o.clues ?? 3) as never, catches: 0, caseId: 'crypt_last_witness', correct: o.finished && o.correct !== false,
      eggPoints: o.finished ? 1 : 0,
    },
  };
  return { record, nickname: id.toUpperCase(), stationId: 'local', endedAt: o.endedAt ?? '2026-10-27T18:00:00.000Z' };
}

describe('ranking (finishers above DNFs, ties by time)', () => {
  it('score desc, then active time asc; DNFs never ranked and always below every finisher', () => {
    const list = [
      entry({ id: 'slow', score: 1500, activeTimeS: 200 }),
      entry({ id: 'dnf-long', outcome: 'dnf', score: null, activeTimeS: 900 }),
      entry({ id: 'fast', score: 1500, activeTimeS: 120 }),
      entry({ id: 'zero', score: 0, activeTimeS: 400 }),
      entry({ id: 'best', score: 2000, activeTimeS: 300 }),
      entry({ id: 'dnf-short', outcome: 'dnf', score: null, activeTimeS: 30 }),
    ];
    const ranked = rankFinishers(list);
    expect(ranked.map((e) => [e.id, e.rank])).toEqual([['best', 1], ['fast', 2], ['slow', 3], ['zero', 4]]);
    const all = standings(list);
    expect(all.map((e) => e.id)).toEqual(['best', 'fast', 'slow', 'zero', 'dnf-long', 'dnf-short']);
    expect(all.filter((e) => e.outcome === 'dnf').every((e) => e.rank === null && e.score === null)).toBe(true);
    // a score-0 finisher still ranks above a DNF that survived far longer
    expect(all.indexOf(all.find((e) => e.id === 'zero')!)).toBeLessThan(all.indexOf(all.find((e) => e.id === 'dnf-long')!));
  });

  it('identical score + time + finalized share a rank (SQL rank()); the next rank skips', () => {
    const r = rankFinishers([entry({ id: 'a', score: 900 }), entry({ id: 'b', score: 900 }), entry({ id: 'c', score: 800 })]);
    expect(r.map((e) => e.rank)).toEqual([1, 1, 3]);
    // equal score, equal time, earlier finalize wins
    const t = rankFinishers([entry({ id: 'late', score: 900, finalizedAt: '2026-10-27T19:00:00Z' }), entry({ id: 'early', score: 900, finalizedAt: '2026-10-27T18:30:00Z' })]);
    expect(t.map((e) => [e.id, e.rank])).toEqual([['early', 1], ['late', 2]]);
  });

  it('defeat log = DNFs newest first; snapshot keeps top 20', () => {
    const d = defeatLog([entry({ id: 'old', outcome: 'dnf', finalizedAt: '2026-10-27T18:00:00Z' }), entry({ id: 'new', outcome: 'dnf', finalizedAt: '2026-10-27T20:00:00Z' }), entry({ id: 'f' })]);
    expect(d.map((e) => e.id)).toEqual(['new', 'old']);
    const many = Array.from({ length: 30 }, (_, i) => entry({ id: `p${i}`, score: 1000 + i }));
    const snap = boardSnapshot('local', many);
    expect(snap.top).toHaveLength(20);
    expect(snap.top[0]!.id).toBe('p29');
  });

  it('rankOf: own rank, else 1 + finishers strictly ahead; DNF → null', () => {
    const list = [entry({ id: 'a', score: 2000 }), entry({ id: 'b', score: 1500 })];
    expect(rankOf(list, 'b')).toBe(2);
    expect(rankOf(list, 'me', { score: 1700, activeTimeS: 100 })).toBe(2);
    expect(rankOf(list, 'me', { score: null, activeTimeS: 100 })).toBeNull();
  });
});

describe('LOCAL DEMO: this laptop, mystery-v4 only', () => {
  it('v4 detection: explicit version, breakdown or v4-only events; a v3.1 record is excluded', () => {
    expect(isV4Record(stored('v4', { finished: true }).record)).toBe(true);
    expect(isV4Record(stored('v31', { finished: true, v4: false }).record)).toBe(false);
    // a v4 case version alone proves it (a short run may have no director event yet)
    const bare = stored('bare', { finished: true, v4: false }).record;
    expect(isV4Record({ ...bare, caseVersion: 3 })).toBe(true);
    const explicit = stored('x', { finished: true, v4: false }).record;
    expect(isV4Record({ ...explicit, rulesVersion: 'mystery-v4' } as SessionRecord)).toBe(true);
    const old = stored('y', { finished: true }).record;
    expect(isV4Record({ ...old, result: { ...old.result!, rulesVersion: 'mystery-v3.1' } } as unknown as SessionRecord)).toBe(false);
  });

  it('scores = scoreV4 from the RULE events (never the stored v3.1 number); v3.1 never appears', () => {
    const recs = [
      stored('clean', { finished: true, time: 142 }), // 1000+300+300+150+150+158
      stored('messy', { finished: true, time: 205, detections: 1, hits: 2, hints: 1 }), // 1000+300+300+0+0+95−50−150
      stored('old', { finished: true, time: 60, v4: false }), // v3.1: must be dropped even though it is fastest
      stored('dead', { finished: false, time: 88, hits: 3, by: 'slurp' }),
    ];
    const b = localBoard(recs);
    expect(b.source).toBe('local');
    expect(b.top.map((e) => [e.id, e.score, e.rank])).toEqual([['clean', 2058, 1], ['messy', 1495, 2]]);
    expect(b.top[1]!.score).toBe(scoreV4({ delivered: true, correct: true, cluesFound: 3, detections: 1, hintsUsed: 1, hits: 2, activeTimeS: 205 }).total);
    expect(b.top.some((e) => e.id === 'old')).toBe(false);
    expect(b.defeats.map((e) => [e.id, e.defeatedBy, e.score])).toEqual([['dead', 'slurp', null]]);
    expect(b.top[1]).toMatchObject({ hintsUsed: 1, detections: 1, hits: 2, nickname: 'MESSY', caseId: 'crypt_last_witness' });
  });

  it('a sim breakdown wins over the recomputation; wrong culprit / few clues score less; clamp at 0', () => {
    const s = stored('bd', { finished: true });
    (s.record.result as Record<string, unknown>).scoreBreakdown = { total: 1234 };
    expect(entryFromLocal(s)!.score).toBe(1234);
    expect(entryFromLocal(stored('wrong', { finished: true, time: 400, correct: false, clues: 1 }))!.score).toBe(1000 + 100 + 150 + 150);
    expect(entryFromLocal(stored('awful', { finished: true, time: 400, hits: 20, hints: 9 }))!.score).toBe(0);
  });
});

describe('LIVE rows (v4 views only)', () => {
  const top5 = { rank: 1, session_id: 's1', nickname: 'Raven', score: '1708', character_id: 'wednesday', pokemon_id: 'gengar', case_id: 'midnight_signal', active_time_s: '142.3', finalized_at: '2026-10-27T18:00:00Z', rules_version: 'mystery-v4' };
  it('maps a mystery_top5 row; refuses rows without rules_version mystery-v4', () => {
    expect(entryFromRow(top5)).toMatchObject({ id: 's1', nickname: 'Raven', score: 1708, activeTimeS: 142.3, rank: 1, outcome: 'finished', duo: { characterId: 'wednesday', pokemonId: 'gengar' } });
    expect(entryFromRow({ ...top5, rules_version: 'mystery-v3.1' })).toBeNull();
    expect(entryFromRow({ ...top5, rules_version: undefined })).toBeNull();
    expect(entryFromRow({ session_id: 'd', outcome: 'dnf', defeated_by: 'crackstone', active_time_s: 60, rules_version: 'mystery-v4' }, 'dnf')).toMatchObject({ outcome: 'dnf', defeatedBy: 'crackstone', score: null });
  });

  it('adaptLiveBoard: raw view rows or a ready snapshot; connection → Reconnecting; v3.1 rows dropped', () => {
    const snap = adaptLiveBoard({ connection: 'connected', top5: [top5, { ...top5, session_id: 'old', score: 3000, rules_version: 'mystery-v3.1' }], defeated: [{ session_id: 'd1', defeated_by: 'slurp', active_time_s: 80, rules_version: 'mystery-v4', finalized_at: '2026-10-27T18:00:00Z' }] })!;
    expect(snap.source).toBe('live');
    expect(snap.status).toBe('ready');
    expect(snap.top.map((e) => e.id)).toEqual(['s1']);
    expect(snap.defeats.map((e) => [e.id, e.defeatedBy])).toEqual([['d1', 'slurp']]);
    expect(adaptLiveBoard({ connection: 'reconnecting', top5: [] })!.status).toBe('reconnecting');
    expect(adaptLiveBoard({ loaded: false, leaderboard: [] })!.status).toBe('loading');
    expect(adaptLiveBoard({ nothing: true })).toBeNull();
    const ready: HomeBoardSnapshot = { source: 'live', status: 'ready', top: [entry({ id: 'z', score: 10 })], defeats: [], updatedAt: 1 };
    expect(adaptLiveBoard(ready)!.top[0]!.rank).toBe(1);
  });

  it('liveBoardFeed feature-detects `live.leaderboard.subscribe`', () => {
    expect(liveBoardFeed(null)).toBeNull();
    expect(liveBoardFeed({ stationId: 'station_a' })).toBeNull();
    const got: HomeBoardSnapshot[] = [];
    const feed = liveBoardFeed({ leaderboard: { subscribe: (l: (raw: unknown) => void) => { l({ connection: 'connected', top5: [top5] }); l({ garbage: 1 }); return () => undefined; } } })!;
    feed.subscribe((s) => got.push(s));
    expect(got).toHaveLength(1);
    expect(got[0]!.top[0]!.nickname).toBe('Raven');
  });

  it('formatting', () => {
    expect(fmtPoints(1708)).toBe('1,708');
    expect(fmtPoints(650)).toBe('650');
    expect(fmtClock(142.9)).toBe('2:22');
    expect(fmtClock(0)).toBe('0:00');
  });
});
