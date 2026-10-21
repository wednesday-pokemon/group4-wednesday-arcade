// Card anatomy for captains and Pokémon (UX_SPEC SelectCard). No truncation or line clamp.
import type { CharacterDef, PokemonDef } from '../../game/index.ts';

export function Crest({ character, size = 48 }: { character: CharacterDef; size?: number }) {
  const [a, b, c] = character.palette;
  return (
    <span
      className="crest"
      aria-hidden="true"
      style={{ width: size, height: size, background: `linear-gradient(180deg, ${a} 0 33%, ${b} 33% 66%, ${c} 66% 100%)` }}
    >
      <span className="crest__initial">{character.name[0]}</span>
    </span>
  );
}

export function CaptainCardBody({ character }: { character: CharacterDef }) {
  return (
    <>
      <div className="captain-card__head">
        <Crest character={character} />
        <div className="captain-card__names">
          <span className="card-name">{character.name}</span>
          <span className="card-trait">{character.abilityName}</span>
        </div>
      </div>
      <p id={`ability-${character.id}`} className="card-line">{character.shortAbility}</p>
    </>
  );
}

export function PokemonCardBody({ pokemon }: { pokemon: PokemonDef }) {
  const [a, b] = pokemon.palette;
  return (
    <>
      <span className="pokemon-card__stripe" aria-hidden="true" style={{ background: `linear-gradient(90deg, ${a}, ${b})` }} />
      <span className="card-name card-name--balance">{pokemon.name}</span>
      <span className="card-trait">{pokemon.traitName}</span>
      <p id={`trait-${pokemon.id}`} className="card-line">{pokemon.shortTrait}</p>
    </>
  );
}
