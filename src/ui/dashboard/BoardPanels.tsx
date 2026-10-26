// Dashboard bottom row: recent finishes, the separate "out of the race" log, and today's analytics.
import type { ScoreRecord } from '../../game/index.ts';
import type { LegStats, SessionSummary } from '../../analytics/descriptive.ts';
import { Icon } from '../Icon.tsx';
import { fmtScore } from '../format.ts';
import { formatAge } from './StationCard.tsx';

const ITEMS = 4;

export function RecentFinishes({ records, now }: { records: ScoreRecord[]; now: number }) {
  const recent = [...records].sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, ITEMS);
  return (
    <section className="panel dash-mini" aria-labelledby="recent-title" data-testid="recent-finishes">
      <h2 id="recent-title" className="caps dash-section-title"><Icon name="flag" />Recent finishes</h2>
      {recent.length === 0 ? <p className="text-2">No finishes yet.</p> : (
        <ul className="dash-list">
          {recent.map((r) => (
            <li key={r.sessionId}>
              <span className="dash-list__name">{r.nickname}</span>
              <span className="num lantern">{fmtScore(r.finalScore)}</span>
              <span className="muted">{formatAge(now - Date.parse(r.completedAt))}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function DefeatedLog({ records, now }: { records: ScoreRecord[]; now: number }) {
  return (
    <section className="panel dash-mini" aria-labelledby="defeated-title" data-testid="defeated-log">
      <h2 id="defeated-title" className="caps dash-section-title"><Icon name="ghost" />Out of the race ({records.length})</h2>
      {records.length === 0 ? <p className="text-2">Nobody has fallen to Hyde yet.</p> : (
        <ul className="dash-list">
          {records.slice(0, ITEMS).map((r) => (
            <li key={r.sessionId}>
              <span className="dash-list__name">{r.nickname}</span>
              <span className="text-2">Unranked</span>
              <span className="muted">{formatAge(now - Date.parse(r.completedAt))}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TodayStats({ summary, telemetry }: { summary: SessionSummary; telemetry: LegStats | null }) {
  const safeShare = telemetry?.shortcutShare != null ? 1 - telemetry.shortcutShare : null;
  return (
    <section className="panel dash-mini" aria-labelledby="today-title" data-testid="today-stats">
      <h2 id="today-title" className="caps dash-section-title"><Icon name="timer" />Today</h2>
      <p className="today__runs num">
        {summary.totalSessions} {summary.totalSessions === 1 ? 'run' : 'runs'} · {summary.completed} done · {summary.dnf} out
      </p>
      <dl className="today__grid">
        <div><dt className="muted">Avg score</dt><dd className="num">{summary.averageScore !== null ? fmtScore(summary.averageScore) : '—'}</dd></div>
        <div><dt className="muted">Best</dt><dd className="num lantern">{summary.bestScore !== null ? fmtScore(summary.bestScore) : '—'}</dd></div>
      </dl>
      {safeShare !== null && (
        <div className="route-mix">
          <span className="route-mix__bar" aria-hidden="true">
            <span style={{ width: `${Math.round(safeShare * 100)}%` }} />
          </span>
          <span className="text-2 num">Safe {Math.round(safeShare * 100)}% · Shortcut {Math.round((1 - safeShare) * 100)}%</span>
        </div>
      )}
    </section>
  );
}
