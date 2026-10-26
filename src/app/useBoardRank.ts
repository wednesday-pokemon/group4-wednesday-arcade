// Rank of a finished session among the leaderboard records the dashboard feed already exposes.
import { useEffect, useState } from 'react';
import type { DashboardFeed } from '../lib/backend.ts';

export function useBoardRank(feed: DashboardFeed, sessionId: string | null, enabled: boolean) {
  const [rank, setRank] = useState<{ rank: number; total: number } | null>(null);
  useEffect(() => {
    setRank(null);
    if (!enabled || !sessionId) return;
    try {
      return feed.subscribe((snapshot) => {
        const index = snapshot.leaderboard.findIndex((r) => r.sessionId === sessionId);
        setRank(index >= 0 ? { rank: index + 1, total: snapshot.leaderboard.length } : null);
      });
    } catch {
      return undefined;
    }
  }, [feed, sessionId, enabled]);
  return rank;
}
