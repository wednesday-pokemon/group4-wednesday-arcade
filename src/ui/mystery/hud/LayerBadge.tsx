// Analytics v2: the small numbered layer badge (1 Descriptive · 2 Diagnostic · 3 Predictive · 4 Prescriptive) in the
// colour of the matching AnalyticsLegend chip, so every HUD analytics surface says which layer it is.
export type LayerId = 'desc' | 'diag' | 'pred' | 'presc';

export const LAYER_BADGE: Record<LayerId, { n: 1 | 2 | 3 | 4; name: string }> = {
  desc: { n: 1, name: 'Descriptive' },
  diag: { n: 2, name: 'Diagnostic' },
  pred: { n: 3, name: 'Predictive' },
  presc: { n: 4, name: 'Prescriptive' },
};

export function LayerBadge({ layer }: { layer: LayerId }) {
  const b = LAYER_BADGE[layer];
  return (
    <span className={`mhud-layer mhud-layer--${layer}`} data-layer={layer} data-testid={`layer-badge-${layer}`} role="img" aria-label={`Layer ${b.n}: ${b.name}`} title={`${b.n} · ${b.name}`}>
      {b.n}
    </span>
  );
}
