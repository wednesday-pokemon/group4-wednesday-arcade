// A03 station isolation: two terminals race concurrently through a fake server that runs the REAL engine;
// sessions never cross stations and no dashboard snapshot ever mixes them.
import { describe, expect, it } from 'vitest';
import type { SessionView, StationId } from '../../src/game/index.ts';
import type { DashboardSnapshot } from '../../src/lib/backend.ts';
import { BackendError } from '../../src/lib/backend.ts';
import { FakeSupabaseServer, lcg, openPage, playRace, settle, stationCredentials } from './fakeSupabase.ts';

const ROUNDS = 6;

async function terminal(server: FakeSupabaseServer, stationId: StationId) {
  const page = openPage(server, stationId);
  const { email, password } = stationCredentials(stationId);
  await page.services.auth.signIn(email, password);
  return page;
}

describe('A03 station isolation (concurrent terminals, real engine)', () => {
  it(`station_a and station_b keep separate sessions over ${ROUNDS} concurrent races each; dashboard never mixes them`, async () => {
    const server = new FakeSupabaseServer();
    const a = await terminal(server, 'station_a');
    const b = await terminal(server, 'station_b');
    const dashboard = openPage(server, null);
    const snaps: DashboardSnapshot[] = [];
    const stop = dashboard.services.dashboard.subscribe((s) => snaps.push(s));
    await settle();

    const seen: Record<StationId, SessionView[]> = { station_a: [], station_b: [], station_c: [] };
    const nick = (st: StationId, i: number) => `${st === 'station_a' ? 'Alpha' : 'Bravo'} ${i}`;
    const run = async (st: StationId, page: typeof a, seed: number) => {
      const rand = lcg(seed);
      for (let i = 0; i < ROUNDS; i++) {
        await playRace(page.services.backend, nick(st, i), rand, async (view) => {
          seen[st].push(view);
          await new Promise((r) => setTimeout(r, Math.floor(rand() * 3))); // interleave the two terminals
        });
      }
    };
    await Promise.all([run('station_a', a, 101), run('station_b', b, 202)]);
    await settle();

    // 1. Server: each station owns exactly its sessions; nicknames prove who created them.
    const idsOf = (st: StationId) => new Set(server.sessionsOf(st).map((s) => s.id));
    const ids = { station_a: idsOf('station_a'), station_b: idsOf('station_b') };
    expect(ids.station_a.size).toBe(ROUNDS);
    expect(ids.station_b.size).toBe(ROUNDS);
    for (const s of server.sessionsOf('station_a')) expect(s.state.nickname.startsWith('Alpha')).toBe(true);
    for (const s of server.sessionsOf('station_b')) expect(s.state.nickname.startsWith('Bravo')).toBe(true);

    // 2. Each terminal only ever received its own station's sessions.
    for (const st of ['station_a', 'station_b'] as const) {
      expect(seen[st].length).toBeGreaterThan(ROUNDS * 3);
      for (const v of seen[st]) expect(ids[st].has(v.state.sessionId)).toBe(true);
    }

    // 3. No snapshot ever shows a session or nickname of the other station on a station card or a record.
    expect(snaps.length).toBeGreaterThan(ROUNDS * 4);
    for (const snap of snaps) {
      for (const card of snap.stations) {
        const st = card.stationId as StationId;
        if (card.sessionId) expect(ids[st as 'station_a' | 'station_b'].has(card.sessionId)).toBe(true); // station_c stays idle here
        if (card.nickname) expect(card.nickname.startsWith(st === 'station_a' ? 'Alpha' : 'Bravo')).toBe(true);
      }
      for (const r of [...snap.leaderboard, ...snap.defeated]) {
        expect(ids[r.stationId as 'station_a' | 'station_b'].has(r.sessionId)).toBe(true);
      }
    }

    // 4. Final board = exactly the server's verified results, with server-computed scores.
    const last = snaps.at(-1)!;
    const results = [...last.leaderboard, ...last.defeated];
    expect(results).toHaveLength(ROUNDS * 2);
    for (const r of results) {
      const s = server.sessions.get(r.sessionId)!;
      expect(r.stationId).toBe(s.stationId);
      expect(r.status).toBe(s.state.status);
      if (r.status === 'completed') expect(r.finalScore).toBe(s.state.finalScore);
    }
    for (const card of last.stations) {
      const lastOwn = server.sessionsOf(card.stationId as StationId).at(-1);
      expect(card.sessionId ?? null).toBe(lastOwn?.id ?? null); // station_c played nothing here: stays empty
    }
    stop();
  });

  it('a terminal cannot touch the other station’s session (404 -> NOT_FOUND) and get-session stays scoped', async () => {
    const server = new FakeSupabaseServer();
    const a = await terminal(server, 'station_a');
    const b = await terminal(server, 'station_b');
    const va = await a.services.backend.createSession({ nickname: 'Alpha Solo', characterId: 'enid', pokemonId: 'gengar' });
    const attempts = [
      b.services.backend.prepareLeg({ sessionId: va.state.sessionId, expectedRevision: 0, route: 'safe', pushLevel: 1, actionId: 'xstation-0001' }),
      b.services.backend.resolveLeg({ sessionId: va.state.sessionId, expectedRevision: 0, eggDecision: 'skip', actionId: 'xstation-0002' }),
    ];
    for (const p of attempts) expect(((await p.catch((x) => x)) as BackendError).code).toBe('NOT_FOUND');
    expect(await b.services.backend.abandonSession(va.state.sessionId, 'xstation-0003')).toBeNull();
    expect(await b.services.backend.getActiveSession()).toBeNull();
    expect((await a.services.backend.getActiveSession())?.state.sessionId).toBe(va.state.sessionId);
    expect(server.sessions.get(va.state.sessionId)!.state.revision).toBe(0);
  });

  it('a reset of station_b never reaches station_a', async () => {
    const server = new FakeSupabaseServer();
    const a = await terminal(server, 'station_a');
    const b = await terminal(server, 'station_b');
    const events: Record<StationId, string[]> = { station_a: [], station_b: [], station_c: [] };
    a.services.subscribeStation((e) => events.station_a.push(e.type));
    b.services.subscribeStation((e) => events.station_b.push(e.type));
    await settle();
    await a.services.backend.createSession({ nickname: 'Alpha Safe', characterId: 'enid', pokemonId: 'gengar' });
    await b.services.backend.createSession({ nickname: 'Bravo Reset', characterId: 'enid', pokemonId: 'gengar' });
    const ops = openPage(server, null);
    await ops.services.auth.signIn('ops@regatta.test', 'pw-O-123456789');
    await ops.services.operator.resetStation('station_b', 'operator_reset');
    await settle();
    expect(events.station_b).toContain('reset_by_operator');
    expect(events.station_a).not.toContain('reset_by_operator');
    expect((await a.services.backend.getActiveSession())?.state.status).toBe('in_progress');
  });
});
