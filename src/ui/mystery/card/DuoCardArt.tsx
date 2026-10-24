// The duo card's artwork window (docs/overhaul/UX_DUO_CARDS.md §2): the Nightshade portrait behind / right over a blurred
// copy of its own painted gothic background, the Pokémon in front / left with ground shadow and rim light, type tint,
// fog, vignette and a bevelled metal frame. Fills its parent box (never overflows). Type colours come from CSS custom
// properties set on an ancestor (--type-face-top, --type-face-bottom, --type-accent). Local cached artwork only.
// OWNER: 3d-artist.
import { useState, type CSSProperties } from 'react';
import type { PokemonId } from '../../../game/types.ts';
import { characterPosition, pokeNudge } from './artNudge.ts';
import '../../styles/duoCardArt.css';

export interface DuoCardArtProps {
  characterArt: string;
  characterName: string;
  pokemonArt: string;
  pokemonId: PokemonId;
  pokemonName: string;
  /** Slot-machine spin: faces cycle quickly — no expensive transitions, neutral theme. */
  spinning?: boolean;
}

export function DuoCardArt({ characterArt, characterName, pokemonArt, pokemonId, pokemonName, spinning }: DuoCardArtProps) {
  // Failure is remembered per src, so a later successful src (spin swaps) shows again without effects.
  const [badChar, setBadChar] = useState('');
  const [badPoke, setBadPoke] = useState('');
  const charFailed = badChar === characterArt;
  const pokeFailed = badPoke === pokemonArt;
  const n = pokeNudge(pokemonId);
  const style = {
    '--pk-scale': n.scale,
    '--pk-x': `${n.x}%`,
    '--pk-y': `${n.y}%`,
    '--char-pos': characterPosition(characterArt),
  } as CSSProperties;

  return (
    <div
      className="dcart"
      data-spinning={spinning ? 'true' : undefined}
      data-float={n.float ? 'true' : undefined}
      data-pokemon={pokemonId}
      style={style}
      role="img"
      aria-label={`${characterName} with ${pokemonName}`}
    >
      <div className="dcart__scene" aria-hidden="true">
        {!charFailed && (
          <img className="dcart__bg" src={characterArt} alt="" width={320} height={320} decoding="async" draggable={false} />
        )}
        <div className="dcart__tint" />
        {charFailed ? (
          <div className="dcart__crest">{characterName.trim().charAt(0).toUpperCase()}</div>
        ) : (
          <img
            className="dcart__portrait"
            src={characterArt}
            alt=""
            width={320}
            height={320}
            decoding="async"
            draggable={false}
            onError={() => setBadChar(characterArt)}
          />
        )}
        <div className="dcart__fog" />
        <div className="dcart__ground" />
        <div className="dcart__pokebox">
          <img
            className="dcart__pokemon"
            src={pokemonArt}
            alt=""
            width={320}
            height={320}
            decoding="async"
            draggable={false}
            style={pokeFailed ? { visibility: 'hidden' } : undefined}
            onError={() => setBadPoke(pokemonArt)}
          />
        </div>
        <div className="dcart__vignette" />
      </div>
      <div className="dcart__frame" aria-hidden="true" />
    </div>
  );
}
