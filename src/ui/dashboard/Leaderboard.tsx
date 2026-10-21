// LeaderboardRow (UX_SPEC §4): rank, name over crew (stacked so long names fit the 60% column), eggs, time,
// score, badge. Top 8 rows, 44px each.
import type { ScoreRecord } from '../../game/index.ts';
import { VerifiedBadge } from '../components/Badge.tsx';
import { crewName, fmtS, fmtScore } from '../format.ts';

const ROWS = 8;

export function Leaderboard({ records, fresh }: { records: ScoreRecord[] | null; fresh: Map<string, number> }) {
  if (!records) return <p className="text-2 dash-empty">Loading the board…</p>;
  if (records.length === 0) return <p className="display dash-empty dash-empty--italic">No finished races yet. Hyde is waiting.</p>;
  return (
    <table className="lb" data-testid="leaderboard">
      <thead>
        <tr>
          <th scope="col">#</th><th scope="col">Racer · crew</th>
          <th scope="col" className="num-col">Eggs</th><th scope="col" className="num-col">Time</th>
          <th scope="col" className="num-col">Score</th><th scope="col"><span className="sr-only">Status</span></th>
        </tr>
      </thead>
      <tbody>
        {records.slice(0, ROWS).map((r, i) => (
          <tr key={r.sessionId} className={fresh.has(r.sessionId) ? 'is-new' : undefined}>
            <td className={`lb__rank${i === 0 ? ' lb__rank--first' : ''}`}>
              {i + 1}
              {i === 0 && <span className="lb__first">1st</span>}
            </td>
            <td>
              <span className="lb__name">{r.nickname}</span>
              <span className="lb__crew">{crewName(r.characterId, r.pokemonId)}</span>
            </td>
            <td className="num num-col">{r.finalEggPoints}</td>
            <td className="num num-col">{fmtS(r.totalSimulatedTimeCs)}</td>
            <td className="num num-col lb__score">{fmtScore(r.finalScore)}</td>
            <td className="lb__badges">
              {fresh.has(r.sessionId) && <span className="badge badge--new">New</span>}
              <VerifiedBadge verified={r.verified} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
