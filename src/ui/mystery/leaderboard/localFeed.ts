// LOCAL DEMO leaderboard feed: this laptop's records (raven.mystery.records, v4 only) re-read every 2 s and on cross-tab
// `storage` events. Unverified by design: the panel says "This laptop only · not verified".
import { browserStorage, loadRecords, RECORDS_KEY } from '../../../app/mystery/records.ts';
import { localBoard, type HomeBoardFeed, type HomeBoardSnapshot } from './model.ts';

const REFRESH_MS = 2000;

type Store = Parameters<typeof loadRecords>[0];

export function createLocalBoardFeed(storage: Store = browserStorage(), refreshMs = REFRESH_MS): HomeBoardFeed {
  return {
    subscribe(listener: (s: HomeBoardSnapshot) => void) {
      let lastKey = '';
      const emit = () => {
        const snap = localBoard(loadRecords(storage));
        // only notify on a real change (keeps the panel's live-update animations meaningful)
        const key = JSON.stringify([snap.top.map((e) => [e.id, e.score, e.rank]), snap.defeats.map((e) => e.id)]);
        if (key === lastKey) return;
        lastKey = key;
        listener(snap);
      };
      emit();
      const id = setInterval(emit, refreshMs);
      const onStorage = (e: StorageEvent) => {
        if (e.key === RECORDS_KEY || e.key === null) emit();
      };
      if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
      return () => {
        clearInterval(id);
        if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
      };
    },
  };
}

/** A placeholder LIVE feed while the station's Supabase leaderboard is not wired: no data, "Reconnecting…". */
export const UNAVAILABLE_LIVE_FEED: HomeBoardFeed = {
  subscribe(listener) {
    listener({ source: 'live', status: 'reconnecting', top: [], defeats: [], updatedAt: Date.now() });
    return () => undefined;
  },
};
