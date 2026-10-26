// v3 Confirm (step 4 of 4): both portraits, stat summary, trait + ability, Stage 1 rules, Start → tutorial.
import { useRef, type ReactNode } from 'react';
import type { CharacterId, PokemonId } from '../../../game/index.ts';
import { useHotkeys, useScreenFocus, focusIsNeutral } from '../../../app/keyboard.ts';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../Icon.tsx';
import { ARCHETYPE, characterView, pokemonView, rescueSummary, usesLabel } from '../../v3/crewData.ts';
import { CharacterPortrait, PokemonMedallion, StatBlock, TypeChip } from '../../v3/CrewParts.tsx';

interface ConfirmV3Props {
  nickname: string;
  characterId: CharacterId;
  pokemonId: PokemonId;
  tools: ReactNode;
  onChangeCaptain: () => void;
  onChangePokemon: () => void;
  onStart: () => void;
}

export function ConfirmV3({ nickname, characterId, pokemonId, tools, onChangeCaptain, onChangePokemon, onStart }: ConfirmV3Props) {
  const h1 = useRef<HTMLHeadingElement>(null);
  const start = useRef<HTMLButtonElement>(null);
  useScreenFocus(h1, start);
  useHotkeys((key) => {
    if (key === 'enter' && focusIsNeutral(start.current) && document.activeElement !== start.current) {
      onStart();
      return true;
    }
  });
  const c = characterView(characterId);
  const p = pokemonView(pokemonId);
  return (
    <main className="screen screen--left scrim-full" data-testid="screen-confirm">
      <header className="topline">
        <span className="caps">Step 4 of 4</span>
        {tools}
      </header>
      <div className="v3-confirm">
        <h1 ref={h1} tabIndex={-1} className="title v3-confirm__title">Ready to row, {nickname}?</h1>
        <div className="v3-confirm__crew">
          <section className="v3-confirm__card panel" aria-label={`Captain ${c.base.name}`}>
            <div className="v3-confirm__head">
              <CharacterPortrait id={c.id} name={c.base.name} size={112} className="v3-confirm__portrait" />
              <div>
                <p className="caps">Captain</p>
                <h2 className="v3-confirm__name display">{c.base.name}</h2>
                <span className="arch-chip">{ARCHETYPE[c.id]}</span>
                <p className="v3-confirm__ability">{c.action.trait}</p>
              </div>
            </div>
            <p className="v3-confirm__text">{c.action.traitText}</p>
            <StatBlock stats={c.action.stats} />
            <Button variant="ghost" size="sm" onClick={onChangeCaptain} data-testid="btn-change-captain">Change captain</Button>
          </section>
          <span className="v3-confirm__plus display" aria-hidden="true">+</span>
          <section className="v3-confirm__card panel" aria-label={`Pokémon ${p.base.name}`}>
            <div className="v3-confirm__head">
              <PokemonMedallion id={p.id} name={p.base.name} size={112} className="v3-confirm__medallion" />
              <div>
                <p className="caps">Pokémon</p>
                <h2 className="v3-confirm__name display">{p.base.name}</h2>
                <TypeChip ability={p.ability} />
                <p className="v3-confirm__ability">{p.ability.abilityName} <span className="num text-2">· {usesLabel(p.ability)}</span></p>
              </div>
            </div>
            <p className="v3-confirm__text">{p.ability.description}</p>
            <p className="v3-confirm__rescue"><Icon name="shieldCheck" /> If the Hyde grabs you, press <kbd>Q</kbd>: {rescueSummary(p.ability)}</p>
            <Button variant="ghost" size="sm" onClick={onChangePokemon} data-testid="btn-change-pokemon">Change Pokémon</Button>
          </section>
        </div>
        <p className="v3-confirm__rules">
          Stage 1 · The Crossing: row to Raven Island. Caught twice by the Hyde and you don’t finish.
        </p>
        <div className="button-row">
          <Button ref={start} variant="primary" size="lg" kbd="Enter" onClick={onStart} data-testid="btn-start-race">
            <Icon name="boat" />
            Start Stage 1
          </Button>
          <span className="badge badge--demo">Local demo</span>
          <span className="text-2 v3-confirm__note">Not ranked yet — scoring arrives with the egg hunt.</span>
        </div>
      </div>
    </main>
  );
}
