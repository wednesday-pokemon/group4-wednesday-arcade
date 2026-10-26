// AnalyticsLegend (docs/final/UX_FINAL.md §1b): ONE component, four 28 px chips —
// [barChart] WHAT HAPPENED · [link] WHY · [gauge] WHAT'S LIKELY · [signpost] WHAT TO DO — each in its layer colour.
// Shown once for 4 s at the end of onboarding (centred y140, 600×32), always at the top of Pause and in the Tab overlay
// header. Principal Weems is NOT an analytics layer and never appears here.
import { Icon, type IconName } from '../../Icon.tsx';

export const LEGEND_CHIPS: readonly { id: 'desc' | 'diag' | 'pred' | 'presc'; icon: IconName; text: string }[] = [
  { id: 'desc', icon: 'barChart', text: 'WHAT HAPPENED' },
  { id: 'diag', icon: 'link', text: 'WHY' },
  { id: 'pred', icon: 'gauge', text: 'WHAT’S LIKELY' },
  { id: 'presc', icon: 'signpost', text: 'WHAT TO DO' },
];

export function AnalyticsLegend({ variant, className }: { variant: 'onboarding' | 'pause' | 'board'; className?: string }) {
  return (
    <p className={`alegend alegend--${variant}${className ? ` ${className}` : ''}`} data-testid={`analytics-legend-${variant}`} aria-label="The four analytics: 1 what happened, 2 why, 3 what's likely, 4 what to do">
      {LEGEND_CHIPS.map((c, i) => (
        <span key={c.id} className={`alegend__chip alegend__chip--${c.id}`} data-layer={c.id}>
          {/* analytics v2: the same number as the HUD's layer badge (1 LOG · 2 WHY · 3 Odds · 4 ADVICE) */}
          <span className="alegend__n" aria-hidden="true">{i + 1}</span>
          <Icon name={c.icon} />
          {c.text}
        </span>
      ))}
    </p>
  );
}
