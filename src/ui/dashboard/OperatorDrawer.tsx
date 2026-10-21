// Operator drawer, visually separated from public content. LIVE: AuthGate sign-in with role "operator",
// then Reset Station A/B with confirmation; auto sign-out after 5 min idle. LOCAL DEMO: reset the demo
// station or clear demo data (typed RESET).
import { useEffect, useRef, useState } from 'react';
import type { StationId } from '../../game/index.ts';
import type { AppServices, AuthUser } from '../../lib/backend.ts';
import { stationLabel } from '../../app/routing.ts';
import { Button } from '../components/Button.tsx';
import { ConfirmDialog } from '../components/Modal.tsx';
import { SignInForm } from '../screens/GateScreens.tsx';
import { Icon } from '../Icon.tsx';

const IDLE_SIGN_OUT_MS = 5 * 60_000;
/** Live resets need a 3–200 character human-readable reason (stored in the audit log). */
const LIVE_RESET_REASON = 'Operator reset from dashboard';

type Pending =
  | { kind: 'reset'; stationId: StationId | 'local' }
  | { kind: 'clear' };

export function OperatorDrawer({ services, onClose }: { services: AppServices; onClose: () => void }) {
  const live = services.mode === 'live';
  const [user, setUser] = useState<AuthUser | null | 'checking'>(live ? 'checking' : null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>('button, input')?.focus();
    return () => trigger?.focus?.();
  }, []);

  useEffect(() => {
    if (!live || !services.auth) return;
    services.auth.currentUser().then((u) => setUser(u?.role === 'operator' ? u : null)).catch(() => setUser(null));
  }, [live, services.auth]);

  // Auto sign-out after 5 minutes without operator input.
  useEffect(() => {
    if (!live || !user || user === 'checking') return;
    let timer = setTimeout(signOut, IDLE_SIGN_OUT_MS);
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(signOut, IDLE_SIGN_OUT_MS);
    };
    window.addEventListener('pointerdown', bump);
    window.addEventListener('keydown', bump);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', bump);
      window.removeEventListener('keydown', bump);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, user]);

  async function signIn(email: string, password: string) {
    const u = await services.auth!.signIn(email, password);
    if (u.role !== 'operator') {
      await services.auth!.signOut();
      throw new Error('This account is not an operator account.');
    }
    setUser(u);
  }

  async function signOut() {
    await services.auth?.signOut().catch(() => undefined);
    setUser(null);
  }

  async function run(p: Pending) {
    setPending(null);
    setStatus('Working…');
    try {
      if (p.kind === 'clear') await services.operator.resetStation('local', 'clear_demo_data');
      else await services.operator.resetStation(p.stationId, live ? LIVE_RESET_REASON : 'operator_reset');
      setStatus(p.kind === 'clear' ? 'Demo data cleared.' : `${stationLabel(p.stationId)} reset.`);
    } catch (err) {
      setStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const signedIn = !live || (user !== null && user !== 'checking');

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside ref={panelRef} className="panel drawer" role="dialog" aria-label="Operator controls" data-testid="operator-drawer">
        <header className="drawer__head">
          <h2 className="display drawer__title"><Icon name="lock" />Operator</h2>
          <Button variant="ghost" size="sm" icon="close" onClick={onClose} data-testid="btn-close-drawer">Close</Button>
        </header>
        {live && user === 'checking' && <p className="text-2">Checking sign-in…</p>}
        {live && user === null && (
          <SignInForm heading="Operator sign-in" hint="Operator role required. Every action is checked by the server." onSignIn={signIn} testId="operator-signin" />
        )}
        {signedIn && (
          <div className="drawer__actions">
            {live ? (
              <>
                <Button variant="danger" icon="reset" onClick={() => setPending({ kind: 'reset', stationId: 'station_a' })} data-testid="btn-reset-a">Reset Station A</Button>
                <Button variant="danger" icon="reset" onClick={() => setPending({ kind: 'reset', stationId: 'station_b' })} data-testid="btn-reset-b">Reset Station B</Button>
              </>
            ) : (
              <>
                <p className="caps">Local demo controls</p>
                <Button variant="danger" icon="reset" onClick={() => setPending({ kind: 'reset', stationId: 'local' })} data-testid="btn-reset-demo">Reset demo station</Button>
                <Button variant="secondary" icon="trash" onClick={() => setPending({ kind: 'clear' })} data-testid="btn-clear-demo">Clear demo data</Button>
              </>
            )}
            {status && <p className="text-2" role="status">{status}</p>}
            {live && <Button variant="ghost" icon="logOut" onClick={() => void signOut()}>Sign out</Button>}
          </div>
        )}
      </aside>
      {pending?.kind === 'reset' && (
        <ConfirmDialog
          title={`Reset ${stationLabel(pending.stationId)}?`}
          description="The visitor’s race ends now and is marked unranked."
          confirmLabel={`Reset ${stationLabel(pending.stationId)}`}
          cancelLabel="Keep playing"
          destructive
          onCancel={() => setPending(null)}
          onConfirm={() => void run(pending)}
          testId="dialog-reset"
        />
      )}
      {pending?.kind === 'clear' && (
        <ConfirmDialog
          title="Clear all demo data?"
          description="Removes every LOCAL DEMO score, the station state and telemetry in this browser."
          confirmLabel="Clear demo data"
          cancelLabel="Keep data"
          destructive
          typeToConfirm="RESET"
          onCancel={() => setPending(null)}
          onConfirm={() => void run(pending)}
          testId="dialog-clear"
        />
      )}
    </>
  );
}
