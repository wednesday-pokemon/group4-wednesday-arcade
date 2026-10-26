// LIVE DashboardFeed: anon REST loads + fake Realtime; dedupe, out-of-order tolerance, reconnect refetch.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DashboardSnapshot } from '../../src/lib/backend.ts';
import { DashboardState } from '../../src/lib/supabase/dashboardFeed.ts';
import { isNewerStationRow, mapScoreRow, mapStationRow, type LeaderboardRow, type StationStatusRow } from '../../src/lib/supabase/mappers.ts';
import { FakeSupabaseServer, lcg, openPage, playRace, settle, stationCredentials } from './fakeSupabase.ts';

function stationRow(over: Partial<StationStatusRow>): StationStatusRow {
  return {
    station_id: 'station_a', label: 'Station A', session_id: 's-1', nickname: 'Alpha', character_id: 'enid', pokemon_id: 'gengar',
    status: 'in_progress', phase: 'awaiting_route', leg_index: 1, hp: 100, gap_m: 80, catches: 0, banked_eggs: 0, sim_time_cs: 0,
    final_score: null, notice: null, revision: 0, updated_at: '2026-10-31T18:00:00.000Z', ...over,
  };
}

function entry(over: Partial<LeaderboardRow> = {}): LeaderboardRow {
  return {
    session_id: 'e-1', nickname: 'Eggy', station_id: 'station_a', character_id: 'enid', pokemon_id: 'gengar', status: 'completed',
    final_egg_points: 4, total_simulated_time_cs: 12345, final_score: '276.55', dnf_reason: null, dnf_leg: null, rules_version: 'v2.5',
    verified_at: '2026-10-31T18:10:00.000Z', ...over,
  };
}

describe('mappers', () => {
  it('leaderboard row -> ScoreRecord (final_score via Number, verified, completedAt = verified_at)', () => {
    expect(mapScoreRow(entry(), 'completed')).toEqual({
      sessionId: 'e-1', nickname: 'Eggy', stationId: 'station_a', characterId: 'enid', pokemonId: 'gengar', status: 'completed',
      finalEggPoints: 4, totalSimulatedTimeCs: 12345, finalScore: 276.55, completedAt: '2026-10-31T18:10:00.000Z', verified: true,
      rulesVersion: 'v2.5',
    });
    expect(mapScoreRow(entry({ final_score: -12.5 }), 'completed')?.finalScore).toBe(-12.5);
  });
  it('defeated_log row (no score columns) -> dnf record scoring 0', () => {
    const { final_score: _f, final_egg_points: _e, status: _s, ...dnf } = entry({ dnf_reason: 'second_catch', dnf_leg: 2 });
    expect(mapScoreRow(dnf as LeaderboardRow, 'dnf')).toMatchObject({ status: 'dnf', finalScore: 0, finalEggPoints: 0, verified: true });
  });
  it('rejects rows with unknown station / character / pokemon', () => {
    expect(mapScoreRow(entry({ station_id: 'station_z' }), 'completed')).toBeNull();
    expect(mapScoreRow(entry({ character_id: 'dracula' }), 'completed')).toBeNull();
    expect(mapStationRow(stationRow({ station_id: 'station_q' }))).toBeNull();
  });
  it('station row -> StationStatus', () => {
    expect(mapStationRow(stationRow({ revision: 3, gap_m: 55 }))).toEqual({
      stationId: 'station_a', sessionId: 's-1', nickname: 'Alpha', characterId: 'enid', pokemonId: 'gengar', status: 'in_progress',
      legIndex: 1, phase: 'awaiting_route', hp: 100, gapM: 55, catches: 0, bankedEggs: 0, simTimeCs: 0, revision: 3,
      updatedAt: '2026-10-31T18:00:00.000Z',
    });
  });
});

describe('DashboardState: duplicates and out-of-order delivery', () => {
  it('same session: highest revision wins regardless of arrival order; duplicates are no-ops', () => {
    const st = new DashboardState();
    const r1 = stationRow({ revision: 1, updated_at: '2026-10-31T18:00:01.000Z' });
    const r2 = stationRow({ revision: 2, updated_at: '2026-10-31T18:00:02.000Z', phase: 'awaiting_egg' });
    const r3 = stationRow({ revision: 3, updated_at: '2026-10-31T18:00:03.000Z', leg_index: 2 });
    expect(st.mergeStation(r3)).toBe(true);
    expect(st.mergeStation(r1)).toBe(false);
    expect(st.mergeStation(r2)).toBe(false);
    expect(st.mergeStation(r3)).toBe(false);
    expect(st.snapshot('connected').stations[0]).toMatchObject({ revision: 3, legIndex: 2 });
  });

  it('a NEW session restarting at revision 0 replaces the previous session at revision 7 (updated_at decides across sessions)', () => {
    const st = new DashboardState();
    st.mergeStation(stationRow({ session_id: 'old', revision: 7, status: 'completed', updated_at: '2026-10-31T18:05:00.000Z' }));
    st.mergeStation(stationRow({ session_id: null, status: 'idle', revision: 8, updated_at: '2026-10-31T18:06:00.000Z', nickname: null }));
    st.mergeStation(stationRow({ session_id: 'new', revision: 0, updated_at: '2026-10-31T18:07:00.000Z', nickname: 'Newbie' }));
    st.mergeStation(stationRow({ session_id: 'old', revision: 7, status: 'completed', updated_at: '2026-10-31T18:05:00.000Z' })); // late dup
    expect(st.snapshot('connected').stations[0]).toMatchObject({ sessionId: 'new', nickname: 'Newbie', revision: 0 });
    expect(isNewerStationRow(stationRow({ revision: 5, updated_at: 'x' }), stationRow({ revision: 4, updated_at: 'y' }))).toBe(true);
  });

  it('duplicate leaderboard INSERTs are deduped by session_id; DELETE removes', () => {
    const st = new DashboardState();
    st.insertEntry(entry());
    st.insertEntry(entry());
    st.insertEntry(entry({ session_id: 'e-2', final_score: '300.00', final_egg_points: 5 }));
    st.insertEntry(entry({ session_id: 'd-1', status: 'dnf', final_score: '0', dnf_reason: 'hp_depleted', dnf_leg: 3 }));
    st.insertEntry(entry({ session_id: 'd-1', status: 'dnf', final_score: '0', dnf_reason: 'hp_depleted', dnf_leg: 3 }));
    let snap = st.snapshot('connected');
    expect(snap.leaderboard.map((r) => r.sessionId)).toEqual(['e-2', 'e-1']);
    expect(snap.defeated.map((r) => r.sessionId)).toEqual(['d-1']);
    st.deleteEntry('e-2');
    snap = st.snapshot('connected');
    expect(snap.leaderboard.map((r) => r.sessionId)).toEqual(['e-1']);
  });

  it('ranking is re-sorted with rankLeaderboard even if the view order is wrong', () => {
    const st = new DashboardState();
    const id = st.beginLoad();
    st.completeLoad(id, [
      entry({ session_id: 'low', final_score: 10, rank: 1 }),
      entry({ session_id: 'high', final_score: 500, rank: 2 }),
      entry({ session_id: 'tie-late', final_score: 10, verified_at: '2026-10-31T19:00:00.000Z', rank: 3 }),
    ], [], []);
    expect(st.snapshot('connected').leaderboard.map((r) => r.sessionId)).toEqual(['high', 'low', 'tie-late']);
  });

  it('a slow REST load does not drop Realtime INSERTs/DELETEs that arrived meanwhile; stale loads are ignored', () => {
    const st = new DashboardState();
    const slow = st.beginLoad();
    st.insertEntry(entry({ session_id: 'live-1' }));
    const fast = st.beginLoad();
    st.deleteEntry('gone');
    st.completeLoad(fast, [entry({ session_id: 'rest-1' }), entry({ session_id: 'live-1' })], [], []);
    st.insertEntry(entry({ session_id: 'live-2' }));
    // the older (slow) load returns last with an outdated list that still contains 'gone'
    st.completeLoad(slow, [entry({ session_id: 'rest-1' }), entry({ session_id: 'gone' })], [], []);
    expect(st.snapshot('connected').leaderboard.map((r) => r.sessionId).sort()).toEqual(['live-1', 'live-2', 'rest-1']);
  });
});

describe('LIVE dashboard feed against the fake project', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('anonymous spectator: initial REST load, then live station + leaderboard updates; connection connected', async () => {
    const server = new FakeSupabaseServer();
    const dashboard = openPage(server, null); // never signs in
    const snaps: DashboardSnapshot[] = [];
    const stop = dashboard.services.dashboard.subscribe((s) => snaps.push(s));
    await settle();
    expect(snaps.at(-1)!.connection).toBe('connected');
    expect(snaps.at(-1)!.mode).toBe('live');
    expect(snaps.at(-1)!.stations.map((s) => s.status)).toEqual(['idle', 'idle']);

    const terminal = openPage(server, 'station_a');
    await terminal.services.auth.signIn(stationCredentials('station_a').email, stationCredentials('station_a').password);
    const { views } = await playRace(terminal.services.backend, 'Live Lou', lcg(5));
    await settle();
    const last = snaps.at(-1)!;
    const final = views.at(-1)!;
    const a = last.stations.find((s) => s.stationId === 'station_a')!;
    expect(a.sessionId).toBe(final.state.sessionId);
    expect(a.status).toBe(final.state.status);
    const list = final.state.status === 'completed' ? last.leaderboard : last.defeated;
    expect(list.map((r) => r.sessionId)).toEqual([final.state.sessionId]);
    expect(list[0].verified).toBe(true);
    if (final.state.status === 'completed') expect(list[0].finalScore).toBe(final.state.finalScore);
    expect(server.restRequests).toEqual(expect.arrayContaining(['verified_leaderboard', 'defeated_log', 'station_status']));
    stop();
    expect(server.realtime.active()).toHaveLength(0);
  });

  it('duplicate and reversed Realtime deliveries leave a consistent snapshot', async () => {
    const server = new FakeSupabaseServer();
    const dashboard = openPage(server, null);
    const snaps: DashboardSnapshot[] = [];
    dashboard.services.dashboard.subscribe((s) => snaps.push(s));
    await settle();
    const terminal = openPage(server, 'station_b');
    await terminal.services.auth.signIn(stationCredentials('station_b').email, stationCredentials('station_b').password);
    server.realtime.paused = true;
    const { views } = await playRace(terminal.services.backend, 'Shuffled', lcg(9));
    server.realtime.flush({ reverse: true, duplicate: true });
    await settle();
    const b = snaps.at(-1)!.stations.find((s) => s.stationId === 'station_b')!;
    expect(b.revision).toBe(views.at(-1)!.state.revision);
    expect(b.status).toBe(views.at(-1)!.state.status);
    const all = [...snaps.at(-1)!.leaderboard, ...snaps.at(-1)!.defeated];
    expect(all.filter((r) => r.sessionId === views[0].state.sessionId)).toHaveLength(1);
  });

  it('CHANNEL_ERROR -> offline; rejoin (SUBSCRIBED) -> refetch picks up what was missed -> connected', async () => {
    const server = new FakeSupabaseServer();
    const dashboard = openPage(server, null);
    const snaps: DashboardSnapshot[] = [];
    dashboard.services.dashboard.subscribe((s) => snaps.push(s));
    await settle();
    const loadsBefore = server.restRequests.filter((t) => t === 'verified_leaderboard').length;
    server.realtime.setStatus('CHANNEL_ERROR');
    expect(snaps.at(-1)!.connection).toBe('offline');
    // A race finishes while we are disconnected: insert directly, without Realtime delivery
    const terminal = openPage(server, 'station_a');
    await terminal.services.auth.signIn(stationCredentials('station_a').email, stationCredentials('station_a').password);
    server.realtime.paused = true;
    const { views } = await playRace(terminal.services.backend, 'Missed Me', lcg(21));
    server.realtime.queue.splice(0); // lost
    server.realtime.paused = false;
    server.realtime.setStatus('SUBSCRIBED');
    await settle();
    expect(server.restRequests.filter((t) => t === 'verified_leaderboard').length).toBe(loadsBefore + 1);
    const last = snaps.at(-1)!;
    expect(last.connection).toBe('connected');
    expect(last.stations.find((s) => s.stationId === 'station_a')!.sessionId).toBe(views.at(-1)!.state.sessionId);
    expect([...last.leaderboard, ...last.defeated].map((r) => r.sessionId)).toContain(views[0].state.sessionId);
  });

  it('CLOSED/TIMED_OUT without a rejoin: the channel is re-created after backoff and data refetched', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const server = new FakeSupabaseServer();
    const dashboard = openPage(server, null);
    const snaps: DashboardSnapshot[] = [];
    dashboard.services.dashboard.subscribe((s) => snaps.push(s));
    await vi.advanceTimersByTimeAsync(10);
    const first = server.realtime.active()[0];
    first.status('TIMED_OUT');
    expect(snaps.at(-1)!.connection).toBe('offline');
    await vi.advanceTimersByTimeAsync(2100);
    expect(first.removed).toBe(true);
    expect(server.realtime.active()).toHaveLength(1);
    expect(server.realtime.active()[0]).not.toBe(first);
    await vi.advanceTimersByTimeAsync(10);
    expect(snaps.at(-1)!.connection).toBe('connected');
  });

  it('browser offline -> offline; polls REST while not connected; failed loads still emit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const server = new FakeSupabaseServer();
    server.realtime.autoSubscribe = false;
    server.restFailures = 3; // the first load fails entirely (3 parallel selects)
    const dashboard = openPage(server, null, { dashboardPollMs: 1000 });
    const snaps: DashboardSnapshot[] = [];
    dashboard.services.dashboard.subscribe((s) => snaps.push(s));
    await vi.advanceTimersByTimeAsync(10);
    expect(snaps.length).toBeGreaterThan(0);
    expect(snaps.at(-1)!.connection).toBe('connecting');
    const before = server.restRequests.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.restRequests.length).toBeGreaterThan(before); // polled
    expect(snaps.at(-1)!.stations).toHaveLength(2);
    dashboard.online.set(false);
    expect(snaps.at(-1)!.connection).toBe('offline');
  });

  it('operator nickname moderation (DELETE) removes the row live', async () => {
    const server = new FakeSupabaseServer();
    const dashboard = openPage(server, null);
    const snaps: DashboardSnapshot[] = [];
    dashboard.services.dashboard.subscribe((s) => snaps.push(s));
    await settle();
    const terminal = openPage(server, 'station_a');
    await terminal.services.auth.signIn(stationCredentials('station_a').email, stationCredentials('station_a').password);
    const { views } = await playRace(terminal.services.backend, 'Rude Name', lcg(2));
    await settle();
    const id = views[0].state.sessionId;
    expect([...snaps.at(-1)!.leaderboard, ...snaps.at(-1)!.defeated].some((r) => r.sessionId === id)).toBe(true);
    server.moderateDelete(id);
    await settle();
    expect([...snaps.at(-1)!.leaderboard, ...snaps.at(-1)!.defeated].some((r) => r.sessionId === id)).toBe(false);
  });
});
