// Single-row HUD top bar: leg, weather, HP, stamina pips, lead, catches, eggs, race time, utilities.
import type { ReactNode } from 'react';
import { LEG_COUNT } from '../../game/index.ts';
import type { GameState, LegIndex, WeatherId } from '../../game/index.ts';
import { WEATHER_ICON, Icon } from '../Icon.tsx';
import { fmtPts, fmtS, weatherName, weatherShort } from '../format.ts';
import { CatchesMeter, HpMeter, LeadMeter, Stat, StaminaMeter } from '../components/StatMeters.tsx';

interface HudTopBarProps {
  state: GameState;
  legIndex: LegIndex;
  legName: string;
  weather: WeatherId;
  previewCost: number;
  tools: ReactNode;
}

export function WeatherChip({ weather, short }: { weather: WeatherId; short?: boolean }) {
  return (
    <span className={`wx-chip wx-chip--${weather}`} data-testid="weather-chip">
      <Icon name={WEATHER_ICON[weather]} />
      <span className="wx-chip__long">{weatherName(weather)}</span>
      {short && <span className="wx-chip__short">{weatherShort(weather)}</span>}
    </span>
  );
}

export function HudTopBar({ state, legIndex, legName, weather, previewCost, tools }: HudTopBarProps) {
  const reserve = LEG_COUNT - legIndex;
  return (
    <header className="hud-top panel" data-testid="hud-top">
      <div className="hud-top__leg">
        <span className="caps">Leg {legIndex}/{LEG_COUNT}</span>
        <span className="hud-top__legname display">{legName}</span>
      </div>
      <div className="stat stat--wx">
        <span className="caps stat__label">Weather</span>
        <WeatherChip weather={weather} short />
      </div>
      <HpMeter hp={state.hp} />
      <StaminaMeter stamina={state.stamina} reserve={reserve} previewCost={previewCost} />
      <LeadMeter gapM={state.pursuitGapM} />
      <CatchesMeter catches={state.hydeCatchCount} />
      <Stat label="Eggs" icon="egg" value={fmtPts(state.bankedEggPoints)} flashKey={state.bankedEggPoints} testId="stat-eggs" />
      <Stat label="Race time" icon="timer" value={fmtS(state.totalSimulatedTimeCs)} flashKey={state.totalSimulatedTimeCs} testId="stat-time" />
      <div className="hud-top__tools">{tools}</div>
    </header>
  );
}
