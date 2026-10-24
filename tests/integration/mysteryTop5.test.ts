// Home-page leaderboard feed (FINAL_CONTRACT §10, UX_FINAL §5) against the in-memory fake: anon REST on mystery_top5 /
// mystery_leaderboard_v4 / mystery_defeated_v4, Realtime INSERT / DELETE on mystery_results → refetch, v4 only (v3.1 and
// test rows never appear), ties share a rank, DNFs never ranked, "New #1" / "entered" derivation.
import { describe, expect, it } from 'vitest';
import { fetchDefeatLog, fetchFullLeaderboard, fetchTop5, Top5State, type Top5Snapshot } from '../../src/lib/supabase/mysteryLeaderboard.ts';
import { createSupabase } from '../../src/lib/supabase/client.ts';
import { ANON_KEY, FakeSupabaseServer, memoryStorage, openMysteryBoard, settle } from './fakeSupabase.ts';

let n = 0;
function result(server: FakeSupabaseServer, o: { nick: string; score: number | null; t: number; outcome?: 'finished' | 'dnf'; version?: string; isTest?: boolean; at?: string; by?: string }) {
  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const finished = (o.outcome ?? 'finished') === 'finished';
  const row = {
    session_id: id, station_id: 'station_a', nickname: o.nick, character_id: 'enid', pokemon_id: 'gengar', rules_version: o.version ?? 'mystery-v4',
    case_id: 'poisoned_archive', case_version: 3, outcome: finished ? 'finished' : 'dnf', dnf_reason: finished ? null : 'hp_depleted',
    verdict: finished ? 'case_solved' : 'not_accused', accused: finished ? 'thornhill' : null, correct: finished, evidence: [], deduction_correct: finished,
    clues_found: [], clue_count: 3, egg_tier: 'common', egg_points: finished ? 1 : 0, egg_security: '100.0', active_time_s: o.t.toFixed(1),
    score: o.score === null ? null : o.score.toFixed(1), catches: 0, sightings: 0, hints_used: 0, client_claim: null, claim_matches: true,
    is_test: o.isTest === true, finalized_at: o.at ?? `2026-10-27T18:${String(n).padStart(2, '0')}:00.000Z`,
    detections: 0, hits: 0, defeated_by: finished ? null : (o.by ?? 'slurp'), score_breakdown: null,
  };
  server.mysteryResults.set(id, row);
  if (!row.is_test) {
    const { accused: _a, evidence: _e, client_claim: _c, ...pub } = row;
    server.realtime.emit('mystery_results', 'INSERT', pub);
  }
  return id;
}

describe('home top-5 leaderboard feed (LIVE)', () => {
  it('REST views: v4 verified finishers only, ties share a rank, full board + defeat log', async () => {
    const server = new FakeSupabaseServer();
    const board = openMysteryBoard(server);
    result(server, { nick: 'Ann', score: 1500, t: 100, at: '2026-10-27T18:00:00.000Z' });
    result(server, { nick: 'Ben', score: 1700, t: 120 });
    result(server, { nick: 'Cat', score: 1500, t: 100, at: '2026-10-27T18:00:00.000Z' }); // exact tie with Ann
    result(server, { nick: 'Old', score: 99999, t: 10, version: 'mystery-v3.1' }); // never mixed
    result(server, { nick: 'Tst', score: 99998, t: 10, isTest: true }); // never public
    result(server, { nick: 'Dee', score: null, t: 200, outcome: 'dnf', by: 'slurp' });
    for (const [nick, score] of [['Eve', 900], ['Fay', 800], ['Gus', 700]] as const) result(server, { nick, score, t: 200 });
    const snaps: Top5Snapshot[] = [];
    const stop = board.services.leaderboard.subscribe((s) => snaps.push(s));
    await settle(12);
    const last = snaps.at(-1)!;
    expect(last.loaded).toBe(true);
    expect(last.entries.map((e) => [e.nickname, e.rank, e.score])).toEqual([['Ben', 1, 1700], ['Ann', 2, 1500], ['Cat', 2, 1500], ['Eve', 4, 900], ['Fay', 5, 800]]);
    expect(last.top5.every((r) => r.rules_version === 'mystery-v4')).toBe(true);
    expect(last.leaderboard.map((r) => r.nickname)).toEqual(['Ben', 'Ann', 'Cat', 'Eve', 'Fay', 'Gus']);
    expect(last.defeated.map((r) => [r.nickname, r.defeated_by])).toEqual([['Dee', 'slurp']]);
    expect(JSON.stringify(last)).not.toMatch(/accused|evidence|client_claim|seed/);
    stop();
  });

  it('Realtime: a new v4 finisher refetches the top 5 (New #1 + entered); a DELETE removes it; v3.1 inserts do nothing', async () => {
    const server = new FakeSupabaseServer();
    const board = openMysteryBoard(server);
    result(server, { nick: 'Ann', score: 1500, t: 100 });
    const snaps: Top5Snapshot[] = [];
    const stop = board.services.leaderboard.subscribe((s) => snaps.push(s));
    await settle(12);
    expect(snaps.at(-1)!.entries.map((e) => e.nickname)).toEqual(['Ann']);
    const id = result(server, { nick: 'Zed', score: 2100, t: 90 });
    await new Promise((r) => setTimeout(r, 350)); // debounced refetch
    await settle(12);
    const after = snaps.at(-1)!;
    expect(after.entries.map((e) => [e.nickname, e.rank])).toEqual([['Zed', 1], ['Ann', 2]]);
    expect(after.newTop).toBe(id);
    expect(after.entered).toEqual([id]);
    result(server, { nick: 'Old', score: 99999, t: 1, version: 'mystery-v3.1' });
    await new Promise((r) => setTimeout(r, 350));
    await settle(12);
    expect(snaps.at(-1)!.entries.map((e) => e.nickname)).toEqual(['Zed', 'Ann']);
    server.moderateMysteryDelete(id);
    await new Promise((r) => setTimeout(r, 350));
    await settle(12);
    expect(snaps.at(-1)!.entries.map((e) => e.nickname)).toEqual(['Ann']);
    stop();
  });

  it('fetch helpers: strict row parsing, case-filtered board ranks, defeat log; Top5State derivations', async () => {
    const server = new FakeSupabaseServer();
    result(server, { nick: 'Ann', score: 1500, t: 100 });
    result(server, { nick: 'Bob', score: 1600, t: 100 });
    result(server, { nick: 'Dee', score: null, t: 50, outcome: 'dnf', by: 'hyde' });
    const rest = createSupabase({ url: server.origin, anonKey: ANON_KEY }, null, { fetch: server.fetch, storage: memoryStorage(), autoRefreshToken: false });
    expect((await fetchTop5(rest)).map((e) => [e.nickname, e.rank])).toEqual([['Bob', 1], ['Ann', 2]]);
    const full = await fetchFullLeaderboard(rest, { caseId: 'poisoned_archive' });
    expect(full.map((e) => [e.nickname, e.rank, e.hintsUsed, e.hits])).toEqual([['Bob', 1, 0, 0], ['Ann', 2, 0, 0]]);
    expect((await fetchDefeatLog(rest)).map((d) => [d.nickname, d.defeatedBy])).toEqual([['Dee', 'hyde']]);
    const st = new Top5State();
    st.apply(await fetchTop5(rest));
    expect(st.newTop).toBeNull(); // the first load never flashes "New #1"
    expect(st.apply(await fetchTop5(rest))).toBe(false); // unchanged → no re-render
  });
});
