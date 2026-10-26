// RouteCard (UX_SPEC §4): radio in the "Route" group with six rows; risks >= 30% get a warning icon.
import { forwardRef } from 'react';
import type { WeatherId } from '../../game/index.ts';
import { EggSvg } from '../components/EggSvg.tsx';
import { Icon } from '../Icon.tsx';
import { EGG_LABEL, eggPointsFor, fmtDM, fmtDS, fmtPct, fmtPts, fmtS, weatherShort } from '../format.ts';
import type { RoutePreview } from './routePreview.ts';
import type { PokemonId } from '../../game/index.ts';

interface RouteCardProps {
  preview: RoutePreview;
  weather: WeatherId;
  pokemonId: PokemonId;
  pushLevel: number;
  selected: boolean;
  advised: boolean;
  tabbable: boolean;
  onSelect: () => void;
  onHover: (hovering: boolean) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

const RISK_WARN = 0.3;
const TIER_SHORT = { none: 'None', common: 'Common', rare: 'Rare', legendary: 'Legendary' } as const;

function Risk({ p, testId }: { p: number; testId: string }) {
  if (p <= 0) return <dd data-testid={testId}>None</dd>;
  return (
    <dd className={p >= RISK_WARN ? 'route-card__warn' : undefined} data-testid={testId}>
      {p >= RISK_WARN && <Icon name="alert" />}
      {fmtPct(p)}
    </dd>
  );
}

export const RouteCard = forwardRef<HTMLDivElement, RouteCardProps>(function RouteCard(
  { preview, weather, pokemonId, pushLevel, selected, advised, tabbable, onSelect, onHover, onKeyDown },
  ref,
) {
  const isSafe = preview.route === 'safe';
  const name = isSafe ? 'Safe' : 'Shortcut';
  const leadDanger = preview.leadDeltaM < 0;
  return (
    <div
      ref={ref}
      role="radio"
      aria-checked={selected}
      tabIndex={tabbable ? 0 : -1}
      className={`card route-card${selected ? ' is-selected' : ''}`}
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      onKeyDown={onKeyDown}
      aria-label={`${name} route`}
      data-testid={`route-${preview.route}`}
    >
      <div className="route-card__head">
        <span className="route-card__name display">{name}</span>
        <kbd>{isSafe ? 'S' : 'H'}</kbd>
        {advised && <span className="ribbon">Advised</span>}
        {selected && <span className="selected-badge selected-badge--inline" aria-hidden="true">Selected</span>}
      </div>
      <dl className="route-card__rows">
        <dt>Base</dt>
        <dd>{fmtS(preview.baseCs)}</dd>
        <dt>{weatherShort(weather)}</dt>
        <dd>
          {weather === 'clear' ? 'No delay' : fmtDS(preview.weatherDelayCs)}
          {preview.weatherNote && <span className="route-card__note"> ({preview.weatherNote})</span>}
        </dd>
        <dt>Crash</dt>
        <Risk p={preview.crashP} testId={`route-${preview.route}-crash`} />
        <dt>Hyde catch</dt>
        {preview.proximityCatch ? (
          <dd className="route-card__warn"><Icon name="alert" />Certain: lead hits 0</dd>
        ) : (
          <Risk p={preview.hydeP} testId={`route-${preview.route}-hyde`} />
        )}
        <dt>Lead</dt>
        <dd className={leadDanger ? 'route-card__minus' : 'route-card__plus'}>{fmtDM(preview.leadDeltaM)}</dd>
        <dt>Eggs</dt>
        <dd className="route-card__eggs">
          {preview.knownEgg ? (
            <span className={`egg-chip egg-chip--${preview.knownEgg}`} data-testid={`route-${preview.route}-known-egg`}>
              <EggSvg tier={preview.knownEgg} size={22} />
              {EGG_LABEL[preview.knownEgg]}
              {preview.knownEgg !== 'none' && ` (${fmtPts(eggPointsFor(preview.knownEgg, pokemonId))})`}
            </span>
          ) : (
            preview.eggOdds.map((o) => `${TIER_SHORT[o.tier]} ${fmtPct(o.p)}`).join(' · ')
          )}
        </dd>
      </dl>
      <span className="sr-only">Hyde catch chance shown for push {pushLevel}, assuming no crash.</span>
    </div>
  );
});
