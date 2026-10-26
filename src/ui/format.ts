// Number formats from UX_SPEC §6: NBSP before units, U+2212 minus, tabular numerals (via CSS).
import { CHARACTER_BY_ID, EGG_POINTS, POKEMON_BY_ID, WEATHER, formatSeconds } from '../game/index.ts';
import type { CharacterId, EggTier, PokemonId, RouteId, WeatherId } from '../game/index.ts';

export const NB = ' ';
export const MINUS = '−';

export const fmtS = (cs: number) => (cs < 0 ? MINUS : '') + formatSeconds(Math.abs(cs)) + NB + 's';
export const fmtDS = (cs: number) => (cs < 0 ? MINUS : '+') + formatSeconds(Math.abs(cs)) + NB + 's';
export const fmtSecs = (s: number) => fmtS(Math.round(s * 100));
export const fmtM = (m: number) => (m < 0 ? MINUS : '') + Math.abs(m) + NB + 'm';
export const fmtDM = (m: number) => (m < 0 ? MINUS : '+') + Math.abs(m) + NB + 'm';
export const fmtPct = (p: number) => (p <= 0 ? '0%' : p < 0.005 ? '<1%' : Math.round(p * 100) + '%');
export const fmtPts = (n: number) => `${n}${NB}${n === 1 ? 'pt' : 'pts'}`;
export const fmtScore = (n: number) =>
  (n < 0 ? MINUS : '') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const routeName = (r: RouteId) => (r === 'safe' ? 'Safe' : 'Shortcut');
export const weatherName = (w: WeatherId) => WEATHER[w].name;
export const weatherShort = (w: WeatherId) => (w === 'clear' ? 'Clear' : w === 'strong_currents' ? 'Currents' : 'Fog');
export const characterName = (id: CharacterId) => CHARACTER_BY_ID[id]?.name ?? id;
export const pokemonName = (id: PokemonId) => POKEMON_BY_ID[id]?.name ?? id;
export const crewName = (c: CharacterId, p: PokemonId) => `${characterName(c)} + ${pokemonName(p)}`;

export const EGG_LABEL: Record<EggTier, string> = { none: 'No egg', common: 'Common egg', rare: 'Rare egg', legendary: 'Legendary egg' };

/** Egg points including Sableye's +1 on rare/legendary (matches the rules engine's provisional points). */
export function eggPointsFor(tier: EggTier, pokemonId: PokemonId): number {
  const base = EGG_POINTS[tier];
  return pokemonId === 'sableye' && (tier === 'rare' || tier === 'legendary') ? base + 1 : base;
}

/** Spoken form for screen readers ("54.24 seconds"). */
export const spokenS = (cs: number) => `${formatSeconds(Math.abs(cs))} seconds`;
