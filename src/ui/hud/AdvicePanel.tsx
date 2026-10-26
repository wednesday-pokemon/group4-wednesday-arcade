// Wednesday's Strategic Advice (UX_SPEC AdvicePanel). Never blocks play: loading skeleton, error fallback.
import type { Advice } from '../../game/index.ts';
import { Button } from '../components/Button.tsx';
import { Icon } from '../Icon.tsx';
import { fmtPct } from '../format.ts';

export type AdviceStatus = { kind: 'loading' } | { kind: 'ready'; advice: Advice } | { kind: 'error' };

const MAX_REASONS = 3;
const MAX_REASONS_WITH_WARNING = 2;

export function recommendedRisk(advice: Advice): number | null {
  const rec = advice.recommended;
  if (!rec) return null;
  const match = advice.candidates.find((c) => c.route === rec.route && c.pushLevel === rec.pushLevel);
  return match ? match.pDnf : null;
}

interface AdvicePanelProps {
  status: AdviceStatus;
  /** Route advice shows "Use advice (A)"; egg advice is a single line elsewhere. */
  onUse?: () => void;
  compact?: boolean;
}

export function AdvicePanel({ status, onUse, compact }: AdvicePanelProps) {
  return (
    <section className={`panel advice${compact ? ' advice--compact' : ''}`} aria-labelledby="advice-title" data-testid="advice-panel">
      <h2 id="advice-title" className="caps advice__title">
        <Icon name="ghost" />
        Wednesday’s strategic advice
      </h2>
      {status.kind === 'loading' && <AdviceLoading />}
      {status.kind === 'error' && <p className="text-2">Advice unavailable. You can still race.</p>}
      {status.kind === 'ready' && <AdviceBody advice={status.advice} onUse={onUse} />}
    </section>
  );
}

function AdviceLoading() {
  return (
    <div className="advice__loading" aria-busy="true">
      <p className="text-2">Wednesday is thinking… simulating 512 races per option</p>
      <span className="skeleton" />
      <span className="skeleton skeleton--short" />
      <span className="skeleton" />
    </div>
  );
}

function AdviceBody({ advice, onUse }: { advice: Advice; onUse?: () => void }) {
  const risk = recommendedRisk(advice);
  const overCap = risk !== null && risk > advice.riskCap;
  const rec = advice.recommended;
  const hasWarning = Boolean(advice.warning) || !advice.constraintMet;
  const reasons = advice.reasons.slice(0, hasWarning ? MAX_REASONS_WITH_WARNING : MAX_REASONS);
  return (
    <>
      <div className="advice__rec">
        <p className="advice__headline display" data-testid="advice-headline">
          {rec ? `${rec.route === 'safe' ? 'Safe' : 'Shortcut'} · Push ${rec.pushLevel}` : advice.headline}
        </p>
        {onUse && rec && (
          <Button size="sm" kbd="A" onClick={onUse} data-testid="btn-use-advice">Use this</Button>
        )}
      </div>
      {risk !== null && (
        <div className={`advice__risk${overCap ? ' is-over' : ''}`}>
          <span className="advice__risk-label">Race-ending risk</span>
          <span className="advice__risk-value num">
            {overCap && <Icon name="alert" />}
            {fmtPct(risk)}
          </span>
          <span className="risk-bar" aria-hidden="true">
            <span className="risk-bar__fill" style={{ width: `${Math.min(100, risk * 200)}%` }} />
            <span className="risk-bar__cap" style={{ left: `${advice.riskCap * 200}%` }} />
          </span>
          <span className="advice__cap muted">limit {fmtPct(advice.riskCap)}</span>
        </div>
      )}
      <ul className="advice__reasons">
        {reasons.map((r) => <li key={r}>{r}</li>)}
      </ul>
      {hasWarning && (
        <p className="advice__warning" data-testid="advice-warning">
          <Icon name="alert" />
          <span>{advice.warning ?? 'Every option is above the risk limit.'}</span>
        </p>
      )}
      <p className="advice__foot muted">
        {advice.method === 'monte_carlo' ? `Monte Carlo · ${advice.rolloutsPerCandidate} races per option` : 'Rule-based estimate'}
      </p>
    </>
  );
}
