// Q ability panel (UX_V3_ACTION §4), bottom-right: Pokémon medallion with cooldown sweep, Q cap, ability name and a
// state line for each of the 5 states (Ready / Cooling / Rescue ready / Active / Denied). Charges as pips.
import { useEffect, useState } from 'react';
import type { HudAbility } from '../../app/v3/useStageLoop.ts';
import type { PokemonId } from '../../game/index.ts';
import { Icon } from '../Icon.tsx';
import { pokemonPortrait } from '../v3/crewData.ts';

interface AbilityPanelProps {
  pokemonId: PokemonId;
  pokemonName: string;
  abilityName: string;
  a: HudAbility;
  hydeNear: boolean;
  dim?: boolean;
}

function useFlag(seq: number, ms: number): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (seq === 0) return;
    setOn(true);
    const t = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(t);
  }, [seq, ms]);
  return on;
}

export type AbilityUiState = 'ready' | 'cooling' | 'rescue_ready' | 'active' | 'denied' | 'empty';

export function abilityUiState(a: HudAbility, denied: boolean): AbilityUiState {
  if (denied) return 'denied';
  if (a.activeLeftS > 0) return 'active';
  if (a.chargesLeft === 0) return 'empty';
  if (a.ready) return 'ready';
  if (a.rescueReady) return 'rescue_ready';
  return 'cooling';
}

export function AbilityPanel({ pokemonId, pokemonName, abilityName, a, hydeNear, dim }: AbilityPanelProps) {
  const denied = useFlag(a.deniedSeq, 900);
  const glow = useFlag(a.readySeq, 300);
  const state = abilityUiState(a, denied);
  const cd = a.ready || a.cooldownS <= 0 ? 0 : Math.min(1, a.cooldownLeftS / a.cooldownS);
  const secs = `${Math.ceil(a.cooldownLeftS)} s`;
  const line: Record<AbilityUiState, string> = {
    ready: 'READY',
    cooling: secs,
    rescue_ready: `Rescue ready · ${secs}`,
    active: `ACTIVE ${a.activeLeftS.toFixed(1)} s`,
    denied: a.deniedReason === 'no_charges' || a.chargesLeft === 0 ? 'No charges left' : a.deniedReason === 'not_applicable' ? 'Nothing to do here' : `Not ready · ${secs}`,
    empty: 'No charges left',
  };
  return (
    <section
      className={`abil abil--${state}${glow ? ' abil--glow' : ''}${hydeNear && a.ready ? ' abil--urge' : ''}${dim ? ' is-dim' : ''}`}
      aria-label={`Pokémon ability ${abilityName}, key Q: ${line[state]}`}
      data-testid="hud-ability"
      data-state={state}
    >
      <span className="abil__portrait" style={{ ['--cd' as string]: cd }}>
        <img src={pokemonPortrait(pokemonId)} alt={pokemonName} width={72} height={72} draggable={false} />
        {cd > 0 && <span className="abil__sweep" aria-hidden="true" />}
        <kbd className="kcap kcap--q" aria-hidden="true">Q</kbd>
      </span>
      <span className="abil__text">
        <span className="abil__name">{abilityName}</span>
        <span className="abil__state num" data-testid="hud-ability-state">
          {state === 'rescue_ready' && <Icon name="shieldCheck" />}
          {line[state]}
        </span>
        {a.charges !== null && (
          <span className="abil__charges" aria-label={`${a.chargesLeft ?? 0} of ${a.charges} charges`}>
            {Array.from({ length: a.charges }, (_, i) => <span key={i} className={i < (a.chargesLeft ?? 0) ? 'is-on' : ''} />)}
          </span>
        )}
        {state === 'active' && a.durationS > 0 && (
          <span className="abil__active-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, (a.activeLeftS / a.durationS) * 100)}%` }} /></span>
        )}
      </span>
    </section>
  );
}
