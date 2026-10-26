// mystery-v3.1 LIVE board (Laptop 1) against the in-memory fake: anon REST + Realtime station status / results,
// heartbeat liveness ("Signal lost" after 15 s), standings with every finisher above every DNF, operator-only
// event-level analytics rebuilt with eventFromRow, nickname moderation via Realtime DELETE.
import { describe, expect, it, vi } from 'vitest';
import type { StationId } from '../../src/game/index.ts';
import { dashboard } from '../../src/mystery/analytics/index.ts';
import { createLiveController } from '../../src/app/mystery/liveRun.ts';
import type { LiveStatus } from '../../src/app/mystery/records.ts';
import type { MysteryBoardSnapshot } from '../../src/lib/supabase/mysteryDashboardFeed.ts';
import { orderStandings, standingsForCase, type MysteryStandingRow } from '../../src/lib/supabase/mysteryWire.ts';
import type { CaseId } from '../../src/mystery/types.ts';
import {
  ANON_KEY, FakeSupabaseServer, MYSTERY_DNF_CASE, MYSTERY_DNF_SEED, MYSTERY_FINISH_SEED, ManualTimers, OPERATOR, driveRun,
  openMysteryBoard, openMysteryStation, settle, stationCredentials,
} from './fakeSupabase.ts';

vi.setConfig({ testTimeout: 300_000 }); // final sim: bot runs at 60 Hz (fakeSupabase.ts MYSTERY_TEST_TIMEOUT_MS)

async function kiosk(server: FakeSupabaseServer, stationId: StationId) {
  const page = openMysteryStation(server, stationId);
  const { email, password } = stationCredentials(stationId);
  await page.services.auth.signIn(email, password);
  const timers = new ManualTimers();
  const controller = createLiveController({ services: page.services, storage: page.storage, stationName: stationId, timers, finalizeGraceMs: 10 });
  return { page, timers, controller };
}

const status = (stationId: string, phase: LiveStatus['phase']): LiveStatus => ({
  stationId, phase, nickname: 'x', duo: null, clues: 0, egg: null, hp: 100, catches: 0, hydeMode: null, risk: null, advice: null,
  activeTimeS: null, updatedAt: 0,
});

async function play(
  server: FakeSupabaseServer, k: Awaited<ReturnType<typeof kiosk>>, stationId: StationId, seed: string, nickname: string,
  profile: 'stealthy' | 'careless', caseId?: CaseId,
) {
  server.nextMysterySeeds.push(seed);
  if (caseId) server.nextMysteryCases.push(caseId);
  const offered = await k.controller.createSession(nickname);
  const chosen = await k.controller.selectDuo(offered.offer.cards[0]!);
  const { run } = await driveRun(k.controller, chosen, { stationId, timers: k.timers, profile });
  const final = await k.controller.finalizing()!;
  return { run, final, sessionId: chosen.sessionId };
}

describe('mystery live board', () => {
  it('shows both stations live, verified standings (finisher above DNF) and analytics from server rows', async () => {
    const server = new FakeSupabaseServer();
    const board = openMysteryBoard(server);
    const snaps: MysteryBoardSnapshot[] = [];
    const stop = board.services.feed.subscribe((s) => snaps.push(s));
    await settle();
    expect(snaps.at(-1)!.loaded).toBe(true);
    expect(snaps.at(-1)!.stations.map((s) => s.row?.status)).toEqual(['idle', 'idle', 'idle']);

    const a = await kiosk(server, 'station_a');
    const b = await kiosk(server, 'station_b');
    // Heartbeats (Realtime broadcast) mark both terminals live.
    a.controller.menuStatus(status('station_a', 'name'));
    b.controller.menuStatus(status('station_b', 'name'));
    await settle();
    let last = snaps.at(-1)!;
    expect(last.stations.map((s) => [s.heartbeat?.phase, s.signalLost])).toEqual([['name', false], ['name', false], [undefined, false]]); // station_c idle

    const dnf = await play(server, b, 'station_b', MYSTERY_DNF_SEED, 'Bravo Bo', 'careless', MYSTERY_DNF_CASE);
    const fin = await play(server, a, 'station_a', MYSTERY_FINISH_SEED, 'Alpha Al', 'stealthy', 'crypt_last_witness');
    expect(dnf.run.status).toBe('dnf');
    expect(fin.run.status).toBe('finished');
    expect(dnf.final.kind).toBe('verified');
    expect(fin.final.kind).toBe('verified');
    await new Promise((r) => setTimeout(r, 350)); // standings refetch after the Realtime results inserts
    await settle();

    last = snaps.at(-1)!;
    // Live station status rows (server-written) for both stations.
    const byId = Object.fromEntries(last.stations.map((s) => [s.stationId, s]));
    expect(byId.station_a!.row).toMatchObject({ status: 'finished', nickname: 'Alpha Al', case_id: 'crypt_last_witness' });
    expect(byId.station_b!.row).toMatchObject({ status: 'dnf', nickname: 'Bravo Bo', case_id: MYSTERY_DNF_CASE });
    // Standings: the finisher (ranked) above the DNF (unranked), even though the DNF finalized first.
    expect(last.standings.map((r) => [r.nickname, r.outcome, r.rank])).toEqual([['Alpha Al', 'finished', 1], ['Bravo Bo', 'dnf', null]]);
    // Per case: each run is on its own case board (case_id on every standings row).
    expect(last.standings.map((r) => r.case_id)).toEqual(['crypt_last_witness', MYSTERY_DNF_CASE]);
    expect(last.standingsByCase.crypt_last_witness.map((r) => [r.nickname, r.rank])).toEqual([['Alpha Al', 1]]);
    expect(last.standingsByCase[MYSTERY_DNF_CASE].map((r) => [r.nickname, r.rank])).toEqual([['Bravo Bo', null]]);
    expect(last.standingsByCase.midnight_signal).toEqual([]);
    // Public rows never carry who was accused or the cited evidence (column privileges; Realtime drops them too).
    const publicJson = JSON.stringify(last);
    expect(publicJson).not.toMatch(/"accused"|"evidence"|"client_claim"|"culprit"/);
    const inserts = server.realtime.log.filter((e) => e.table === 'mystery_results' && e.eventType === 'INSERT');
    expect(inserts).toHaveLength(2);
    for (const e of inserts) for (const k of ['accused', 'evidence', 'client_claim']) expect(e.row).not.toHaveProperty(k);
    expect(last.records.map((r) => r.caseId).sort()).toEqual(['crypt_last_witness', MYSTERY_DNF_CASE].sort());
    // Anonymous board: results-level records only (RLS hides events / offers / advice).
    expect(last.detailed).toBe(false);
    expect(last.records).toHaveLength(2);
    expect(last.records.every((r) => r.events.length === 0)).toBe(true);
    const anon = dashboard(last.records);
    expect(anon.descriptive.finished).toBe(1);
    expect(anon.descriptive.dnf).toBe(1);

    // Operator signs in on Laptop 1 → event-level analytics rebuilt from mystery_events rows (eventFromRow).
    await board.services.auth.signIn(OPERATOR.email, OPERATOR.password);
    await board.services.feed.refresh();
    await settle();
    last = snaps.at(-1)!;
    expect(last.detailed).toBe(true);
    const finRec = last.records.find((r) => r.sessionId === fin.sessionId)!;
    expect(finRec.events.length).toBeGreaterThan(10);
    expect(finRec.events.some((e) => e.type === 'clue_found')).toBe(true);
    expect(finRec.offered).toHaveLength(3);
    const full = dashboard(last.records);
    expect(full.descriptive.pickRate.characters.some((p) => p.offered > 0)).toBe(true);
    expect(full.descriptive.stanceMix.walk + full.descriptive.stanceMix.crouch + full.descriptive.stanceMix.sprint).toBeGreaterThan(0);

    // No heartbeat for > 15 s → "Signal lost".
    board.clock.now += 16_000;
    a.controller.menuStatus(status('station_a', 'idle')); // station A keeps beating
    await settle();
    last = snaps.at(-1)!;
    expect(last.stations.find((s) => s.stationId === 'station_a')!.signalLost).toBe(false);
    expect(last.stations.find((s) => s.stationId === 'station_b')!.signalLost).toBe(true);

    // Nickname moderation: a deleted result leaves the board immediately.
    server.moderateMysteryDelete(fin.sessionId);
    await settle();
    expect(snaps.at(-1)!.standings.map((r) => r.nickname)).toEqual(['Bravo Bo']);

    // The board never receives a seed.
    expect(JSON.stringify(snaps.at(-1))).not.toContain(MYSTERY_FINISH_SEED);
    stop();
    a.controller.dispose();
    b.controller.dispose();
  }, 300_000);

  it('anon / station REST can never select accused, evidence or client_claim; operators read them via mystery_result_audit', async () => {
    const server = new FakeSupabaseServer();
    const k = await kiosk(server, 'station_a');
    const played = await play(server, k, 'station_a', MYSTERY_FINISH_SEED, 'Secret Sue', 'stealthy');
    expect(played.final.kind).toBe('verified');
    const rest = (path: string, token = ANON_KEY) => server.fetch(`${server.origin}/rest/v1/${path}`, {
      headers: { apikey: ANON_KEY, authorization: `Bearer ${token}` },
    });
    for (const col of ['accused', 'evidence', 'client_claim', '*']) {
      const res = await rest(`mystery_results?select=session_id,${col}`);
      expect(res.ok, `anon select ${col}`).toBe(false);
      expect((await res.json()).code).toBe('42501');
    }
    const okRes = await rest('mystery_results?select=session_id,case_id,verdict,correct,deduction_correct');
    expect(await okRes.json()).toEqual([expect.objectContaining({ case_id: played.final.kind === 'verified' ? played.final.response.result.caseId : null })]);
    expect((await rest('mystery_result_audit?select=accused')).ok).toBe(false);
    expect((await rest('mystery_case_bags?select=bag')).ok).toBe(false);
    // a station account: still no secret columns; zero audit rows
    const token = async (email: string, password: string) => (await (await server.fetch(`${server.origin}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
    })).json() as { access_token: string }).access_token;
    const station = await token(stationCredentials('station_a').email, stationCredentials('station_a').password);
    expect((await rest('mystery_results?select=session_id,accused', station)).ok).toBe(false);
    expect(await (await rest('mystery_result_audit?select=session_id,accused', station)).json()).toEqual([]);
    // the operator reads the audit view (accused + sanitized evidence)
    const op = await token(OPERATOR.email, OPERATOR.password);
    const audit = await (await rest('mystery_result_audit?select=session_id,accused,evidence', op)).json() as { session_id: string; accused: string; evidence: string[] }[];
    expect(audit).toEqual([expect.objectContaining({ session_id: played.sessionId })]);
    expect(audit[0]!.evidence).toHaveLength(3);
    expect(typeof audit[0]!.accused).toBe('string');
    k.controller.dispose();
  }, 300_000);

  it('drops forged heartbeats (wrong shape / unknown station / free text) and never shows their text', async () => {
    const server = new FakeSupabaseServer();
    const board = openMysteryBoard(server);
    const snaps: MysteryBoardSnapshot[] = [];
    const stop = board.services.feed.subscribe((s) => snaps.push(s));
    await settle();
    const rogue = server.realtime.channel('raven-mystery-live');
    rogue.subscribe(() => undefined);
    await settle();
    await rogue.send({ type: 'broadcast', event: 'status', payload: { v: 1, stationId: 'station_z', phase: 'idle' } });
    await rogue.send({ type: 'broadcast', event: 'status', payload: { v: 1, stationId: 'station_a', phase: 'hacked' } });
    await rogue.send({ type: 'broadcast', event: 'status', payload: { v: 1, stationId: 'station_a', phase: 'investigating', nickname: '<b>rude</b>', hp: 9999 } });
    await settle();
    const a = snaps.at(-1)!.stations.find((s) => s.stationId === 'station_a')!;
    expect(a.heartbeat?.phase).toBe('investigating');
    expect(a.heartbeat?.hp).toBe(100); // clamped
    expect(JSON.stringify(a.heartbeat)).not.toContain('rude');
    stop();
  });

  it('operator reset from the board uses admin-reset (scope all) and clears the station row', async () => {
    const server = new FakeSupabaseServer();
    const k = await kiosk(server, 'station_a');
    server.nextMysterySeeds.push(MYSTERY_FINISH_SEED);
    const s = await k.controller.createSession('Stuck Sam');
    const board = openMysteryBoard(server);
    await expect(board.services.operator.resetStation('station_a', 'Stuck terminal')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await board.services.auth.signIn(OPERATOR.email, OPERATOR.password);
    await board.services.operator.resetStation('station_a', 'Stuck terminal');
    expect(server.mysterySessions.get(s.sessionId)!.abandoned_reason).toBe('operator_reset');
    expect(server.mysteryStationRows.get('station_a')).toMatchObject({ status: 'idle', notice: 'operator_reset' });
    expect(server.functionCalls('admin-reset')[0]!.body).toMatchObject({ stationId: 'station_a', scope: 'all' });
    k.controller.dispose();
  });
});

describe('standings order (pure, same as the SQL view)', () => {
  it('every finisher — negative scores included — ranks above every DNF; DNFs longest survival first, unranked', () => {
    const row = (id: string, outcome: 'finished' | 'dnf', score: number | null, t: number, at: string, caseId: CaseId = 'poisoned_archive'): MysteryStandingRow => ({
      standing_group: outcome === 'finished' ? 0 : 1, rank: null, case_rank: null, session_id: id, nickname: id, station_id: 'station_a',
      case_id: caseId, case_version: 1, character_id: 'enid', pokemon_id: 'gengar', outcome, dnf_reason: outcome === 'dnf' ? 'second_catch' : null,
      score: score === null ? null : score.toFixed(1), active_time_s: t.toFixed(1), verdict: 'not_accused', correct: false,
      deduction_correct: false, clue_count: 0, catches: 0, finalized_at: at,
    });
    const out = orderStandings([
      row('dnf-long', 'dnf', null, 300, '2026-10-31T18:00:01Z'),
      row('neg', 'finished', -40.5, 140.5, '2026-10-31T18:00:02Z'),
      row('top', 'finished', 450, 150, '2026-10-31T18:00:03Z'),
      row('dnf-short', 'dnf', null, 30, '2026-10-31T18:00:04Z'),
      row('tie-late', 'finished', 450, 150, '2026-10-31T18:00:09Z'),
    ]);
    expect(out.map((r) => [r.session_id, r.rank])).toEqual([
      ['top', 1], ['tie-late', 2], ['neg', 3], ['dnf-long', null], ['dnf-short', null],
    ]);
  });
  it('per-case standings: case_rank within the case, combined rank across cases', () => {
    const row = (id: string, caseId: CaseId, score: number, at: string): MysteryStandingRow => ({
      standing_group: 0, rank: null, case_rank: null, session_id: id, nickname: id, station_id: 'station_a', case_id: caseId,
      case_version: 1, character_id: 'enid', pokemon_id: 'gengar', outcome: 'finished', dnf_reason: null, score: score.toFixed(1),
      active_time_s: '100.0', verdict: 'case_solved', correct: true, deduction_correct: true, clue_count: 3, catches: 0, finalized_at: at,
    });
    const rows = [row('a1', 'poisoned_archive', 500, '2026-10-31T18:00:01Z'), row('b1', 'midnight_signal', 450, '2026-10-31T18:00:02Z'),
      row('a2', 'poisoned_archive', 300, '2026-10-31T18:00:03Z'), row('b2', 'midnight_signal', 100, '2026-10-31T18:00:04Z')];
    expect(orderStandings(rows).map((r) => [r.session_id, r.rank, r.case_rank])).toEqual([
      ['a1', 1, 1], ['b1', 2, 1], ['a2', 3, 2], ['b2', 4, 2],
    ]);
    expect(standingsForCase(rows, 'midnight_signal').map((r) => [r.session_id, r.rank])).toEqual([['b1', 1], ['b2', 2]]);
    expect(standingsForCase(rows, 'crypt_last_witness')).toEqual([]);
  });
});
