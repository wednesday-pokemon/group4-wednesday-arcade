// Terminal subscribeStation: connection events from the Realtime channel + navigator.onLine.
import { describe, expect, it } from 'vitest';
import type { StationEvent } from '../../src/lib/backend.ts';
import { FakeSupabaseServer, openPage, settle, stationCredentials } from './fakeSupabase.ts';

describe('subscribeStation connection events', () => {
  it('connecting -> connected on SUBSCRIBED; offline on CHANNEL_ERROR and browser offline; back to connected', async () => {
    const server = new FakeSupabaseServer();
    const page = openPage(server, 'station_a');
    await page.services.auth.signIn(stationCredentials('station_a').email, stationCredentials('station_a').password);
    const events: StationEvent[] = [];
    const stop = page.services.subscribeStation((e) => events.push(e));
    await settle();
    expect(events).toEqual([{ type: 'connection', state: 'connecting' }, { type: 'connection', state: 'connected' }]);
    // the channel listens only to this station's row
    const ch = server.realtime.active()[0];
    expect(ch.bindings.map((b) => b.filter)).toEqual([{ event: 'UPDATE', schema: 'public', table: 'station_status', filter: 'station_id=eq.station_a' }]);

    server.realtime.setStatus('CHANNEL_ERROR');
    expect(events.at(-1)).toEqual({ type: 'connection', state: 'offline' });
    const restBefore = server.restRequests.filter((t) => t === 'station_status').length;
    server.realtime.setStatus('SUBSCRIBED');
    await settle();
    expect(events.at(-1)).toEqual({ type: 'connection', state: 'connected' });
    expect(server.restRequests.filter((t) => t === 'station_status').length).toBe(restBefore + 1); // refetch own row

    page.online.set(false);
    expect(events.at(-1)).toEqual({ type: 'connection', state: 'offline' });
    page.online.set(true);
    expect(events.at(-1)).toEqual({ type: 'connection', state: 'connected' });

    // duplicates are not re-emitted
    const n = events.length;
    server.realtime.setStatus('SUBSCRIBED');
    await settle();
    expect(events.length).toBe(n);

    stop();
    expect(server.realtime.active()).toHaveLength(0);
  });

  it('late subscribers get the current state immediately; dashboard pages follow navigator.onLine only', async () => {
    const server = new FakeSupabaseServer();
    const page = openPage(server, 'station_b');
    const first: StationEvent[] = [];
    page.services.subscribeStation((e) => first.push(e));
    await settle();
    const second: StationEvent[] = [];
    page.services.subscribeStation((e) => second.push(e));
    expect(second).toEqual([{ type: 'connection', state: 'connected' }]);
    expect(server.realtime.active()).toHaveLength(1); // shared channel

    const dash = openPage(server, null);
    const dEvents: StationEvent[] = [];
    dash.services.subscribeStation((e) => dEvents.push(e));
    expect(dEvents).toEqual([{ type: 'connection', state: 'connected' }]);
    dash.online.set(false);
    expect(dEvents.at(-1)).toEqual({ type: 'connection', state: 'offline' });
  });
});
