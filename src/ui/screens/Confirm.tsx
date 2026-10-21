// Confirm (step 4 of 4): crew recap, rules line, live/demo note, Start the regatta.
import { useRef, type ReactNode } from 'react';
import { CHARACTER_BY_ID, POKEMON_BY_ID } from '../../game/index.ts';
import type { CharacterId, PokemonId } from '../../game/index.ts';
import type { BackendMode } from '../../lib/backend.ts';
import { useScreenFocus } from '../../app/keyboard.ts';
import { Button } from '../components/Button.tsx';
import { CaptainCardBody, PokemonCardBody } from '../components/CrewCards.tsx';
import { Icon } from '../Icon.tsx';

interface ConfirmProps {
  nickname: string;
  characterId: CharacterId;
  pokemonId: PokemonId;
  mode: BackendMode;
  tools: ReactNode;
  busy: boolean;
  onChangeCrew: () => void;
  onStart: () => void;
}

export function Confirm({ nickname, characterId, pokemonId, mode, tools, busy, onChangeCrew, onStart }: ConfirmProps) {
  const h1 = useRef<HTMLHeadingElement>(null);
  const start = useRef<HTMLButtonElement>(null);
  useScreenFocus(h1, start);
  return (
    <main className="screen screen--left scrim-full" data-testid="screen-confirm">
      <header className="topline">
        <span className="caps">Step 4 of 4</span>
        {tools}
      </header>
      <div className="confirm">
        <h1 ref={h1} tabIndex={-1} className="title confirm__title">Ready to sail, {nickname}?</h1>
        <div className="confirm__crew">
          <div className="card select-card confirm__card"><CaptainCardBody character={CHARACTER_BY_ID[characterId]} /></div>
          <span className="confirm__plus display" aria-hidden="true">+</span>
          <div className="card select-card confirm__card"><PokemonCardBody pokemon={POKEMON_BY_ID[pokemonId]} /></div>
        </div>
        <p className="confirm__rules">
          3 legs · a second Hyde catch or 0 HP ends your run · Score = egg points × 100 − seconds
        </p>
        <p className="confirm__mode">
          {mode === 'live' ? (
            <><span className="badge badge--live"><span className="badge__dot" aria-hidden="true" />Live</span> Your score goes on the big board</>
          ) : (
            <><span className="badge badge--demo">Local demo</span> Not ranked live. Scores here are unverified.</>
          )}
        </p>
        <div className="button-row">
          <Button ref={start} variant="primary" size="lg" kbd="Enter" onClick={onStart} busy={busy} busyLabel="Raising sails…" data-testid="btn-start-race">
            <Icon name="boat" />
            Start the regatta
          </Button>
          <Button variant="ghost" onClick={onChangeCrew} data-testid="btn-change-crew">Change crew</Button>
        </div>
      </div>
    </main>
  );
}
