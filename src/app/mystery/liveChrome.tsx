// Small LIVE-only overlays for the mystery kiosk (no new stylesheet: existing badge / notice classes + inline layout):
//  * LiveSyncChip     — on the island: "Live", "Offline · saves locally", "Unverified run", "Reset by operator"
//  * LiveResultBanner — on the results: verified (rank) / verifying / "Not verified — not on the leaderboard"
//  * LiveStepNotice   — busy / error line for the create + select steps
import type { CSSProperties, ReactNode } from 'react';
import { Button } from '../../ui/components/Button.tsx';
import { Icon } from '../../ui/Icon.tsx';
import type { LiveFinal, LiveUiState } from './liveContext.ts';

const topCenter: CSSProperties = {
  position: 'fixed', top: '1rem', left: '50%', transform: 'translateX(-50%)', zIndex: 25, pointerEvents: 'none',
  background: 'var(--c-surface-1)', boxShadow: 'var(--shadow-2)',
};

export type ChipKind = 'live' | 'offline' | 'unverified' | 'reset';

/** What the island chip shows for the current sync + connection state. */
export function chipFor(ui: LiveUiState): { kind: ChipKind; text: string } {
  if (ui.sync === 'reset') return { kind: 'reset', text: 'Reset by operator' };
  if (ui.sync === 'unverified' || ui.sync === 'closed') return { kind: 'unverified', text: 'Unverified run' };
  if (ui.sync === 'offline' || ui.connection === 'offline') return { kind: 'offline', text: 'Offline · saves locally' };
  return { kind: 'live', text: 'Live · verified run' };
}

export function LiveSyncChip({ ui }: { ui: LiveUiState }) {
  const chip = chipFor(ui);
  const cls = chip.kind === 'live' ? 'badge badge--live' : chip.kind === 'offline' ? 'badge badge--conn-offline' : 'badge badge--unverified';
  return (
    <span
      className={cls}
      style={topCenter}
      role="status"
      aria-live="polite"
      data-testid="live-sync-chip"
      data-state={chip.kind}
      title={ui.syncReason ?? undefined}
    >
      {chip.kind === 'live' ? <span className="badge__dot" aria-hidden="true" /> : <Icon name={chip.kind === 'offline' ? 'wifiOff' : 'shieldAlert'} />}
      {chip.text}
    </span>
  );
}

const bannerBase: CSSProperties = {
  position: 'fixed', top: '0.75rem', left: '50%', transform: 'translateX(-50%)', zIndex: 35, maxWidth: 'min(40rem, 92vw)',
  display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.55rem 1rem', borderRadius: 'var(--r-md)',
  background: 'var(--c-surface-1)', boxShadow: 'var(--shadow-2)', fontSize: 'var(--fs-sm)',
};

export function bannerText(final: LiveFinal): { state: string; title: string; sub: string | null } {
  switch (final.kind) {
    case 'verified':
      if (final.result.outcome === 'dnf') return { state: 'verified', title: 'Verified · Did not finish', sub: 'Unranked — every finisher ranks above a DNF.' };
      return {
        state: 'verified',
        title: final.rank !== null ? `Verified · Rank #${final.rank} on today’s board` : 'Verified result',
        sub: final.result.claimMatches === false ? 'Showing the server’s recomputed result.' : null,
      };
    case 'verifying':
      return final.offline
        ? { state: 'pending', title: 'Not verified — not on the leaderboard (yet)', sub: 'Offline · saved on this kiosk, retrying when the connection returns.' }
        : { state: 'verifying', title: 'Verifying with the case server…', sub: null };
    case 'unverified':
      return { state: 'unverified', title: 'Not verified — not on the leaderboard', sub: final.reason };
    default:
      return { state: 'none', title: '', sub: null };
  }
}

export function LiveResultBanner({ final }: { final: LiveFinal }) {
  if (final.kind === 'none') return null;
  const t = bannerText(final);
  const border = t.state === 'verified' ? 'var(--c-success)' : t.state === 'verifying' ? 'var(--c-border-strong)' : 'var(--c-warning)';
  return (
    <div style={{ ...bannerBase, border: `1.5px solid ${border}` }} role="status" aria-live="polite" data-testid="live-result-banner" data-state={t.state}>
      <Icon name={t.state === 'verified' ? 'shieldCheck' : t.state === 'verifying' ? 'wifi' : 'shieldAlert'} />
      <span>
        <strong data-testid="live-result-title">{t.title}</strong>
        {t.sub && <span className="text-2" style={{ display: 'block' }}>{t.sub}</span>}
      </span>
    </div>
  );
}

export function LiveStepNotice({ busy, error, onRetry, floating }: { busy: string | null; error: string | null; onRetry?: () => void; floating?: boolean }) {
  if (!busy && !error) return null;
  const style: CSSProperties | undefined = floating
    ? { position: 'fixed', left: '50%', bottom: '1.25rem', transform: 'translateX(-50%)', zIndex: 35, background: 'var(--c-surface-1)' }
    : undefined;
  let body: ReactNode;
  if (busy) body = <span role="status" data-testid="live-step-busy">{busy}</span>;
  else {
    body = (
      <>
        <span role="alert" data-testid="live-step-error">{error}</span>
        {onRetry && <Button variant="secondary" size="sm" icon="reset" onClick={onRetry} data-testid="btn-live-retry">Try again</Button>}
      </>
    );
  }
  return (
    <p className="notice" style={style} data-testid="live-step-notice">
      <Icon name={busy ? 'wifi' : 'wifiOff'} />
      {body}
    </p>
  );
}
