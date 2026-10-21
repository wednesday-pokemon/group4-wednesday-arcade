// Chooses LOCAL DEMO or LIVE services. Live mode requires Supabase browser config (URL + anon key);
// without it the app runs the clearly-badged LOCAL DEMO.
import type { StationId } from '../game/index.ts';
import type { AppServices, StationEvent } from './backend.ts';
import { LocalBackend } from './local/localBackend.ts';
import { clearDemoData, createDemoDashboardFeed, readDemoData, updateDemoData } from './local/demoStore.ts';

export function isLiveConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

export function createLocalServices(): AppServices {
  const listeners = new Set<(e: StationEvent) => void>();
  return {
    mode: 'local_demo',
    backend: new LocalBackend(),
    dashboard: createDemoDashboardFeed(),
    auth: null,
    operator: {
      async resetStation(_stationId, reason) {
        const active = readDemoData().station;
        if (active?.status === 'in_progress') {
          updateDemoData((d) => ({ ...d, station: d.station ? { ...d.station, status: 'abandoned', updatedAt: new Date().toISOString() } : null }));
        }
        listeners.forEach((l) => l({ type: 'reset_by_operator', reason }));
        if (reason === 'clear_demo_data') clearDemoData();
      },
    },
    subscribeStation(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** `forceLocal` is the visitor-facing "Play LOCAL DEMO" choice offered when live mode is unreachable. */
export async function createServices(stationId: StationId | null, forceLocal = false): Promise<AppServices> {
  if (forceLocal || !isLiveConfigured()) return createLocalServices();
  const { createLiveServices } = await import('./supabase/liveServices.ts');
  return createLiveServices(stationId);
}
