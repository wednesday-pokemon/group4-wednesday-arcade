// Principal Weems (docs/final/UX_FINAL.md §4) — the paid, optional hint guide. Left column only (button 16,108 · 288×36;
// card in the shared 16,152 slot, ClueCard wins). Pale-ice oval portrait (SVG bust: no art exists), Palatino italic
// voice, "PRINCIPAL WEEMS · HINT n OF 3" kicker, "−50 points · n hints used" footer. Never Thing's sigil, never in the
// ThingStack. The button is clickable (pointer-events auto) and mirrors V.
import { useId } from 'react';
import type { WeemsButtonView, WeemsCardView } from '../../../app/mystery/hud/weems.ts';
import { WEEMS_COPY } from '../../../app/mystery/hud/weems.ts';
import { KeyCap } from '../controls.tsx';

export function WeemsPortrait({ size = 56, className }: { size?: number; className?: string }) {
  const gid = useId().replace(/:/g, '');
  const h = Math.round((size * 72) / 56);
  return (
    <svg className={`weems-portrait${className ? ` ${className}` : ''}`} viewBox="0 0 64 82" width={size} height={h} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`wg${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--c-weems)" stopOpacity="0.85" />
          <stop offset="1" stopColor="var(--c-weems)" stopOpacity="0.2" />
        </linearGradient>
      </defs>
      <ellipse cx="32" cy="41" rx="30" ry="39" className="weems-portrait__oval" />
      <g fill={`url(#wg${gid})`}>
        <ellipse cx="32" cy="16" rx="10" ry="8" />
        <circle cx="32" cy="32" r="11" />
        <path d="M8 80c2-16 12-24 24-24s22 8 24 24Z" />
      </g>
    </svg>
  );
}

export function AskWeemsButton({ b, onAsk }: { b: WeemsButtonView; onAsk: () => void }) {
  const r = 11;
  const c = 2 * Math.PI * r;
  return (
    <button
      type="button"
      className={`mhud-weems is-${b.state}`}
      onClick={onAsk}
      disabled={b.disabled}
      aria-disabled={b.state !== 'ready' || undefined}
      aria-label={`${WEEMS_COPY.button}: ${b.sub}`}
      data-testid="hud-ask-weems"
      data-state={b.state}
      tabIndex={-1}
    >
      <WeemsPortrait size={22} className="mhud-weems__portrait" />
      <span className="mhud-weems__name">{WEEMS_COPY.button}</span>
      <span className="mhud-weems__sub num" data-testid="hud-ask-weems-sub">{b.sub}</span>
      <span className="mhud-weems__cap">
        {b.ring !== null && (
          <svg viewBox="0 0 28 28" aria-hidden="true">
            <circle cx="14" cy="14" r={r} className="mhud-weems__ring-bg" />
            <circle cx="14" cy="14" r={r} className="mhud-weems__ring" strokeDasharray={`${c * b.ring} ${c}`} />
          </svg>
        )}
        <KeyCap k="V" />
      </span>
    </button>
  );
}

export function WeemsCard({ c }: { c: WeemsCardView }) {
  return (
    <section className={`mhud-weemscard is-${c.kind}`} data-testid="hud-weems-card" data-kind={c.kind} data-level={c.level ?? undefined} aria-live="polite">
      <WeemsPortrait size={56} className="mhud-weemscard__portrait" />
      <div className="mhud-weemscard__body">
        <p className="mhud-weemscard__kicker">{c.kicker}</p>
        {c.lines.map((l) => <p key={l} className="mhud-weemscard__text">{l}</p>)}
        {(c.footer || c.marked) && (
          <p className="mhud-weemscard__foot">
            {c.footer}
            {c.marked && <> · {WEEMS_COPY.marked}</>}
          </p>
        )}
      </div>
    </section>
  );
}
