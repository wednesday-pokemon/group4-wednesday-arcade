// View-model helpers for the v3 crew screens: lookups over the real-time data tables, friendly specialty labels,
// stat labels and portrait URLs. Pure functions; the data itself lives in src/action/data (read-only here).
import { CHARACTERS, CHARACTER_BY_ID, POKEMON, POKEMON_BY_ID } from '../../game/index.ts';
import type { CharacterDef, CharacterId, PokemonDef, PokemonId } from '../../game/index.ts';
import { CHARACTER_ACTION_DEFS } from '../../action/data/characters.ts';
import { POKEMON_ABILITY_DEFS } from '../../action/data/pokemon.ts';
import type { AbilitySpecialty, CharacterActionDef, CharacterStats, PokemonAbilityDef } from '../../action/types.ts';

export interface CharacterView { id: CharacterId; base: CharacterDef; action: CharacterActionDef }
export interface PokemonView { id: PokemonId; base: PokemonDef; ability: PokemonAbilityDef }

const ACTION_BY_ID = new Map(CHARACTER_ACTION_DEFS.map((d) => [d.id, d]));
const ABILITY_BY_ID = new Map(POKEMON_ABILITY_DEFS.map((d) => [d.id, d]));

export function characterView(id: CharacterId): CharacterView {
  const action = ACTION_BY_ID.get(id);
  if (!action) throw new Error(`No real-time data for character ${id}`);
  return { id, base: CHARACTER_BY_ID[id], action };
}

export function pokemonView(id: PokemonId): PokemonView {
  const ability = ABILITY_BY_ID.get(id);
  if (!ability) throw new Error(`No real-time ability for Pokémon ${id}`);
  return { id, base: POKEMON_BY_ID[id], ability };
}

/** Selection order follows the existing roster order (same as the v2.5 screens). */
export const CHARACTER_VIEWS: CharacterView[] = CHARACTERS.map((c) => characterView(c.id));
export const POKEMON_VIEWS: PokemonView[] = POKEMON.map((p) => pokemonView(p.id));

export const STAT_KEYS: (keyof CharacterStats)[] = ['rowingPower', 'topSpeed', 'stamina', 'handling', 'defense'];
export const STAT_LABEL: Record<keyof CharacterStats, { full: string; short: string }> = {
  rowingPower: { full: 'Power', short: 'PWR' },
  topSpeed: { full: 'Top speed', short: 'SPD' },
  stamina: { full: 'Stamina', short: 'STA' },
  handling: { full: 'Handling', short: 'HND' },
  defense: { full: 'Toughness', short: 'TGH' },
};
export const STAT_MAX = 10;
export const STAT_NEUTRAL = 5;

/** Character archetype chip (UX_V3_ACTION §5). */
export type Archetype = 'Speedster' | 'Forgiving' | 'Survivor' | 'Scout' | 'Cruiser';
export const ARCHETYPE: Record<CharacterId, Archetype> = {
  enid: 'Speedster', gomez: 'Speedster', yoko: 'Speedster',
  xavier: 'Forgiving', ajax: 'Forgiving', rowan: 'Forgiving',
  kent: 'Survivor', morticia: 'Survivor',
  wednesday: 'Scout', eugene: 'Scout', bianca: 'Scout',
  divina: 'Cruiser',
};

export type TypeIcon = 'bolt' | 'wave' | 'heart' | 'shield' | 'ghost' | 'hand' | 'egg' | 'eye' | 'flame' | 'gem';
export type RoleFamily = 'Speed' | 'Safety' | 'Egg' | 'Hunt';

/** The ONE mapping table from specialty to the player-facing type label (selection cards, detail, HUD). */
export const SPECIALTY_LABEL: Record<AbilitySpecialty, { label: string; icon: TypeIcon; family: RoleFamily }> = {
  speed_boost: { label: 'Speed Burst', icon: 'bolt', family: 'Speed' },
  current_ride: { label: 'Current Rider', icon: 'wave', family: 'Speed' },
  stamina_restore: { label: 'Second Wind', icon: 'heart', family: 'Speed' },
  shield: { label: 'Shield', icon: 'shield', family: 'Safety' },
  hyde_distraction: { label: 'Decoy', icon: 'ghost', family: 'Safety' },
  pursuit_slow: { label: 'Slows the Hyde', icon: 'hand', family: 'Safety' },
  egg_protection: { label: 'Egg Guard', icon: 'egg', family: 'Egg' },
  obstacle_detection: { label: 'Hazard Sight', icon: 'eye', family: 'Hunt' },
  fog_clear: { label: 'Fog Clearer', icon: 'flame', family: 'Hunt' },
  egg_sense: { label: 'Egg Finder', icon: 'gem', family: 'Hunt' },
};

/** Role profile dots 0–3 (Speed / Safety / Egg / Hunt), copied from GDD §9.3 (UI copy, not gameplay data). */
export const ROLE_PROFILE: Record<PokemonId, [number, number, number, number]> = {
  gengar: [0, 3, 0, 1], alolan_marowak: [1, 2, 2, 1], misdreavus: [0, 3, 0, 1], galarian_corsola: [2, 1, 0, 0],
  sableye: [0, 1, 1, 3], dusknoir: [0, 3, 0, 1], drifblim: [2, 1, 1, 0], froslass: [0, 3, 0, 1],
  jellicent: [1, 2, 2, 1], chandelure: [1, 1, 1, 2], aegislash: [0, 3, 2, 1], trevenant: [0, 2, 1, 1],
  dhelmise: [0, 1, 3, 0], decidueye: [1, 1, 1, 2], dragapult: [3, 0, 0, 1], basculegion: [3, 0, 0, 1],
  ceruledge: [2, 1, 1, 1], gholdengo: [0, 1, 2, 0],
};
export const ROLE_FAMILIES: RoleFamily[] = ['Speed', 'Safety', 'Egg', 'Hunt'];

/** "Rescue: blocks damage · guards the egg · +10 m" built from the rescue flags. */
export function rescueSummary(a: PokemonAbilityDef): string {
  const parts: string[] = [];
  if (a.rescue.negateDamage) parts.push('blocks damage');
  if (a.rescue.protectEgg) parts.push('guards the egg');
  if (a.rescue.pushHydeBackM > 0) parts.push(`+${a.rescue.pushHydeBackM} m`);
  return parts.join(' · ');
}

export function characterPortrait(id: CharacterId): string {
  return `/art/characters/${id}.webp`;
}

export function pokemonPortrait(id: PokemonId): string {
  return `/art/pokemon/${id}.webp`;
}

/** "Cooldown 26 s" / "4 uses · 8 s". */
export function usesLabel(a: PokemonAbilityDef): string {
  return a.charges === null ? `Cooldown ${fmtS(a.cooldownS)}` : `${a.charges} uses · ${fmtS(a.cooldownS)}`;
}

function fmtS(s: number): string {
  return `${Number.isInteger(s) ? s : s.toFixed(1)} s`;
}

/** "Best at: Handling · Weak at: Power" (highest / lowest stat; ties joined). */
export function bestWeak(stats: CharacterStats): { best: string; weak: string } {
  const vals = STAT_KEYS.map((k) => stats[k]);
  const hi = Math.max(...vals);
  const lo = Math.min(...vals);
  const names = (v: number) => STAT_KEYS.filter((k) => stats[k] === v).map((k) => STAT_LABEL[k].full).join(' + ');
  return { best: names(hi), weak: names(lo) };
}
