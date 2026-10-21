// Stage 1 end screens: "Raven Island reached" (complete) and "Dragged into the fog" (DNF, unranked).
import { useRef, type ReactNode } from 'react';
import type { CharacterId, PokemonId } from '../../../game/index.ts';
import type { StageResult } from '../../../app/v3/flow.ts';
import { useScreenFocus } from '../../../app/keyboard.ts';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../Icon.tsx';
import { characterView, pokemonView } from '../../v3/crewData.ts';
import { CharacterPortrait, PokemonMedallion } from '../../v3/CrewParts.tsx';

interface StageEndProps {
  result: StageResult;
  nickname: string;
  characterId: CharacterId;
  pokemonId: PokemonId;
  tools: ReactNode;
  onPlayAgain: () => void;
  onMainMenu: () => void;
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return m > 0 ? `${m}:${rest.toFixed(1).padStart(4, '0')}` : `${rest.toFixed(1)} s`;
}

export function StageEnd({ result, nickname, characterId, pokemonId, tools, onPlayAgain, onMainMenu }: StageEndProps) {
  const h1 = useRef<HTMLHeadingElement>(null);
  const again = useRef<HTMLButtonElement>(null);
  useScreenFocus(h1, again);
  const done = result.outcome === 'finished';
  const c = characterView(characterId);
  const p = pokemonView(pokemonId);
  const rows: [string, ReactNode][] = done
    ? [
      ['Time', fmtTime(result.timeS)],
      ['Hull', `${Math.round(result.hp)} / ${result.maxHp} HP`],
      ['Collisions', result.collisions],
      ['Abilities used', result.abilitiesUsed],
      ['Close calls', result.closeCalls],
      ['Hyde catches', `${result.catches} / 2`],
    ]
    : [
      ['Survived', fmtTime(result.timeS)],
      ['Crossed', `${Math.round(result.progress * 100)} % of the lake`],
      ['Collisions', result.collisions],
      ['Abilities used', result.abilitiesUsed],
      ['Close calls', result.closeCalls],
      ['Rescues', result.rescues],
    ];
  return (
    <main className={`screen screen--left scrim-full stage-end stage-end--${done ? 'complete' : 'dnf'}`} data-testid={done ? 'screen-complete' : 'screen-dnf'}>
      <header className="topline">
        <span className="caps">Stage 1 · The Crossing</span>
        {tools}
      </header>
      <div className="stage-end__body">
        <div className="stage-end__left">
          <p className="caps stage-end__kicker">{done ? 'Stage 1 complete' : 'Did not finish · unranked'}</p>
          <h1 ref={h1} tabIndex={-1} className="title stage-end__title">
            {done ? <>Raven Island <span className="lantern">reached</span></> : <>Dragged into <span className="stage-end__fog">the fog</span></>}
          </h1>
          <p className="stage-end__lead">
            {done
              ? `${nickname}, ${c.base.name} and ${p.base.name} made the crossing.`
              : `The Hyde caught ${nickname} twice. Runs that don’t finish stay off the board.`}
          </p>
          <dl className="stage-end__stats" data-testid="stage-end-stats">
            {rows.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd className="num">{v}</dd></div>
            ))}
          </dl>
          {result.cleanEscapes > 0 && <p className="stage-end__badge"><Icon name="shieldCheck" /> Clean escape: {p.ability.abilityName} saved you without a counted catch.</p>}
          {done && (
            <p className="notice stage-end__note" data-testid="egg-hunt-note">
              <Icon name="egg" />
              The Egg Hunt on Raven Island arrives in the next phase. For now, the crossing is the whole run.
            </p>
          )}
          <div className="button-row">
            <Button ref={again} variant="primary" size="lg" kbd="Enter" icon="reset" onClick={onPlayAgain} data-testid="btn-play-again">Play again</Button>
            <Button variant="secondary" onClick={onMainMenu} data-testid="btn-main-menu">Main menu</Button>
          </div>
        </div>
        <div className="stage-end__crew" aria-hidden="true">
          <CharacterPortrait id={c.id} name="" size={220} className="stage-end__portrait" />
          <PokemonMedallion id={p.id} name="" size={140} className="stage-end__medallion" />
        </div>
      </div>
    </main>
  );
}
