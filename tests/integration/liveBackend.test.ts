// LIVE GameBackend + AuthGate driven through the REAL supabase-js client against the in-memory contract fake.
import { describe, expect, it } from 'vitest';
import { BackendError } from '../../src/lib/backend.ts';
import { sha256Hex } from '../../src/game/sha256.ts';
import { FakeSupabaseServer, OPERATOR, lcg, openPage, playRace, settle, stationCredentials } from './fakeSupabase.ts';

async function signedInTerminal(server: FakeSupabaseServer, stationId: 'station_a' | 'station_b' = 'station_a', opts: Parameters<typeof openPage>[2] = {}) {
  const page = openPage(server, stationId, opts);
  const { email, password } = stationCredentials(stationId);
  await page.services.auth.signIn(email, password);
  return page;
}

describe('AuthGate', () => {
  it('station account on its own terminal: signIn, currentUser, signOut', async () => {
    const server = new FakeSupabaseServer();
    const page = openPage(server, 'station_a');
    expect(await page.services.auth.currentUser()).toBeNull();
    const user = await page.services.auth.signIn('station-a@regatta.test', 'pw-A-123456789');
    expect(user).toEqual({ email: 'station-a@regatta.test', role: 'station', stationId: 'station_a' });
    expect(await page.services.auth.currentUser()).toEqual(user);
    expect(page.storage.keys()).toContain('raven-regatta:auth:station_a');
    await page.services.auth.signOut();
    expect(await page.services.auth.currentUser()).toBeNull();
  });

  it('rejects (and signs out) a station B account on the station A terminal', async () => {
    const server = new FakeSupabaseServer();
    const page = openPage(server, 'station_a');
    const e = await page.services.auth.signIn('station-b@regatta.test', 'pw-B-123456789').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(BackendError);
    expect((e as BackendError).code).toBe('UNAUTHORIZED');
    expect((e as Error).message).toMatch(/Station B/);
    expect(await page.services.auth.currentUser()).toBeNull();
    expect(page.storage.keys().filter((k) => k.startsWith('raven-regatta:auth:station_a') && !k.endsWith('-code-verifier'))).toHaveLength(0);
  });

  it('rejects operators on terminals, stations on the dashboard, unprovisioned users and bad passwords', async () => {
    const server = new FakeSupabaseServer();
    const terminal = openPage(server, 'station_a');
    expect(((await terminal.services.auth.signIn(OPERATOR.email, OPERATOR.password).catch((x) => x)) as BackendError).code).toBe('UNAUTHORIZED');
    const dashboard = openPage(server, null);
    expect(((await dashboard.services.auth.signIn('station-a@regatta.test', 'pw-A-123456789').catch((x) => x)) as BackendError).code).toBe('UNAUTHORIZED');
    expect(((await dashboard.services.auth.signIn('nobody@regatta.test', 'pw-N-123456789').catch((x) => x)) as Error).message).toMatch(/not provisioned/);
    expect(((await dashboard.services.auth.signIn(OPERATOR.email, 'wrong').catch((x) => x)) as Error).message).toMatch(/Wrong email or password/);
    expect(await dashboard.services.auth.signIn(OPERATOR.email, OPERATOR.password)).toEqual({ email: OPERATOR.email, role: 'operator', stationId: null });
  });

  it('two stations in one browser profile keep separate sessions (per-station storage key)', async () => {
    const server = new FakeSupabaseServer();
    const shared = (await import('./fakeSupabase.ts')).memoryStorage();
    const a = openPage(server, 'station_a', { storage: shared });
    const b = openPage(server, 'station_b', { storage: shared });
    await a.services.auth.signIn('station-a@regatta.test', 'pw-A-123456789');
    await b.services.auth.signIn('station-b@regatta.test', 'pw-B-123456789');
    expect((await a.services.auth.currentUser())?.stationId).toBe('station_a');
    expect((await b.services.auth.currentUser())?.stationId).toBe('station_b');
  });

  it('backend refuses to call any function before sign-in (no request leaves the page)', async () => {
    const server = new FakeSupabaseServer();
    const page = openPage(server, 'station_a');
    const e = await page.services.backend.createSession({ nickname: 'Nobody', characterId: 'enid', pokemonId: 'gengar' }).catch((x) => x);
    expect((e as BackendError).code).toBe('UNAUTHORIZED');
    expect(server.requests).toHaveLength(0);
  });
});

describe('GameBackend over the contract', () => {
  it('plays a full verified race; draws are null while in progress and revealed (with the seed) at the end', async () => {
    const server = new FakeSupabaseServer();
    const { services } = await signedInTerminal(server);
    const { views, resolutions } = await playRace(services.backend, 'Raven Rider', lcg(7));
    const final = views[views.length - 1];
    expect(['completed', 'dnf']).toContain(final.state.status);
    expect(final.verified).toBe(true);
    for (const v of views.slice(0, -1)) {
      expect(v.revealedSeed).toBeNull();
      expect(v.state.legResults.every((r) => r.draws === null)).toBe(true);
    }
    resolutions.slice(0, -1).forEach((r) => expect(r.draws).toBeNull());
    const last = resolutions[resolutions.length - 1];
    expect(last.draws).not.toBeNull();
    expect(final.state.legResults.every((r) => r.draws !== null)).toBe(true);
    // The client can audit the commitment once the seed is revealed.
    expect(sha256Hex(final.revealedSeed!)).toBe(final.seedCommitment);
    // Server truth equals what the client got.
    const s = server.sessions.get(final.state.sessionId)!;
    expect(final.state.finalScore).toBe(s.state.finalScore);
    expect(final.state.revision).toBe(s.state.revision);
  });

  it('request bodies are exactly the contract allow-lists (no advisory, no outcomes)', async () => {
    const server = new FakeSupabaseServer();
    const { services } = await signedInTerminal(server);
    await playRace(services.backend, 'Body Check', lcg(3));
    const keys = (fn: string) => server.functionCalls(fn).map((r) => Object.keys(r.body).sort().join(','));
    expect(new Set(keys('create-session'))).toEqual(new Set(['actionId,characterId,nickname,pokemonId']));
    expect(new Set(keys('prepare-leg'))).toEqual(new Set(['actionId,expectedRevision,pushLevel,route,sessionId']));
    expect(new Set(keys('resolve-leg'))).toEqual(new Set(['actionId,eggDecision,expectedRevision,sessionId']));
    for (const r of server.requests) {
      expect(r.apikey).toBe(server.requests[0].apikey);
      expect(r.authorization).toMatch(/^Bearer /);
      expect(r.authorization).not.toContain(r.apikey!); // user JWT, never the anon key, for functions
    }
  });

  it('create-session: response lost after commit -> retried with the SAME actionId -> one session (A12/A13)', async () => {
    const server = new FakeSupabaseServer();
    const { services } = await signedInTerminal(server);
    server.faults.push({ fn: 'create-session', kind: 'network-after' });
    const view = await services.backend.createSession({ nickname: 'Retry Rita', characterId: 'wednesday', pokemonId: 'gengar' });
    const calls = server.functionCalls('create-session');
    expect(calls).toHaveLength(2);
    expect(calls[0].body.actionId).toBe(calls[1].body.actionId);
    expect(calls[0].body).toEqual(calls[1].body);
    expect(server.sessionsOf('station_a')).toHaveLength(1);
    expect(view.state.sessionId).toBe(server.sessionsOf('station_a')[0].id);
  });

  it('two separate createSession calls use different actionIds', async () => {
    const server = new FakeSupabaseServer();
    const { services } = await signedInTerminal(server);
    await services.backend.createSession({ nickname: 'First One', characterId: 'enid', pokemonId: 'gengar' });
    await services.backend.createSession({ nickname: 'Second One', characterId: 'enid', pokemonId: 'gengar' });
    const [a, b] = server.functionCalls('create-session');
    expect(a.body.actionId).not.toBe(b.body.actionId);
    expect(server.sessionsOf('station_a').map((s) => s.state.status).sort()).toEqual(['abandoned', 'in_progress']);
  });

  it('prepare/resolve: network failure before and INTERNAL -> same actionId, single transition', async () => {
    const server = new FakeSupabaseServer();
    const { services } = await signedInTerminal(server);
    const v0 = await services.backend.createSession({ nickname: 'Steady Sam', characterId: 'kent', pokemonId: 'gengar' });
    server.faults.push({ fn: 'prepare-leg', kind: 'network-before' }, { fn: 'prepare-leg', kind: 'internal' });
    const v1 = await services.backend.prepareLeg({ sessionId: v0.state.sessionId, expectedRevision: v0.state.revision, route: 'safe', pushLevel: 1, actionId: 'prep-action-0001' });
    expect(server.functionCalls('prepare-leg').map((r) => r.body.actionId)).toEqual(['prep-action-0001', 'prep-action-0001', 'prep-action-0001']);
    expect(v1.state.revision).toBe(v0.state.revision + 1);
    server.faults.push({ fn: 'resolve-leg', kind: 'network-after' });
    const r = await services.backend.resolveLeg({ sessionId: v1.state.sessionId, expectedRevision: v1.state.revision, eggDecision: 'skip', actionId: 'res-action-0001' });
    expect(r.view.state.revision).toBe(v1.state.revision + 1);
    expect(server.sessions.get(v0.state.sessionId)!.state.legResults).toHaveLength(1);
    expect(r.resolution.draws).toBeNull();
  });

  it('a UI retry of a persisted intent (same actionId, after success) replays instead of double-applying', async () => {
    const server = new FakeSupabaseServer();
    const { services } = await signedInTerminal(server);
    const v0 = await services.backend.createSession({ nickname: 'Double Tap', characterId: 'kent', pokemonId: 'gengar' });
    const input = { sessionId: v0.state.sessionId, expectedRevision: v0.state.revision, route: 'safe' as const, pushLevel: 1 as const, actionId: 'prep-dup-00001' };
    const a = await services.backend.prepareLeg(input);
    const b = await services.backend.prepareLeg(input);
    expect(b).toEqual(a);
    expect(server.sessions.get(v0.state.sessionId)!.state.revision).toBe(a.state.revision);
  });

  it('STALE_REVISION surfaces as BackendError (not retried); getActiveSession returns canonical state', async () => {
    const server = new FakeSupabaseServer();
    const { services } = await signedInTerminal(server);
    const v0 = await services.backend.createSession({ nickname: 'Stale Tab', characterId: 'enid', pokemonId: 'gengar' });
    await services.backend.prepareLeg({ sessionId: v0.state.sessionId, expectedRevision: v0.state.revision, route: 'safe', pushLevel: 1, actionId: 'prep-ok-000001' });
    const before = server.functionCalls('resolve-leg').length;
    const e = await services.backend.resolveLeg({ sessionId: v0.state.sessionId, expectedRevision: v0.state.revision, eggDecision: 'skip', actionId: 'res-stale-0001' }).catch((x) => x);
    expect(e).toBeInstanceOf(BackendError);
    expect((e as BackendError).code).toBe('STALE_REVISION');
    expect(server.functionCalls('resolve-leg').length - before).toBe(1);
    const canonical = await services.backend.getActiveSession();
    expect(canonical?.state.revision).toBe(v0.state.revision + 1);
    expect(canonical?.state.phase).toBe('awaiting_egg');
  });

  it('engine rejections keep their names: WRONG_PHASE, NO_EGG_TO_COLLECT, INVALID_INPUT; other-station ids -> NOT_FOUND', async () => {
    const server = new FakeSupabaseServer();
    const { services } = await signedInTerminal(server);
    const b = await signedInTerminal(server, 'station_b');
    const v0 = await services.backend.createSession({ nickname: 'Rule Tester', characterId: 'enid', pokemonId: 'gengar' });
    const wrong = await services.backend.resolveLeg({ sessionId: v0.state.sessionId, expectedRevision: v0.state.revision, eggDecision: 'skip', actionId: 'res-wrong-001' }).catch((x) => x);
    expect((wrong as BackendError).code).toBe('WRONG_PHASE');
    // find a route whose offer is none to provoke NO_EGG_TO_COLLECT
    const v1 = await services.backend.prepareLeg({ sessionId: v0.state.sessionId, expectedRevision: v0.state.revision, route: 'safe', pushLevel: 1, actionId: 'prep-egg-0001' });
    if ((v1.leg?.visibleOffers.safe ?? 'none') === 'none') {
      const noEgg = await services.backend.resolveLeg({ sessionId: v1.state.sessionId, expectedRevision: v1.state.revision, eggDecision: 'collect', actionId: 'res-noegg-001' }).catch((x) => x);
      expect((noEgg as BackendError).code).toBe('NO_EGG_TO_COLLECT');
    }
    const bad = await services.backend.createSession({ nickname: '<x>', characterId: 'enid', pokemonId: 'gengar' }).catch((x) => x);
    expect((bad as BackendError).code).toBe('INVALID_INPUT');
    const foreign = await b.services.backend.prepareLeg({ sessionId: v0.state.sessionId, expectedRevision: v1.state.revision, route: 'safe', pushLevel: 1, actionId: 'prep-foreign-1' }).catch((x) => x);
    expect((foreign as BackendError).code).toBe('NOT_FOUND');
  });

  it('abandonSession -> finish-session(player_reset); unknown session -> null; after completion releases the station', async () => {
    const server = new FakeSupabaseServer();
    const { services } = await signedInTerminal(server);
    const v0 = await services.backend.createSession({ nickname: 'Quitter Q', characterId: 'enid', pokemonId: 'gengar' });
    const out = await services.backend.abandonSession(v0.state.sessionId, 'finish-act-001');
    expect(out?.state.status).toBe('abandoned');
    expect(server.functionCalls('finish-session')[0].body).toEqual({ sessionId: v0.state.sessionId, actionId: 'finish-act-001', reason: 'player_reset' });
    expect(server.stationRows.get('station_a')!.notice).toBe('player_reset');
    expect(await services.backend.abandonSession('11111111-2222-4333-8444-555555555555', 'finish-act-002')).toBeNull();

    const { views } = await playRace(services.backend, 'Finisher F', lcg(11));
    const done = views[views.length - 1];
    expect(server.stationRows.get('station_a')!.session_id).toBe(done.state.sessionId);
    await services.backend.abandonSession(done.state.sessionId, 'finish-act-003');
    expect(server.stationRows.get('station_a')!.status).toBe('idle');
    expect(await services.backend.getActiveSession()).toBeNull();
  });

  it('getActiveSession restores the in-progress race after a "reload" (new page, persisted auth)', async () => {
    const server = new FakeSupabaseServer();
    const first = await signedInTerminal(server);
    const v0 = await first.services.backend.createSession({ nickname: 'Reloader', characterId: 'enid', pokemonId: 'gengar' });
    const reloaded = openPage(server, 'station_a', { storage: first.storage });
    expect((await reloaded.services.auth.currentUser())?.stationId).toBe('station_a');
    const view = await reloaded.services.backend.getActiveSession();
    expect(view?.state.sessionId).toBe(v0.state.sessionId);
    expect(server.functionCalls('get-session').at(-1)!.body).toEqual({});
  });

  it('expired access token: the call refreshes once and succeeds', async () => {
    const server = new FakeSupabaseServer();
    const { services } = await signedInTerminal(server);
    server.expireAccessTokens();
    const view = await services.backend.getActiveSession();
    expect(view).toBeNull();
    const calls = server.functionCalls('get-session');
    expect(calls).toHaveLength(2);
    expect(calls[0].authorization).not.toBe(calls[1].authorization);
  });
});

describe('operator reset', () => {
  it('reset while racing: terminal gets reset_by_operator (Realtime notice, confirmed) and later calls fail RESET_BY_OPERATOR', async () => {
    const server = new FakeSupabaseServer();
    const terminal = await signedInTerminal(server);
    const events: unknown[] = [];
    const stop = terminal.services.subscribeStation((e) => events.push(e));
    await settle();
    const v0 = await terminal.services.backend.createSession({ nickname: 'Reset Me', characterId: 'enid', pokemonId: 'gengar' });

    const dashboard = openPage(server, null);
    await dashboard.services.auth.signIn(OPERATOR.email, OPERATOR.password);
    await dashboard.services.operator.resetStation('station_a', 'operator_reset');
    await settle();

    expect(server.functionCalls('admin-reset')[0].body).toMatchObject({ stationId: 'station_a', reason: 'operator_reset' });
    expect(events).toContainEqual({ type: 'reset_by_operator', reason: 'operator_reset' });
    expect(events.filter((e) => (e as { type: string }).type === 'reset_by_operator')).toHaveLength(1);
    expect(server.functionCalls('get-session').some((r) => r.body.sessionId === v0.state.sessionId)).toBe(true); // confirmation

    const e = await terminal.services.backend.prepareLeg({ sessionId: v0.state.sessionId, expectedRevision: v0.state.revision, route: 'safe', pushLevel: 1, actionId: 'prep-after-rst' }).catch((x) => x);
    expect((e as BackendError).code).toBe('RESET_BY_OPERATOR');
    stop();
  });

  it('reset noticed via get-session when Realtime missed it (station notice operator_reset)', async () => {
    const server = new FakeSupabaseServer();
    server.realtime.autoSubscribe = false; // Realtime never connects
    const terminal = await signedInTerminal(server);
    const events: unknown[] = [];
    terminal.services.subscribeStation((e) => events.push(e));
    await terminal.services.backend.createSession({ nickname: 'Offline Olly', characterId: 'enid', pokemonId: 'gengar' });
    const ops = openPage(server, null);
    await ops.services.auth.signIn(OPERATOR.email, OPERATOR.password);
    await ops.services.operator.resetStation('station_a', 'stuck kiosk');
    expect(events.some((e) => (e as { type: string }).type === 'reset_by_operator')).toBe(false);
    expect(await terminal.services.backend.getActiveSession()).toBeNull();
    expect(events).toContainEqual({ type: 'reset_by_operator', reason: 'operator_reset' });
    expect(events[0]).toEqual({ type: 'connection', state: 'connecting' });
  });

  it('a stale operator_reset notice never wipes a race that the server says is still running', async () => {
    const server = new FakeSupabaseServer();
    const terminal = await signedInTerminal(server);
    const events: { type: string }[] = [];
    terminal.services.subscribeStation((e) => events.push(e));
    await settle();
    const v = await terminal.services.backend.createSession({ nickname: 'Still Racing', characterId: 'enid', pokemonId: 'gengar' });
    // forged/stale idle row with a notice, newer timestamp than anything seen
    server.realtime.emit('station_status', 'UPDATE', {
      ...server.stationRows.get('station_a')!, session_id: null, status: 'idle', notice: 'operator_reset', revision: 99, updated_at: '2030-01-01T00:00:00.000Z',
    });
    await settle();
    expect(events.some((e) => e.type === 'reset_by_operator')).toBe(false);
    expect((await terminal.services.backend.getActiveSession())?.state.sessionId).toBe(v.state.sessionId);
  });

  it('resetStation requires an operator sign-in and a valid station; never calls admin-reset otherwise', async () => {
    const server = new FakeSupabaseServer();
    const dashboard = openPage(server, null);
    expect(((await dashboard.services.operator.resetStation('station_a', 'operator_reset').catch((x) => x)) as BackendError).code).toBe('UNAUTHORIZED');
    const terminal = await signedInTerminal(server);
    expect(((await terminal.services.operator.resetStation('station_b', 'operator_reset').catch((x) => x)) as BackendError).code).toBe('UNAUTHORIZED');
    await dashboard.services.auth.signIn(OPERATOR.email, OPERATOR.password);
    expect(((await dashboard.services.operator.resetStation('local', 'clear_demo_data').catch((x) => x)) as BackendError).code).toBe('INVALID_INPUT');
    expect(((await dashboard.services.operator.resetStation('station_a', 'x').catch((x) => x)) as BackendError).code).toBe('INVALID_INPUT');
    expect(server.functionCalls('admin-reset')).toHaveLength(0);
    await dashboard.services.operator.resetStation('station_b', 'operator_reset');
    const [call] = server.functionCalls('admin-reset');
    expect(call.body.actionId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it('dashboard backend refuses race calls', async () => {
    const server = new FakeSupabaseServer();
    const dashboard = openPage(server, null);
    expect(await dashboard.services.backend.getActiveSession()).toBeNull();
    expect(((await dashboard.services.backend.createSession({ nickname: 'Nope Nope', characterId: 'enid', pokemonId: 'gengar' }).catch((x) => x)) as BackendError).code).toBe('UNAUTHORIZED');
  });
});
