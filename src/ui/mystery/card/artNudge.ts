// Per-Pokémon / per-character tuning for the duo card art window (docs/overhaul/UX_DUO_CARDS.md §2).
// All values are relative to the default Pokémon box (left .25rem, bottom -3 %, 56 % x 94 %, contain, bottom-aligned).
import type { PokemonId } from '../../../game/types.ts';

export interface PokeNudge {
  /** Extra scale, origin bottom-centre. 1 = default. */
  scale: number;
  /** Horizontal shift, percent of the Pokémon box width. */
  x: number;
  /** Vertical shift, percent of the Pokémon box height (negative = up). */
  y: number;
  /** Floating species: raised body, fainter and lower (smaller) ground shadow. */
  float?: boolean;
}

const DEFAULT_NUDGE: PokeNudge = { scale: 1, x: 0, y: 0 };

export const POKE_NUDGE: Partial<Record<PokemonId, PokeNudge>> = {
  // scale ~ equalises visual mass (sqrt of opaque area) and caps tall / wide art inside the box; y puts every grounded
  // species' feet on one baseline (art alpha bottoms differ by up to 40 source px) and lifts floaters by ~4 %.
  gengar: { scale: 0.84, x: 0, y: -2.5 },
  alolan_marowak: { scale: 1.12, x: 0, y: -2.5 },
  misdreavus: { scale: 0.82, x: 0, y: -3.2, float: true },
  galarian_corsola: { scale: 0.93, x: 0, y: 0.8 },
  sableye: { scale: 1.04, x: 0, y: -0.6 },
  dusknoir: { scale: 0.99, x: 0, y: 4.4, float: true },
  drifblim: { scale: 0.91, x: 0, y: -6.5, float: true },
  froslass: { scale: 1.04, x: 0, y: -6.5, float: true },
  jellicent: { scale: 0.82, x: 0, y: -2.9, float: true },
  chandelure: { scale: 1.06, x: 0, y: -6.5, float: true },
  aegislash: { scale: 1.01, x: 0, y: -6.5, float: true },
  trevenant: { scale: 0.98, x: 0, y: 0.8 },
  dhelmise: { scale: 1.0, x: 0, y: -2.5 },
  decidueye: { scale: 0.89, x: 0, y: 2.0 },
  dragapult: { scale: 0.92, x: 0, y: -0.3 },
  basculegion: { scale: 1.1, x: 0, y: 7, float: true },
  ceruledge: { scale: 1.14, x: 0, y: -2.5 },
  gholdengo: { scale: 1.14, x: 0, y: -2.5 },
};

export function pokeNudge(id: PokemonId): PokeNudge {
  return POKE_NUDGE[id] ?? DEFAULT_NUDGE;
}

/** CSS object-position of the sharp portrait (x y); default top-centre. Tuned so each face stays clear of the Pokémon. */
export const CHARACTER_POSITION: Record<string, string> = {};

export function characterPosition(artUrl: string): string {
  const id = /\/([a-z_]+)\.webp/.exec(artUrl)?.[1] ?? '';
  return CHARACTER_POSITION[id] ?? '50% 0';
}
