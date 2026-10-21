// Live-mode gates: station/operator sign-in (AuthGate) and "live unreachable" with an EXPLICIT
// "Play LOCAL DEMO (unverified)" choice. Live mode never silently falls back.
import { useId, useRef, useState } from 'react';
import { useScreenFocus } from '../../app/keyboard.ts';
import { Button } from '../components/Button.tsx';
import { Icon } from '../Icon.tsx';

interface SignInFormProps {
  heading: string;
  hint: string;
  onSignIn: (email: string, password: string) => Promise<void>;
  testId?: string;
}

export function SignInForm({ heading, hint, onSignIn, testId }: SignInFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorId = useId();
  return (
    <form
      className="signin"
      data-testid={testId}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onSignIn(email.trim(), password);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Sign-in failed');
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="display signin__title">{heading}</h2>
      <p className="text-2">{hint}</p>
      <label className="field">
        <span className="field__label">Email</span>
        <input className="input input--sm" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label className="field">
        <span className="field__label">Password</span>
        <input
          className="input input--sm"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby={error ? errorId : undefined}
          required
        />
      </label>
      <p id={errorId} className="field-error" aria-live="polite">{error && <><Icon name="alert" />{error}</>}</p>
      <Button variant="primary" type="submit" busy={busy} busyLabel="Signing in…" icon="lock">Sign in</Button>
    </form>
  );
}

interface StationGateProps {
  stationName: string;
  problem: string | null;
  onSignIn?: (email: string, password: string) => Promise<void>;
  onRetry?: () => void;
  onLocalDemo: () => void;
  localLabel?: string;
}

/** Shown on a terminal when LIVE is configured but unreachable or not signed in. */
export function StationGate({ stationName, problem, onSignIn, onRetry, onLocalDemo, localLabel }: StationGateProps) {
  const h1 = useRef<HTMLHeadingElement>(null);
  useScreenFocus(h1);
  return (
    <main className="screen screen--left scrim-full" data-testid="screen-gate">
      <header className="topline"><span className="caps">{stationName} · Live mode</span></header>
      <div className="left-col gate">
        <h1 ref={h1} tabIndex={-1} className="display screen-title">Station sign-in</h1>
        {problem && (
          <p className="notice" role="alert"><Icon name="wifiOff" />{problem}</p>
        )}
        {onSignIn && (
          <SignInForm heading="Sign in this station" hint="Staff only. Uses the station account for this laptop." onSignIn={onSignIn} />
        )}
        <div className="button-row">
          {onRetry && <Button variant="secondary" icon="reset" onClick={onRetry} data-testid="btn-gate-retry">Retry live</Button>}
          <Button variant="ghost" onClick={onLocalDemo} data-testid="btn-play-local">{localLabel ?? 'Play LOCAL DEMO (unverified)'}</Button>
        </div>
        <p className="muted gate__note">LOCAL DEMO runs in this browser only. Scores are not verified or shown on the live board.</p>
      </div>
    </main>
  );
}

export function MessageScreen({ title, message }: { title: string; message: string }) {
  const h1 = useRef<HTMLHeadingElement>(null);
  useScreenFocus(h1);
  return (
    <main className="screen screen--left scrim-full" data-testid="screen-message">
      <div className="left-col">
        <h1 ref={h1} tabIndex={-1} className="display screen-title">{title}</h1>
        <p className="text-2">{message}</p>
        <p className="muted">Terminal: <code>?mode=terminal&amp;station=station_a</code> · Board: <code>?mode=dashboard</code></p>
      </div>
    </main>
  );
}
