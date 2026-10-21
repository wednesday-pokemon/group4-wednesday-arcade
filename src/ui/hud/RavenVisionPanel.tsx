// Raven Vision (UX_SPEC): predicted leg time + catch chance for the hovered/selected option.
// Always labelled as trained on simulated data; shows the rule-based source when no model is bundled.
import type { LegChoice } from '../../game/index.ts';
import type { LegPrediction } from '../../analytics/ravenVision.ts';
import { Icon } from '../Icon.tsx';
import { fmtPct, fmtSecs } from '../format.ts';

interface RavenVisionProps {
  prediction: LegPrediction | null;
  choice: LegChoice | null;
  label: string;
}

export function RavenVisionPanel({ prediction, choice, label }: RavenVisionProps) {
  return (
    <section className="panel raven" aria-labelledby="raven-title" data-testid="raven-vision">
      <h2 id="raven-title" className="caps raven__title">
        <Icon name="eye" />
        Raven Vision
        <span className="raven__for">{choice ? label : ''}</span>
      </h2>
      {prediction && choice ? (
        <div className="raven__numbers">
          <div>
            <span className="raven__big num" data-testid="raven-time">{fmtSecs(prediction.legTimeS)}</span>
            <span className="caps">leg time</span>
          </div>
          <div>
            <span className="raven__big num" data-testid="raven-catch">{fmtPct(prediction.catchP)}</span>
            <span className="caps">catch chance</span>
          </div>
        </div>
      ) : (
        <p className="text-2 raven__empty">Pick a route to see Raven look ahead.</p>
      )}
      <p className="raven__foot muted">
        {prediction?.source === 'rule_based'
          ? 'Source: rule_based (no trained model loaded). Raven Vision is trained on simulated data. Not a promise.'
          : 'Machine-learning estimate, trained on simulated data, not a promise.'}
      </p>
    </section>
  );
}
