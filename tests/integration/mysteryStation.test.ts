// mystery-v3.1 LIVE station kiosk, end to end against the in-memory contract fake (real supabase-js client, real
// functions transport, real server validation / rules modules, real MysteryRun + Bot + analytics). Offline only.
import { describe, expect, it } from 'vitest';
import type { MysteryAnalytics } from '../../src/mystery/analytics/index.ts';
import type { SupabaseBatch } from '../../src/mystery/analytics/types.ts';
import type { StationId } from '../../src/game/index.ts';
import { BackendError } from '../../src/lib/backend.ts';
import { classifyFailure } from '../../src/lib/supabase/mysteryApi.ts';
import { createLiveController, type LiveController } from '../../src/app/mystery/liveRun.ts';
import { LiveStepError, type LiveSessionData } from '../../src/app/mystery/liveContext.ts';
import { readLiveSession } from '../../src/app/mystery/liveSession.ts';
import { chipFor, bannerText } from '../../src/app/mystery/liveChrome.tsx';
import {
  FakeSupabaseServer, MYSTERY_DNF_SEED as DNF_SEED, MYSTERY_FINISH_SEED as FINISH_SEED, ManualTimers, OPERATOR, driveRun,
  openMysteryBoard, openMysteryStation, settle, stationCredentials, type MysteryStationPage,
} from './fakeSupabase.ts';

async function signedIn(server: FakeSupabaseServer, stationId: StationId = 'station_a', opts: Parameters<typeof openMysteryStation>[2] = {}) {
  const page = openMysteryStation(server, stationId, opts);
  const { email, password } = stationCredentials(stationId);
  await page.services.auth.signIn(email, password);
  return page;
}

function controllerFor(page: MysteryStationPage, timers = new ManualTimers(), ids?: string[]): { controller: LiveController; timers: ManualTimers } {
  let n = 0;
  const controller = createLiveController({
    services: page.services, storage: page.storage, stationName: 'Station A', timers, backoffMs: [1000, 2000, 5000],
    finalizeGraceMs: 50, ...(ids ? { newActionId: () => ids[n++] ?? crypto.randomUUID() } : {}),
  });
  return { controller, timers };
}

async function startVisitor(server: FakeSupabaseServer, page: MysteryStationPage, controller: LiveController, seed: string, nickname = 'Raven Ann') {
  server.nextMysterySeeds.push(seed);
  const offered = await controller.createSession(nickname);
  const chosen = await controller.selectDuo(offered.offer.cards[0]!);
  void page;
  return { offered, chosen };
}

describe('mystery station: create → select → append → finalize', () => {
  it('plays a verified run: server offer, selection, streamed events, server-recomputed result + rank', async () => {
    const server = new FakeSupabaseServer();
    const page = await signedIn(server);
    const { controller, timers } = controllerFor(page);
    await controller.restore();
    const { offered, chosen } = await startVisitor(server, page, controller, FINISH_SEED);

    // The cards are the SERVER's (stored offer), the seed is the server's.
    const stored = server.mysterySessions.get(offered.sessionId)!;
    expect(offered.seed).toBe(stored.seed);
    expect(offered.offer.cards.map((c) => `${c.characterId}+${c.pokemonId}`)).toEqual(server.mysteryOffers.get(offered.sessionId)!.map((c) => `${c.characterId}+${c.pokemonId}`));
    expect(chosen.status).toBe('playing');
    expect(chosen.selected).toEqual({ characterId: offered.offer.cards[0]!.characterId, pokemonId: offered.offer.cards[0]!.pokemonId });

    let sawUploads = false;
    const { run } = await driveRun(controller, chosen, {
      stationId: 'station_a', timers,
      onChunk: () => {
        if (server.functionCalls('mystery-append-events').length > 0) sawUploads = true;
        expect(controller.getUi().sync).toBe('live');
      },
    });
    expect(sawUploads).toBe(true); // streamed DURING play, not only at the end
    expect(run.status).toBe('finished');
    const final = await controller.finalizing()!;
    expect(final.kind).toBe('verified');
    await settle();

    const local = run.result()!;
    const ui = controller.getUi();
    expect(ui.final.kind).toBe('verified');
    if (ui.final.kind !== 'verified') throw new Error('unreachable');
    expect(ui.final.rank).toBe(1);
    expect(ui.final.result.score).toBe(local.score);
    expect(ui.final.result.verdict).toBe(local.verdict);
    expect(ui.final.result.activeTimeS).toBe(local.activeTimeS);
    expect(ui.final.result.claimMatches).toBe(true);
    expect(bannerText(ui.final).title).toBe('Verified · Rank #1 on today’s board');

    // Server state: one immutable result, session finished, every rule event stored.
    const s = server.mysterySessions.get(offered.sessionId)!;
    expect(s.status).toBe('finished');
    expect(server.mysteryResults.size).toBe(1);
    const storedTypes = [...server.mysteryEvents.get(s.id)!.values()].map((e) => e.type);
    for (const t of ['clue_found', 'egg_pickup', 'egg_delivered', 'accusation', 'finish']) expect(storedTypes).toContain(t);
    expect(storedTypes.filter((t) => t === 'clue_found')).toHaveLength(local.cluesFound.length);

    // One request in flight at a time: append bodies are strictly increasing in seq across calls.
    let last = 0;
    for (const call of server.functionCalls('mystery-append-events')) {
      const events = call.body.events as { seq: number }[];
      expect(Object.keys(call.body).every((k) => ['sessionId', 'events', 'forecasts', 'recommendations'].includes(k))).toBe(true);
      if (events.length) {
        expect(events[0]!.seq).toBeGreaterThan(last);
        last = events[events.length - 1]!.seq;
      }
    }
    // The station is never sent in a body (it comes from the JWT).
    for (const r of server.requests) expect(JSON.stringify(r.body)).not.toMatch(/stationId/);
    // Session over: a refresh starts a new visitor.
    expect(readLiveSession(page.storage, 'station_a')).toBeNull();
    controller.dispose();
  }, 60_000);

  it('a DNF run is verified and unranked', async () => {
    const server = new FakeSupabaseServer();
    const page = await signedIn(server);
    const { controller, timers } = controllerFor(page);
    const { chosen } = await startVisitor(server, page, controller, DNF_SEED);
    const { run } = await driveRun(controller, chosen, { stationId: 'station_a', timers, profile: 'careless' });
    expect(run.status).toBe('dnf');
    const final = await controller.finalizing()!;
    expect(final.kind).toBe('verified');
    const ui = controller.getUi();
    if (ui.final.kind !== 'verified') throw new Error('expected verified');
    expect(ui.final.rank).toBeNull();
    expect(ui.final.result.outcome).toBe('dnf');
    expect(ui.final.result.score).toBeNull();
    expect(bannerText(ui.final).title).toBe('Verified · Did not finish');
    controller.dispose();
  }, 60_000);
});

describe('mystery station: refresh / reconnect', () => {
  it('a refresh on the cards restores the SAME server offer (no reroll), via mystery-get-session', async () => {
    const server = new FakeSupabaseServer();
    const page = await signedIn(server);
    const first = controllerFor(page).controller;
    server.nextMysterySeeds.push(FINISH_SEED);
    const offered = await first.createSession('Refresh Rae');
    first.dispose();

    // Reload: a new controller over the same localStorage.
    const second = controllerFor(page).controller;
    const restored = await second.restore();
    expect(restored.kind).toBe('offered');
    if (restored.kind !== 'offered') throw new Error('unreachable');
    expect(restored.session.sessionId).toBe(offered.sessionId);
    expect(restored.session.offer).toEqual(offered.offer);
    expect(server.functionCalls('mystery-create-session')).toHaveLength(1);
    expect(server.functionCalls('mystery-get-session').at(-1)!.body).toEqual({ sessionId: offered.sessionId });
    // Back + the same name again: still the same cards, no new create.
    expect((await second.createSession('Refresh Rae')).sessionId).toBe(offered.sessionId);
    expect(server.functionCalls('mystery-create-session')).toHaveLength(1);
    second.dispose();
  });

  it('the actionId is persisted BEFORE create: a reload after a lost answer replays the same session', async () => {
    const server = new FakeSupabaseServer();
    const page = await signedIn(server, 'station_a', { maxAttempts: 1 });
    const first = controllerFor(page).controller;
    server.faults.push({ fn: 'mystery-create-session', kind: 'network-after' }); // committed, answer lost
    server.nextMysterySeeds.push(FINISH_SEED);
    const err = await first.createSession('Lost Lou').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LiveStepError);
    expect((err as LiveStepError).kind).toBe('network');
    const rec = readLiveSession(page.storage, 'station_a')!;
    expect(rec.sessionId).toBeNull();
    expect(rec.actionId).toBe(server.functionCalls('mystery-create-session')[0]!.body.actionId);
    first.dispose();

    const second = controllerFor(page).controller;
    const restored = await second.restore();
    expect(restored.kind).toBe('offered');
    const calls = server.functionCalls('mystery-create-session');
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body).toEqual(calls[0]!.body); // same actionId + nickname → idempotent replay
    expect(server.mysterySessionsOf('station_a')).toHaveLength(1);
    if (restored.kind === 'offered') expect(restored.session.sessionId).toBe(server.mysterySessionsOf('station_a')[0]!.id);
    second.dispose();
  });

  it('a refresh after selecting (no gameplay stored yet) restores the same duo on the same seed', async () => {
    const server = new FakeSupabaseServer();
    const page = await signedIn(server);
    const first = controllerFor(page).controller;
    const { chosen } = await startVisitor(server, page, first, FINISH_SEED);
    first.dispose();
    const second = controllerFor(page).controller;
    const restored = await second.restore();
    expect(restored.kind).toBe('selected');
    if (restored.kind !== 'selected') throw new Error('unreachable');
    expect(restored.session.selected).toEqual(chosen.selected);
    expect(restored.session.seed).toBe(chosen.seed);
    // Re-selecting the same card is a replay, never a second selection.
    expect((await second.selectDuo(chosen.selected!)).status).toBe('playing');
    second.dispose();
  });

  it('a run cut off by a reload mid-play is reported as interrupted (cannot continue verified)', async () => {
    const server = new FakeSupabaseServer();
    const page = await signedIn(server);
    const { controller, timers } = controllerFor(page);
    const { chosen } = await startVisitor(server, page, controller, FINISH_SEED);
    await driveRun(controller, chosen, { stationId: 'station_a', timers, maxS: 30 }).catch(() => undefined);
    timers.advance(2000);
    await settle();
    controller.dispose();
    const again = controllerFor(page).controller;
    expect((await again.restore()).kind).toBe('interrupted');
    expect(readLiveSession(page.storage, 'station_a')).toBeNull();
    again.dispose();
  }, 60_000);
});

describe('mystery station: upload robustness', () => {
  it('a lost append answer is retried with the SAME body; duplicates are ignored server-side', async () => {
    const server = new FakeSupabaseServer();
    const page = await signedIn(server);
    const { controller, timers } = controllerFor(page);
    const { chosen } = await startVisitor(server, page, controller, FINISH_SEED);
    server.faults.push({ fn: 'mystery-append-events', kind: 'network-after' });
    await driveRun(controller, chosen, { stationId: 'station_a', timers });
    expect((await controller.finalizing()!).kind).toBe('verified');
    const calls = server.functionCalls('mystery-append-events');
    expect(JSON.stringify(calls[1]!.body)).toBe(JSON.stringify(calls[0]!.body)); // byte-identical resend
    const stored = server.mysteryEvents.get(chosen.sessionId)!;
    const sentSeqs = new Set(calls.flatMap((c) => (c.body.events as { seq: number }[]).map((e) => e.seq)));
    expect(stored.size).toBe(sentSeqs.size); // nothing stored twice
    expect(server.mysterySessions.get(chosen.sessionId)!.event_count).toBe(sentSeqs.size);
    controller.dispose();
  }, 60_000);

  it('SEQ_CONFLICT (another tab wrote different events) → get-session, drop ≤ lastSeq, resend the rest', async () => {
    const server = new FakeSupabaseServer();
    const page = await signedIn(server);
    const { controller, timers } = controllerFor(page);
    const { chosen } = await startVisitor(server, page, controller, FINISH_SEED);
    // A rogue second tab of the same station account appends its own events 1..3 first.
    const rogue = await signedIn(server, 'station_a');
    await rogue.services.api.append(chosen.sessionId, {
      events: [1, 2, 3].map((seq) => ({ seq, t: 0, type: 'room_enter', roomId: 'pier' }) as never),
      forecasts: [], recommendations: [],
    });
    await driveRun(controller, chosen, { stationId: 'station_a', timers });
    const final = await controller.finalizing()!;
    const conflicts = server.requests.filter((r) => r.fn === 'mystery-append-events').length;
    expect(conflicts).toBeGreaterThan(1);
    expect(server.functionCalls('mystery-get-session').some((r) => r.body.sessionId === chosen.sessionId)).toBe(true);
    // The kiosk recovered: everything after the server's lastSeq landed and the run was verified.
    expect(final.kind).toBe('verified');
    const s = server.mysterySessions.get(chosen.sessionId)!;
    expect(s.status).toBe('finished');
    expect([...server.mysteryEvents.get(s.id)!.keys()].filter((q) => q <= 3)).toEqual([1, 2, 3]);
    controller.dispose();
  }, 60_000);

  it('EVENT_REJECTED → the run is marked unverified, uploading stops, the local result is labelled "Not verified"', async () => {
    const server = new FakeSupabaseServer();
    const page = await signedIn(server);
    const { controller, timers } = controllerFor(page);
    const { chosen } = await startVisitor(server, page, controller, FINISH_SEED);
    // A drifted sim: the first upload claims an unknown clue.
    let tampered = false;
    const source = (a: MysteryAnalytics): MysteryAnalytics => ({
      pendingBatch() {
        const b = a.pendingBatch();
        if (!b || tampered || b.events.length === 0) return b;
        tampered = true;
        const e = b.events[0]!;
        return { ...b, events: [{ ...e, type: 'clue_found', clueId: 'forged_clue', cluesFound: 1 } as never, ...b.events.slice(1)] } as SupabaseBatch;
      },
      ackBatch: (b: SupabaseBatch) => a.ackBatch(b),
    }) as unknown as MysteryAnalytics;
    let chipDuringPlay = '';
    await driveRun(controller, chosen, {
      stationId: 'station_a', timers, source,
      onChunk: () => {
        chipDuringPlay = chipFor(controller.getUi()).text;
      },
    });
    expect(controller.getUi().sync).toBe('unverified');
    expect(chipDuringPlay).toBe('Unverified run');
    const appends = server.functionCalls('mystery-append-events');
    const rejectedAt = appends.findIndex((c) => (c.body.events as { clueId?: string }[]).some((e) => e.clueId === 'forged_clue'));
    expect(rejectedAt).toBeGreaterThanOrEqual(0);
    expect(appends).toHaveLength(rejectedAt + 1); // nothing was sent after the rejection
    const final = await controller.finalizing()!;
    expect(final.kind).toBe('unverified');
    const ui = controller.getUi();
    expect(ui.final.kind).toBe('unverified');
    expect(bannerText(ui.final).title).toBe('Not verified — not on the leaderboard');
    expect(server.functionCalls('mystery-finalize')).toHaveLength(0);
    expect(server.mysteryResults.size).toBe(0);
    controller.dispose();
  }, 60_000);

  it('offline: keeps playing locally ("Offline · saves locally"), then resyncs on reconnect and verifies', async () => {
    const server = new FakeSupabaseServer();
    const page = await signedIn(server);
    const { controller, timers } = controllerFor(page);
    const { chosen } = await startVisitor(server, page, controller, FINISH_SEED);
    let chunks = 0;
    let offlineCalls = -1;
    let chipOffline = '';
    await driveRun(controller, chosen, {
      stationId: 'station_a', timers,
      onChunk: () => {
        chunks++;
        if (chunks === 5) {
          page.online.set(false);
          offlineCalls = server.functionCalls('mystery-append-events').length;
        }
        if (chunks === 20) {
          chipOffline = chipFor(controller.getUi()).text;
          expect(server.functionCalls('mystery-append-events').length).toBe(offlineCalls); // nothing sent while offline
          page.online.set(true); // reconnect → immediate resync
        }
      },
    });
    expect(chipOffline).toBe('Offline · saves locally');
    expect((await controller.finalizing()!).kind).toBe('verified');
    expect(controller.getUi().sync).toBe('live');
    controller.dispose();
  }, 60_000);

  it('network failures (no answer) back off and retry; the run is verified once the server is reachable', async () => {
    const server = new FakeSupabaseServer();
    const page = await signedIn(server, 'station_a', { maxAttempts: 1 });
    const { controller, timers } = controllerFor(page);
    const { chosen } = await startVisitor(server, page, controller, FINISH_SEED);
    for (let i = 0; i < 3; i++) server.faults.push({ fn: 'mystery-append-events', kind: 'network-before' });
    let sawOffline = false;
    await driveRun(controller, chosen, {
      stationId: 'station_a', timers,
      onChunk: () => {
        if (controller.getUi().sync === 'offline') sawOffline = true;
      },
    });
    expect(sawOffline).toBe(true);
    // finalize waits on backoff timers: let them fire.
    for (let i = 0; i < 10 && controller.getUi().final.kind !== 'verified'; i++) {
      timers.advance(5000);
      await settle();
    }
    expect(controller.getUi().final.kind).toBe('verified');
    controller.dispose();
  }, 60_000);

  it('finalize is idempotent: a second call returns the SAME stored result (replay), one row, one Realtime insert', async () => {
    const server = new FakeSupabaseServer();
    const page = await signedIn(server);
    const { controller, timers } = controllerFor(page);
    const { chosen } = await startVisitor(server, page, controller, FINISH_SEED);
    const { run } = await driveRun(controller, chosen, { stationId: 'station_a', timers });
    const first = await controller.finalizing()!;
    if (first.kind !== 'verified') throw new Error('expected verified');
    const again = await page.services.api.finalize(chosen.sessionId, { ...run.result()!, score: 9999 });
    expect(again).toEqual(first.response);
    expect(server.mysteryResults.size).toBe(1);
    expect(server.realtime.log.filter((e) => e.table === 'mystery_results' && e.eventType === 'INSERT')).toHaveLength(1);
    // A late resend of already-stored events is acknowledged without writing.
    const ack = await page.services.api.append(chosen.sessionId, {
      events: [server.mysteryEvents.get(chosen.sessionId)!.get(1)!].map((r) => ({ ...(r.payload as object), seq: r.seq, t: r.t, type: r.type }) as never),
      forecasts: [], recommendations: [],
    });
    expect(ack.duplicates).toBe(1);
    expect(ack.accepted).toBe(0);
    controller.dispose();
  }, 60_000);
});

describe('mystery station: selection and isolation', () => {
  it('DUO_NOT_OFFERED: a pair that is not one of the three cards is rejected; the UI gets the canonical offer back', async () => {
    const server = new FakeSupabaseServer();
    const page = await signedIn(server);
    const { controller } = controllerFor(page);
    server.nextMysterySeeds.push(FINISH_SEED);
    const offered = await controller.createSession('Picky Pat');
    const offeredKeys = new Set(offered.offer.cards.map((c) => `${c.characterId}+${c.pokemonId}`));
    const cand = ['enid', 'wednesday', 'morticia', 'ajax', 'gomez'].flatMap((ch) => ['gengar', 'aegislash', 'gholdengo', 'drifblim'].map((p) => ({ characterId: ch, pokemonId: p })));
    const notOffered = cand.find((d) => !offeredKeys.has(`${d.characterId}+${d.pokemonId}`))!;

    const raw = await page.services.api.select(offered.sessionId, notOffered as never).catch((e: unknown) => e);
    expect(raw).toBeInstanceOf(BackendError);
    expect(classifyFailure(raw)).toBe('not_offered');

    const err = await controller.selectDuo(notOffered as never).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LiveStepError);
    expect((err as LiveStepError).kind).toBe('not_offered');
    expect((err as LiveStepError).session?.offer).toEqual(offered.offer);
    expect(server.mysterySessions.get(offered.sessionId)!.status).toBe('offered');
    // A real card still works afterwards; a DIFFERENT card after that is ALREADY_SELECTED.
    await controller.selectDuo(offered.offer.cards[1]!);
    const other = await page.services.api.select(offered.sessionId, offered.offer.cards[2]!).catch((e: unknown) => e);
    expect(classifyFailure(other)).toBe('already_selected');
    controller.dispose();
  });

  it('station A can never read or write station B’s session (404 for every call)', async () => {
    const server = new FakeSupabaseServer();
    const a = await signedIn(server, 'station_a');
    const b = await signedIn(server, 'station_b');
    server.nextMysterySeeds.push(FINISH_SEED);
    const { envelope } = await b.services.api.create(crypto.randomUUID(), 'Bravo Bea');
    const idB = envelope.session.sessionId;
    expect(envelope.session.stationId).toBe('station_b');

    const attempts = [
      a.services.api.get(idB),
      a.services.api.select(idB, envelope.offer.cards[0]!),
      a.services.api.append(idB, { events: [{ seq: 1, t: 0, type: 'room_enter', roomId: 'pier' } as never], forecasts: [], recommendations: [] }),
      a.services.api.finalize(idB, null),
    ];
    for (const p of attempts) expect(classifyFailure(await p.catch((e: unknown) => e))).toBe('not_found');
    const s = server.mysterySessions.get(idB)!;
    expect(s.status).toBe('offered');
    expect(s.event_count).toBe(0);
    // Station A's open session is its own; B's create never superseded anything on A.
    expect(await a.services.api.get()).toBeNull();
    // A station-B account cannot sign in on the station-A kiosk at all.
    const wrong = openMysteryStation(server, 'station_a');
    const e = await wrong.services.auth.signIn(stationCredentials('station_b').email, stationCredentials('station_b').password).catch((x: unknown) => x);
    expect((e as BackendError).code).toBe('UNAUTHORIZED');
  });

  it('no function call leaves a signed-out kiosk', async () => {
    const server = new FakeSupabaseServer();
    const page = openMysteryStation(server, 'station_a');
    const { controller } = controllerFor(page);
    const err = await controller.createSession('Nobody').catch((e: unknown) => e);
    expect((err as LiveStepError).kind).toBe('auth');
    expect(server.requests).toHaveLength(0);
    controller.dispose();
  });
});

describe('mystery station: operator reset', () => {
  it('an operator reset during play ends the run on the kiosk (confirmed with get-session), unranked', async () => {
    const server = new FakeSupabaseServer();
    const page = await signedIn(server);
    const { controller, timers } = controllerFor(page);
    const resets: number[] = [];
    controller.onReset(() => resets.push(1));
    const { chosen } = await startVisitor(server, page, controller, FINISH_SEED);
    const board = openMysteryBoard(server);
    await board.services.auth.signIn(OPERATOR.email, OPERATOR.password);
    let resetDone = false;
    await driveRun(controller, chosen, {
      stationId: 'station_a', timers, maxS: 40,
      onChunk: async (run) => {
        if (!resetDone && run.t > 10) {
          resetDone = true;
          await board.services.operator.resetStation('station_a', 'Stuck terminal');
          await settle();
        }
      },
    });
    await settle();
    expect(resets).toHaveLength(1);
    const s = server.mysterySessions.get(chosen.sessionId)!;
    expect(s.status).toBe('abandoned');
    expect(s.abandoned_reason).toBe('operator_reset');
    expect(controller.getUi().sync).toBe('reset');
    expect(readLiveSession(page.storage, 'station_a')).toBeNull();
    const reset = server.functionCalls('admin-reset')[0]!;
    expect(reset.body.scope).toBe('all');
    expect(server.operatorAudit.at(-1)!.sessionIds).toContain(chosen.sessionId);
    // The kiosk's next visitor starts cleanly.
    server.nextMysterySeeds.push(FINISH_SEED);
    expect((await controller.createSession('After Reset')).status).toBe('offered');
    controller.dispose();
  }, 60_000);

  it('a stale reset notice never ends a NEW active session', async () => {
    const server = new FakeSupabaseServer();
    const page = await signedIn(server);
    const { controller } = controllerFor(page);
    const resets: number[] = [];
    controller.onReset(() => resets.push(1));
    const board = openMysteryBoard(server);
    await board.services.auth.signIn(OPERATOR.email, OPERATOR.password);
    await board.services.operator.resetStation('station_a', 'Before the visitor');
    await settle();
    server.nextMysterySeeds.push(FINISH_SEED);
    const fresh: LiveSessionData = await controller.createSession('New Visitor');
    // Replay the old idle+operator_reset row (late / duplicate Realtime delivery).
    const stale = { ...server.mysteryStationRows.get('station_a')!, status: 'idle', session_id: null, notice: 'operator_reset', revision: 999 };
    server.realtime.emit('mystery_station_status', 'UPDATE', stale);
    await settle();
    expect(resets).toHaveLength(0);
    expect(server.mysterySessions.get(fresh.sessionId)!.status).toBe('offered');
    controller.dispose();
  });
});
