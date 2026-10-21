// StationCard (UX_SPEC §4): phase badge, nickname, crew, 3-segment leg progress, compact HP / lead,
// "Updated N s ago"; stale live cards (> 15 s) fade and read "Signal lost".
import type { BackendMode, StationStatus } from '../../lib/backend.ts';
import { stationLabel } from '../../app/routing.ts';
import { hpBand, leadBand } from '../components/StatMeters.tsx';
import { Icon } from '../Icon.tsx';
import { crewName, fmtM, fmtPts, fmtS } from '../format.ts';

const STALE_MS = 15_000;

export function stationsFor(mode: BackendMode, stations: StationStatus[]): StationStatus[] {
  if (mode === 'local_demo') return stations.length ? stations : [idle('local')];
  return (['station_a', 'station_b'] as const).map((id) => stations.find((s) => s.stationId === id) ?? idle(id));
}

function idle(stationId: StationStatus['stationId']): StationStatus {
  return {
    stationId, sessionId: null, nickname: null, characterId: null, pokemonId: null, status: 'idle', legIndex: null, phase: null,
    hp: null, gapM: null, catches: null, bankedEggs: null, simTimeCs: null, revision: 0, updatedAt: new Date(0).toISOString(),
  };
}

function phaseLabel(s: StationStatus): string {
  if (s.status === 'in_progress') return s.phase === 'awaiting_egg' ? 'Egg decision' : 'Choosing route';
  if (s.status === 'completed') return 'Finished';
  if (s.status === 'dnf') return 'Out of race';
  if (s.status === 'abandoned') return 'Reset';
  return 'Idle';
}

export function StationCard({ station: s, live, now }: { station: StationStatus; live: boolean; now: number }) {
  const ageMs = now - Date.parse(s.updatedAt);
  const stale = live && s.status === 'in_progress' && ageMs > STALE_MS;
  const active = s.status !== 'idle' && s.nickname;
  const showRace = active && s.status !== 'abandoned';
  return (
    <article className={`panel station${stale ? ' is-stale' : ''}`} data-testid={`station-${s.stationId}`}>
      <header className="station__head">
        <h2 className="caps">{stationLabel(s.stationId)}</h2>
        <span className={`badge badge--phase badge--phase-${s.status}`}>{stale ? 'Signal lost' : phaseLabel(s)}</span>
      </header>
      {!showRace ? (
        <p className="display station__idle">Waiting for next visitor</p>
      ) : (
        <>
          <p className="station__name">{s.nickname}</p>
          {s.characterId && s.pokemonId && <p className="text-2 station__crew">{crewName(s.characterId, s.pokemonId)}</p>}
          <div className="station__legs" aria-label={`Leg ${s.legIndex ?? 1} of 3`}>
            {[1, 2, 3].map((n) => (
              <span key={n} className={`seg${(s.legIndex ?? 0) > n || s.status === 'completed' ? ' is-done' : (s.legIndex ?? 0) === n ? ' is-current' : ''}`}>L{n}</span>
            ))}
          </div>
          <dl className="station__stats">
            <div className={`stat--${hpBand(s.hp ?? 0).tone}`}><dt><Icon name="heart" />HP</dt><dd className="num">{s.hp ?? '—'}</dd></div>
            <div className={`stat--${leadBand(s.gapM ?? 0).tone}`}><dt><Icon name="lead" />Lead</dt><dd className="num">{s.gapM !== null ? fmtM(s.gapM) : '—'}</dd></div>
            <div><dt><Icon name="ghost" />Catches</dt><dd className="num">{s.catches ?? 0}/2</dd></div>
            <div><dt><Icon name="egg" />Eggs</dt><dd className="num">{fmtPts(s.bankedEggs ?? 0)}</dd></div>
            <div><dt><Icon name="timer" />Time</dt><dd className="num">{fmtS(s.simTimeCs ?? 0)}</dd></div>
          </dl>
        </>
      )}
      <p className="station__foot muted">{active ? `Updated ${formatAge(ageMs)}` : ' '}</p>
    </article>
  );
}

export function formatAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}
