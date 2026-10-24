// Overhaul live analytics end to end against the in-memory fake: a verified kiosk run streams the new forecast targets
// (egg_site, clue_area, hyde_spawn, hyde_zone, extraction, detection_15s) into mystery_forecasts through the REAL append
// validator, and its ~2 s heartbeat carries the live numbers Laptop 1 renders (objective, chases, extraction, top egg
// site, Hyde zone, newest Thing item as a code) — tokens only, never free text.
import { describe, expect, it, vi } from 'vitest';
import type { StationId } from '../../src/game/index.ts';
import { createLiveController } from '../../src/app/mystery/liveRun.ts';
import { liveStationView } from '../../src/app/mystery/liveDashboard.tsx';
import type { LiveStatus } from '../../src/app/mystery/records.ts';
import type { MysteryBoardSnapshot } from '../../src/lib/supabase/mysteryDashboardFeed.ts';
import type { MysteryRun } from '../../src/mystery/run.ts';
import {
  FakeSupabaseServer, MYSTERY_FINISH_SEED, ManualTimers, driveRun, openMysteryBoard, openMysteryStation, settle, stationCredentials,
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

/** The app's ~1 Hz station status (useMysteryLoop.liveStatus) for a running visit. */
function statusOf(run: MysteryRun): LiveStatus {
  return {
    stationId: 'station_a', phase: run.egg.state === 'carried' ? 'carrying' : 'investigating', nickname: 'Alpha Al', duo: run.duo, caseId: run.caseDef.id,
    clues: run.cluesFound.length, egg: { state: run.egg.state, tier: null, security: Math.round(run.egg.security) }, hp: Math.round(run.player.hp),
    catches: run.player.catches, hydeMode: run.hyde.mode, risk: null, advice: null, activeTimeS: Math.round(run.t * 10) / 10, updatedAt: 0,
  };
}

describe('overhaul live analytics through Supabase (fake)', () => {
  it('stores the new forecast targets and streams heartbeat analytics the board renders', async () => {
    const server = new FakeSupabaseServer();
    const board = openMysteryBoard(server);
    const snaps: MysteryBoardSnapshot[] = [];
    const stop = board.services.feed.subscribe((s) => snaps.push(s));
    await settle();
    const k = await kiosk(server, 'station_a');
    server.nextMysterySeeds.push(MYSTERY_FINISH_SEED);
    server.nextMysteryCases.push('midnight_signal');
    const offered = await k.controller.createSession('Alpha Al');
    const chosen = await k.controller.selectDuo(offered.offer.cards[0]!);
    const beats: NonNullable<MysteryBoardSnapshot['stations'][number]['heartbeat']>[] = [];
    const { run } = await driveRun(k.controller, chosen, {
      stationId: 'station_a', timers: k.timers, profile: 'stealthy',
      onChunk: async (r) => {
        k.controller.hooks.status(statusOf(r));
        k.timers.advance(2000); // heartbeat interval
        await settle(4);
        const b = snaps.at(-1)?.stations.find((s) => s.stationId === 'station_a')?.heartbeat;
        if (b) beats.push(b);
      },
    });
    const final = await k.controller.finalizing()!;
    expect(run.status).toBe('finished');
    expect(final.kind).toBe('verified');

    // forecasts of every overhaul target reached mystery_forecasts (best-effort analytics: none dropped)
    const stored = [...(server.mysteryForecasts.get(chosen.sessionId)?.values() ?? [])] as { target: string; value: number; features: Record<string, unknown> }[];
    const targets = new Set(stored.map((f) => f.target));
    for (const t of ['egg_site', 'clue_area', 'hyde_spawn', 'hyde_zone', 'extraction', 'detection_15s']) expect(targets.has(t), t).toBe(true);
    for (const f of stored) {
      expect(f.value).toBeGreaterThanOrEqual(0);
      expect(f.value).toBeLessThanOrEqual(1);
    }
    expect(stored.find((f) => f.target === 'egg_site')!.features.site).toEqual(expect.any(String));
    expect(stored.find((f) => f.target === 'hyde_zone')!.features.zone).toEqual(expect.any(String));

    // heartbeats carried the live numbers; the board renders them with fixed copy
    const live = beats.filter((b) => b.objective !== null);
    expect(live.length).toBeGreaterThan(3);
    expect(live.some((b) => b.hydeEmerged === true && b.hydeZone !== null)).toBe(true);
    expect(live.some((b) => b.eggSite !== null)).toBe(true);
    expect(live.every((b) => typeof b.extraction === 'number' && (b.extractionSource === 'ml' || b.extractionSource === 'rule_based'))).toBe(true);
    const station = snaps.at(-1)!.stations.find((s) => s.stationId === 'station_a')!;
    const card = liveStationView({ ...station, heartbeat: live.find((b) => b.eggSite !== null)! }, Date.now());
    expect(card.objectiveText).toEqual(expect.any(String));
    expect(card.tower?.pct).toEqual(expect.any(Number));
    // the egg estimate is only ever shown while uncertain; a located egg is never named
    for (const b of live) if (b.eggLocated) expect(b.eggSite).toBeNull();
    // tokens only: no free-text Thing line travels on the broadcast
    for (const b of live) if (b.thing) expect(b.thing.code).toMatch(/^[a-z][a-z0-9_]*$/);
    stop();
    k.controller.dispose();
  }, 300_000);
});
