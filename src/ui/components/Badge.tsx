// Status badges (UX_SPEC §4 Badge): icon + caps word, so state never depends on colour alone.
import type { BackendMode, ConnectionState } from '../../lib/backend.ts';
import { Icon } from '../Icon.tsx';

export function ModeBadge({ mode }: { mode: BackendMode }) {
  if (mode === 'live') {
    return (
      <span className="badge badge--live" data-testid="badge-mode">
        <span className="badge__dot" aria-hidden="true" />
        Live
      </span>
    );
  }
  return (
    <span className="badge badge--demo" data-testid="badge-mode">
      Local demo
    </span>
  );
}

export function VerifiedBadge({ verified, label }: { verified: boolean; label?: string }) {
  return verified ? (
    <span className="badge badge--verified">
      <Icon name="shieldCheck" />
      {label ?? 'Verified'}
    </span>
  ) : (
    <span className="badge badge--unverified">
      <Icon name="shieldAlert" />
      {label ?? 'Unverified'}
    </span>
  );
}

const CONNECTION_TEXT: Record<ConnectionState, string> = { connected: 'Connected', connecting: 'Reconnecting', offline: 'Offline' };

export function ConnectionBadge({ state }: { state: ConnectionState }) {
  return (
    <span className={`badge badge--conn-${state}`} data-testid="badge-connection">
      <Icon name={state === 'offline' ? 'wifiOff' : 'wifi'} />
      {CONNECTION_TEXT[state]}
    </span>
  );
}
