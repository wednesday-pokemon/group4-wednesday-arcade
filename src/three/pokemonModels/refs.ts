// Stable identifiers for 3D Pokémon models: National Pokédex number + form, never display names (model sources name
// regional forms differently). Shared by the runtime providers and scripts/fetch-pokemon-models.ts.
import type { PokemonId } from '../../game/types.ts';

/** Form slugs as the community catalog spells them (`formName`); extend when a partner needs another form. */
export type ModelForm = 'regular' | 'alolan' | 'galar' | 'hisuian';

export interface PokemonModelRef {
  /** National Pokédex number (PokéAPI `pokemon-species` id), not the PokéAPI `pokemon` id of a variety. */
  dexId: number;
  /** PokéAPI species slug; the fetch script cross-checks it against `dexId`. */
  species: string;
  form: ModelForm;
  shiny?: boolean;
  /** Extra yaw (rad) for a source model not authored facing +Z; checked against the cached GLB (manifest sha256). */
  modelYaw?: number;
}

/** Same species/forms as public/art/pokemon (decision D-36). */
export const POKEMON_MODEL_REFS: Record<PokemonId, PokemonModelRef> = {
  gengar: { dexId: 94, species: 'gengar', form: 'regular' },
  alolan_marowak: { dexId: 105, species: 'marowak', form: 'alolan' },
  misdreavus: { dexId: 200, species: 'misdreavus', form: 'regular' },
  galarian_corsola: { dexId: 222, species: 'corsola', form: 'galar' },
  sableye: { dexId: 302, species: 'sableye', form: 'regular' },
  dusknoir: { dexId: 477, species: 'dusknoir', form: 'regular' },
  drifblim: { dexId: 426, species: 'drifblim', form: 'regular' },
  froslass: { dexId: 478, species: 'froslass', form: 'regular' },
  jellicent: { dexId: 593, species: 'jellicent', form: 'regular' },
  chandelure: { dexId: 609, species: 'chandelure', form: 'regular' },
  aegislash: { dexId: 681, species: 'aegislash', form: 'regular' },
  trevenant: { dexId: 709, species: 'trevenant', form: 'regular' },
  dhelmise: { dexId: 781, species: 'dhelmise', form: 'regular', modelYaw: Math.PI / 2 },
  decidueye: { dexId: 724, species: 'decidueye', form: 'regular' },
  dragapult: { dexId: 887, species: 'dragapult', form: 'regular' },
  basculegion: { dexId: 902, species: 'basculegion', form: 'regular' },
  ceruledge: { dexId: 937, species: 'ceruledge', form: 'regular' },
  gholdengo: { dexId: 1000, species: 'gholdengo', form: 'regular' },
};

/** Key used by the local manifest: `94`, `105-alolan`, `94-shiny`, `105-alolan-shiny`. */
export function refKey(ref: PokemonModelRef): string {
  return [String(ref.dexId), ref.form === 'regular' ? '' : ref.form, ref.shiny ? 'shiny' : ''].filter(Boolean).join('-');
}

/** The community catalog's `formName` for a ref (`shiny` only exists for the regular form). */
export function catalogFormName(ref: PokemonModelRef): string | null {
  if (!ref.shiny) return ref.form;
  return ref.form === 'regular' ? 'shiny' : null;
}
