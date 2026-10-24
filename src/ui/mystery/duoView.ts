// View-model for one offered duo card (UX_MYSTERY §2, UX_OVERHAUL §8): merges the DuoCard (stats/trade-offs from
// src/mystery/draft.ts) with the Nightshade power (slot 'F', key Q) and the Pokémon move (slot 'Q', key R) from the
// registries, the best-of-three stat marks across the offer, and the vitals chip ("100 HP · grab −35") computed from
// the real tuning exactly like run.ts does. Pure; a preview offer restored from an old session renders "pending"
// instead of invented numbers.
import type { PokemonId } from '../../game/types.ts';
import { DEFAULT_TUNING, type SimTuning } from '../../mystery/config.ts';
import {
  ABILITY_KEY_LABEL, NIGHTSHADE_IDS, type AbilityDef, type Duo, type DuoCard, type DuoStats, type MoveLegalityStatus, type NightshadeId,
  type PlayMods, type RoleTag,
} from '../../mystery/types.ts';
import { POKEMON_IDS } from '../../mystery/draft.ts';
import { nightshadeDef, partnerDef, type OfferSource } from '../../app/mystery/integration.ts';
import type { IconName } from '../Icon.tsx';

export interface AbilityView {
  /** Ability SLOT id (data/events). Never displayed — show `cap`. */
  key: 'F' | 'Q';
  /** The key the player presses (ABILITY_KEY_LABEL: power Q, move R). */
  cap: string;
  /** 'Character power' / 'Pokémon move'. */
  kind: string;
  /** Activation noise ≥ 0.5 (LoudTag). */
  loud: boolean;
  name: string;
  text: string | null;
  /** One-line card effect (UX_DUO_CARDS §4): POWER_SHORT / MOVE_SHORT, else the full text up to its first sentence. */
  short: string | null;
  cooldownS: number | null;
  adaptationNote: string | null;
  legality: MoveLegalityStatus | null;
}

export interface DuoCardView {
  key: string;
  duo: Duo;
  characterName: string;
  characterShort: string;
  identity: string;
  pokemonName: string;
  pokemonTypes: string[];
  duoName: string;
  role: RoleTag;
  rarity: DuoCard['rarity'];
  stats: DuoStats | null;
  /** Stats where this card has the best value of the three (ties all count). */
  best: (keyof DuoStats)[];
  power: AbilityView;
  move: AbilityView;
  advantages: string[];
  disadvantages: string[];
  preview: boolean;
  characterArt: string;
  pokemonArt: string;
  /** HP + grab cost from the real tuning (null on a preview card). */
  vitals: DuoVitals | null;
  /** The names row + full chip would not fit the card: show the compact chip ("♥ 100 · −42/grab"). Obsolete since the
   *  trading-card header (UX_DUO_CARDS §6) — kept for older callers; the cards no longer read it. */
  vitalsCompact: boolean;
  // ---- Trading-card presentation (UX_DUO_CARDS) — all derived, never new data.
  /** "Bianca’s Alolan Marowak" (character short name + ’s + Pokémon). */
  displayName: string;
  /** Header font step that fits NAME_BUDGET_PX (17 → 15 → 14 px at 1366×768; never ellipsis). */
  nameFit: NameFit;
  /** Card face theme: first non-Ghost type; pure Ghost = Ghost. */
  themeType: ThemeType;
  /** True when the partner is part Ghost and the theme is another type (shows the small Ghost disc). */
  ghostSecondary: boolean;
  /** "Fire / Ghost". */
  typesLabel: string;
  /** Identity up to " (" — "Electricity (requested adaptation)" → "Electricity". */
  identityShort: string;
  /** "034/126" — the pair's position in allPairs() (cosmetic set number). */
  setNumber: string;
  /** Strip (§5): up to two stats ≥ 4 (or the single highest), and the low stat (≤ 2) or null = balanced. */
  strengths: StatMark[];
  weakness: StatMark | null;
}

export interface StatMark { key: keyof DuoStats; label: string; value: number; best: boolean }

// ----------------------------------------------------------------------------------------------------- vitals chip

export interface DuoVitals { maxHp: number; grabHp: number; maxCatches: number }

/** Same formula as the sim (run.ts catch): HP lost on a grab = round(grab.hpLoss × catchDamageMult). */
export function duoVitals(mods: Pick<PlayMods, 'catchDamageMult'>, t: SimTuning = DEFAULT_TUNING): DuoVitals {
  return { maxHp: t.player.maxHp, grabHp: Math.round(t.grab.hpLoss * mods.catchDamageMult), maxCatches: t.grab.maxCatches };
}

/** "100 HP · grab −35" (U+2212 minus), or the compact fallback "♥ 100 · −35/grab" (the heart is then text). */
export function vitalsText(v: DuoVitals, compact = false): string {
  return compact ? `♥ ${v.maxHp} · −${v.grabHp}/grab` : `${v.maxHp} HP · grab −${v.grabHp}`;
}

const COUNT_WORD = ['No', 'One', 'Two', 'Three', 'Four'];
/** Screen-reader sentence: "100 HP. A Hyde grab costs 35 HP. Two grabs end the run." */
export function vitalsSpeech(v: DuoVitals): string {
  return `${v.maxHp} HP. A Hyde grab costs ${v.grabHp} HP. ${COUNT_WORD[v.maxCatches] ?? v.maxCatches} grabs end the run.`;
}

// Alegreya Sans advance widths in em (measured in Chromium with output/overhaulB-measure-glyphs.mjs). Used to budget
// the names row at 1366×768 (1rem = 16 px; everything scales together at 1920×1080). Unknown glyphs count as 0.7 em.
const EM_BOLD: Record<string, number> = {
  a: 0.48, b: 0.52, c: 0.39, d: 0.53, e: 0.47, f: 0.32, g: 0.5, h: 0.53, i: 0.26, j: 0.29, k: 0.5, l: 0.26, m: 0.8, n: 0.52, o: 0.49,
  p: 0.52, q: 0.52, r: 0.35, s: 0.38, t: 0.34, u: 0.52, v: 0.45, w: 0.7, x: 0.46, y: 0.45, z: 0.42, A: 0.6, B: 0.58, C: 0.52, D: 0.65,
  E: 0.51, F: 0.46, G: 0.6, H: 0.7, I: 0.3, J: 0.34, K: 0.58, L: 0.43, M: 0.8, N: 0.7, O: 0.64, P: 0.55, Q: 0.65, R: 0.59, S: 0.5,
  T: 0.5, U: 0.64, V: 0.59, W: 0.9, X: 0.62, Y: 0.56, Z: 0.55, ' ': 0.15, '·': 0.23, '−': 0.48, '-': 0.3, '/': 0.28, '♥': 0.59, '’': 0.21, "'": 0.21, '.': 0.23,
  0: 0.52, 1: 0.36, 2: 0.47, 3: 0.43, 4: 0.5, 5: 0.43, 6: 0.48, 7: 0.43, 8: 0.49, 9: 0.48, é: 0.47,
  ',': 0.23, ';': 0.23, ':': 0.23, '%': 0.85, '+': 0.48, '~': 0.48, '≤': 0.55, '(': 0.3, ')': 0.3, '▲': 0.99,
};
const EM_REGULAR: Record<string, number> = {
  a: 0.46, b: 0.51, c: 0.39, d: 0.52, e: 0.46, f: 0.3, g: 0.49, h: 0.52, i: 0.24, j: 0.27, k: 0.46, l: 0.25, m: 0.79, n: 0.51, o: 0.49,
  p: 0.51, q: 0.51, r: 0.32, s: 0.37, t: 0.32, u: 0.51, v: 0.42, w: 0.67, x: 0.44, y: 0.43, z: 0.41, A: 0.58, B: 0.54, C: 0.52, D: 0.65,
  E: 0.48, F: 0.43, G: 0.6, H: 0.68, I: 0.27, J: 0.31, K: 0.55, L: 0.42, M: 0.79, N: 0.68, O: 0.64, P: 0.52, Q: 0.64, R: 0.56, S: 0.47,
  T: 0.49, U: 0.63, V: 0.56, W: 0.89, X: 0.59, Y: 0.53, Z: 0.53, ' ': 0.17, '·': 0.23, '−': 0.48, '-': 0.31, '/': 0.29, '♥': 0.59, '’': 0.17, "'": 0.17, '.': 0.23,
  0: 0.53, 1: 0.34, 2: 0.46, 3: 0.41, 4: 0.48, 5: 0.42, 6: 0.47, 7: 0.42, 8: 0.47, 9: 0.47, é: 0.46,
  ',': 0.23, ';': 0.23, ':': 0.23, '%': 0.82, '+': 0.48, '~': 0.48, '≤': 0.55, '(': 0.29, ')': 0.31, '▲': 0.99,
};
// Cinzel 700 advance widths in em (Chromium, output/duo-cards/measure-glyphs.mjs) — the trading-card header name.
const EM_CINZEL_BOLD: Record<string, number> = {
  a: 0.64, b: 0.6, c: 0.7, d: 0.74, e: 0.56, f: 0.54, g: 0.74, h: 0.75, i: 0.35, j: 0.34, k: 0.67, l: 0.54, m: 0.86, n: 0.77, o: 0.79,
  p: 0.59, q: 0.78, r: 0.66, s: 0.52, t: 0.62, u: 0.71, v: 0.65, w: 0.89, x: 0.65, y: 0.66, z: 0.61, A: 0.72, B: 0.67, C: 0.78, D: 0.81,
  E: 0.63, F: 0.6, G: 0.84, H: 0.86, I: 0.39, J: 0.39, K: 0.76, L: 0.61, M: 0.95, N: 0.85, O: 0.89, P: 0.65, Q: 0.89, R: 0.74, S: 0.58,
  T: 0.68, U: 0.82, V: 0.75, W: 0.98, X: 0.73, Y: 0.7, Z: 0.66, ' ': 0.25, '·': 0.22, '−': 0.48, '-': 0.38, '/': 0.43, "'": 0.2, '’': 0.25,
  '.': 0.22, ',': 0.23, 0: 0.65, 1: 0.41, 2: 0.62, 3: 0.56, 4: 0.62, 5: 0.55, 6: 0.63, 7: 0.54, 8: 0.6, 9: 0.63, é: 0.56,
};

/** Estimated rendered width (px) of `text` in Alegreya Sans (bold/regular) or Cinzel 700 ('display') at `px`. */
export function textWidthPx(text: string, px: number, weight: 'bold' | 'regular' | 'display'): number {
  const t = weight === 'bold' ? EM_BOLD : weight === 'display' ? EM_CINZEL_BOLD : EM_REGULAR;
  let em = 0;
  for (const ch of text) em += t[ch] ?? 0.7;
  return em * px;
}

/** Names row budget at 1366×768: the card's inner width (426 − 2 × 16 padding; rare frames lose 3 px more). */
export const NAMES_ROW_BUDGET_PX = 390;
const NAMES_PX = 17; // --fs-sm at 1366×768
const CHIP_PX = 15; // --fs-xs
const CHIP_ICON_PX = 14 + 4; // heart icon + gap
const ROW_GAP_PX = 8;

/** Names row width (px at 1366×768) with the full or the compact chip. */
export function namesRowWidthPx(names: string, v: DuoVitals, compact: boolean): number {
  const chip = textWidthPx(vitalsText(v, compact), CHIP_PX, 'regular') + (compact ? 0 : CHIP_ICON_PX);
  return textWidthPx(names, NAMES_PX, 'bold') + ROW_GAP_PX + chip;
}

export const namesOf = (characterName: string, pokemonName: string) => `${characterName} · ${pokemonName}`;

export const ROLE_LABEL: Record<RoleTag, string> = {
  investigation: 'Investigation',
  stealth: 'Stealth',
  mobility: 'Mobility',
  control: 'Control',
  defense: 'Defense',
  support: 'Support',
};

/** Role icon (UX §2: icon + word always). */
export const ROLE_ICON: Record<RoleTag, IconName> = {
  investigation: 'search', stealth: 'eyeClosed', mobility: 'footprints', control: 'lasso', defense: 'shield', support: 'handHeart',
};

/** Card copy caps (UX §2): exactly 2 advantages and 1–2 disadvantages are shown. */
export const MAX_ADVANTAGES = 2;
export const MAX_DISADVANTAGES = 2;

export const STAT_ROWS: { key: keyof DuoStats; label: string }[] = [
  { key: 'investigation', label: 'Investigation' },
  { key: 'stealth', label: 'Stealth' },
  { key: 'mobility', label: 'Mobility' },
  { key: 'defense', label: 'Defense' },
  // UX_FINAL §7: every stun / slow / lure / distract hits all three monsters (Hyde, Crackstone, Slurp)
  { key: 'hydeControl', label: 'Monster Control' },
  { key: 'eggProtection', label: 'Egg Protection' },
];

export const STAT_MAX = 5;

export const characterArt = (id: NightshadeId) => `/art/characters/${id}.webp`;
export const pokemonArt = (id: PokemonId) => `/art/pokemon/${id}.webp`;

function abilityView(key: 'F' | 'Q', def: AbilityDef, legality: MoveLegalityStatus | null, short: string | undefined): AbilityView {
  return {
    key,
    cap: ABILITY_KEY_LABEL[key],
    kind: key === 'F' ? 'Character power' : 'Pokémon move',
    loud: def.noise >= 0.5,
    name: def.name,
    text: def.text,
    short: short ?? shortFallback(def.text),
    cooldownS: def.cooldownS,
    // Q moves are always game adaptations of real moves; F powers carry a note only when requested/non-canon.
    adaptationNote: def.adaptationNote ?? (key === 'Q' ? 'Game adaptation of the real move' : null),
    legality,
  };
}

export function duoCardView(card: DuoCard, source: OfferSource): DuoCardView {
  const n = nightshadeDef(card.characterId);
  const p = partnerDef(card.pokemonId);
  const preview = source === 'preview';
  const vitals = preview ? null : duoVitals(card.mods);
  const displayName = displayNameOf(n.shortName, p.name);
  const themeType = themeTypeOf(p.types);
  return {
    key: `${card.characterId}+${card.pokemonId}`,
    duo: { characterId: card.characterId, pokemonId: card.pokemonId },
    characterName: n.name,
    characterShort: n.shortName,
    identity: n.identity,
    pokemonName: p.name,
    pokemonTypes: p.types,
    duoName: card.duoName,
    role: card.role,
    rarity: card.rarity,
    stats: preview ? null : card.stats,
    best: [],
    power: abilityView('F', n.power, null, POWER_SHORT[card.characterId]),
    move: abilityView('Q', p.move, p.legality.status, MOVE_SHORT[card.pokemonId]),
    // De-duplicated (the same statement can come from both the Nightshade and the Pokémon registry), then capped.
    advantages: uniq(card.advantages).slice(0, MAX_ADVANTAGES),
    disadvantages: uniq(card.disadvantages).slice(0, MAX_DISADVANTAGES),
    preview,
    characterArt: characterArt(card.characterId),
    pokemonArt: pokemonArt(card.pokemonId),
    vitals,
    vitalsCompact: vitals !== null && namesRowWidthPx(namesOf(n.name, p.name), vitals, false) > NAMES_ROW_BUDGET_PX,
    displayName,
    nameFit: nameFitOf(displayName) ?? 'sm',
    themeType,
    ghostSecondary: themeType !== 'ghost' && p.types.includes('Ghost'),
    typesLabel: p.types.join(' / '),
    identityShort: identityShortOf(n.identity),
    setNumber: setNumberOf(card),
    strengths: preview ? [] : strengthsOf(card.stats, []),
    weakness: preview ? null : weaknessOf(card.stats),
  };
}

/** Views for the whole offer, with best-of-the-three marks (absolute stats are never normalised). */
export function offerViews(cards: readonly DuoCard[], source: OfferSource): DuoCardView[] {
  const views = cards.map((c) => duoCardView(c, source));
  if (source === 'preview') return views;
  for (const { key } of STAT_ROWS) {
    const max = Math.max(...cards.map((c) => c.stats[key]));
    // Only mark a "best" when the three differ (all equal → nobody is best).
    if (cards.every((c) => c.stats[key] === max)) continue;
    views.forEach((v, i) => {
      if (cards[i]!.stats[key] === max) v.best.push(key);
    });
  }
  // The strip's order and ▲ marks depend on the best-of-three marks.
  views.forEach((v, i) => {
    v.strengths = strengthsOf(cards[i]!.stats, v.best);
  });
  return views;
}

function uniq(xs: readonly string[]): string[] {
  return [...new Set(xs)];
}

// ======================================================================================= Trading card (UX_DUO_CARDS)

/** "Bianca’s Alolan Marowak" — §6 [R]. */
export const displayNameOf = (characterShort: string, pokemonName: string) => `${characterShort}’s ${pokemonName}`;

/** Header name steps (px at 1366×768; 1.0625 / .9375 / .875 rem). Shrink, never ellipsis. */
export type NameFit = 'lg' | 'md' | 'sm';
export const NAME_PX: Readonly<Record<NameFit, number>> = { lg: 17, md: 15, sm: 14 };
/** Header row 1 name column at 1366×768: content 376 − vitals block 96 − gap 5 (§6). */
export const NAME_BUDGET_PX = 275;
/** First step whose estimated Cinzel 700 width fits the budget, or null when even 14 px does not fit. */
export function nameFitOf(name: string): NameFit | null {
  for (const f of ['lg', 'md', 'sm'] as const) if (textWidthPx(name, NAME_PX[f], 'display') <= NAME_BUDGET_PX) return f;
  return null;
}

/** "Electricity (requested adaptation)" → "Electricity". */
export const identityShortOf = (identity: string) => identity.split(' (')[0]!.trim();

const PAIR_COUNT = NIGHTSHADE_IDS.length * POKEMON_IDS.length;
/** Cosmetic set number "034/126" = the pair's 1-based position in allPairs() order. */
export function setNumberOf(duo: Duo): string {
  const i = NIGHTSHADE_IDS.indexOf(duo.characterId) * POKEMON_IDS.length + POKEMON_IDS.indexOf(duo.pokemonId) + 1;
  const pad = String(PAIR_COUNT).length;
  return `${String(i).padStart(pad, '0')}/${PAIR_COUNT}`;
}

export const RARITY_GLYPH: Readonly<Record<DuoCard['rarity'], string>> = { common: '●', rare: '◆', epic: '★' };
export const RARITY_LABEL: Readonly<Record<DuoCard['rarity'], string>> = { common: 'Common', rare: 'Rare', epic: 'Epic' };

// ------------------------------------------------------------------------------------------------ type theme (§3)

export type ThemeType = 'ghost' | 'fire' | 'water' | 'grass' | 'ice' | 'steel' | 'poison' | 'dark' | 'flying' | 'dragon';
export interface TypeTheme { label: string; top: string; bottom: string; accent: string }
/** Face gradient + accent per theme type (no red hues: red = the Hyde). Ink glyph TYPE_INK on every accent. */
export const TYPE_THEME: Readonly<Record<ThemeType, TypeTheme>> = {
  ghost: { label: 'Ghost', top: '#2e2250', bottom: '#0e0a1e', accent: '#a891e6' },
  fire: { label: 'Fire', top: '#6a2a12', bottom: '#200c08', accent: '#f08a3c' },
  water: { label: 'Water', top: '#123a5a', bottom: '#08142a', accent: '#4f8fd6' },
  grass: { label: 'Grass', top: '#1f4a2a', bottom: '#0a1a10', accent: '#7cc46a' },
  ice: { label: 'Ice', top: '#1c4552', bottom: '#0a1820', accent: '#9fe0f0' },
  steel: { label: 'Steel', top: '#3a3e48', bottom: '#121418', accent: '#c9d3e6' },
  poison: { label: 'Poison', top: '#43204f', bottom: '#150a1c', accent: '#c06ad8' },
  dark: { label: 'Dark', top: '#2a2024', bottom: '#0c0a0c', accent: '#a8865c' },
  flying: { label: 'Flying', top: '#2c3a66', bottom: '#0e1330', accent: '#a9b8f0' },
  dragon: { label: 'Dragon', top: '#2a2a6e', bottom: '#0c0c26', accent: '#6c7cf2' },
};
export const TYPE_INK = '#120c14';

/** Data type word → theme key (null when the word has no theme). */
export function themeKeyOf(type: string): ThemeType | null {
  const k = type.trim().toLowerCase();
  return k in TYPE_THEME ? (k as ThemeType) : null;
}

/** Theme = first non-Ghost type; pure Ghost (or an unknown type) = Ghost. */
export function themeTypeOf(types: readonly string[]): ThemeType {
  for (const t of types) {
    const k = themeKeyOf(t);
    if (k && k !== 'ghost') return k;
  }
  return 'ghost';
}

// ------------------------------------------------------------------------------------ short ability lines (§4)
// Hand-written one-liners. Every number must appear in that ability's full data text (unit-tested), and the wording
// follows the data text — this never invents or drifts from a value.

export const POWER_SHORT: Readonly<Partial<Record<NightshadeId, string>>> = {
  wednesday: 'Marks the nearest clue (35 m) for 6 s · silent',
  morticia: 'Shows a monster’s next 6 s of path · silent',
  enid: '+25% speed and a trail to a clue for 7 s',
  bianca: 'Lures a monster up to 18 m ahead for 4 s',
  eugene: 'Marks a clue and distracts a monster for 5 s',
  gomez: 'Opens the Shortcut or stuns a monster 2 s',
  ajax: 'Petrifies a monster you face for 2.5 s',
};

export const MOVE_SHORT: Readonly<Partial<Record<PokemonId, string>>> = {
  gengar: 'Decoy burst 22 m ahead; staggers a seen monster',
  alolan_marowak: 'Lights cover and hiding spots for 8 s',
  misdreavus: 'A seen monster loses track of you for 4 s',
  galarian_corsola: 'Slows a seen monster 40% for 5 s, heals 10 HP',
  sableye: 'Stops a seen monster (6 m) for 1.2 s',
  dusknoir: 'Stuns a close monster 1.8 s, even mid-grab',
  drifblim: '+30% speed for 6 s; louder footsteps',
  froslass: 'Slows a monster you face by 45% for 5 s',
  jellicent: 'Splash decoy holds a monster for 5 s',
  chandelure: 'Lights the nearest clue and cover for 6 s',
  aegislash: 'Blocks one grab’s damage (catch counts)',
  trevenant: 'Slows a monster 35% for 6 s, heals 8 HP',
  dhelmise: 'Tethers a seen monster 3 s, guards the egg 8 s',
  decidueye: 'Pins a seen monster (15 m) for 2 s',
  dragapult: 'Stuns a seen monster 1 s, then lures it 3 s',
  basculegion: 'Instant 5 m dash where you face',
  ceruledge: 'Stuns a close monster 1.5 s and heals 10 HP',
  gholdengo: 'Coin decoy 4 s; halves egg damage 6 s',
};

/** Full text up to its first sentence break (`.`/`;`/`:` followed by a space or the end — "2.5" is not a break). */
export function shortFallback(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = /[.;:](?=\s|$)/.exec(text);
  return (m ? text.slice(0, m.index) : text).trim();
}

/** Every number in a text ("35", "2.5", "40"). */
export const numbersIn = (text: string): string[] => text.match(/\d+(?:\.\d+)?/g) ?? [];

/** §4 width budgets at 1366×768 (Alegreya Sans 400 15 px): one effect line; less when the LOUD tag leads it. */
export const EFFECT_PX = 15;
export const EFFECT_BUDGET_PX = 296;
export const EFFECT_BUDGET_LOUD_PX = 246;

// ------------------------------------------------------------------------------------- strengths / weakness (§5)

const clampStat = (v: number) => Math.max(1, Math.min(STAT_MAX, Math.round(v)));

/**
 * Strengths: stats ≥ 4, by value, then best-of-three, then STAT_ROWS order, max two; none → the single highest
 * (same tie order). Values are the card's absolute 1–5 stats, never normalised.
 */
export function strengthsOf(stats: DuoStats, best: readonly (keyof DuoStats)[]): StatMark[] {
  const rows = STAT_ROWS.map((r, order) => ({ key: r.key, label: r.label, value: clampStat(stats[r.key]), best: best.includes(r.key), order }));
  rows.sort((a, b) => b.value - a.value || Number(b.best) - Number(a.best) || a.order - b.order);
  const strong = rows.filter((r) => r.value >= 4).slice(0, 2);
  return (strong.length ? strong : rows.slice(0, 1)).map((r) => ({ key: r.key, label: r.label, value: r.value, best: r.best }));
}

/** Weakness: the lowest stat (first in STAT_ROWS order on ties) when it is ≤ 2; otherwise null ("Balanced"). */
export function weaknessOf(stats: DuoStats): StatMark | null {
  let low: StatMark | null = null;
  for (const r of STAT_ROWS) {
    const v = clampStat(stats[r.key]);
    if (!low || v < low.value) low = { key: r.key, label: r.label, value: v, best: false };
  }
  return low && low.value <= 2 ? low : null;
}

/** Strip copy (§5). `pro` lists the strengths (▲ = best of the three); `con` is "Low Defense" or the balanced line. */
export function stripLines(v: Pick<DuoCardView, 'strengths' | 'weakness'>): { pro: string; con: string } {
  return {
    pro: v.strengths.map((s) => `${s.label}${s.best ? ' ▲' : ''}`).join(', '),
    con: v.weakness ? `Low ${v.weakness.label}` : 'Balanced — no stat below 3',
  };
}
export const STRIP_PX = 14;
/** Strip line budget at 1366×768: content 376 − plate padding 2 × 8 − border 2 − mark 18. */
export const STRIP_BUDGET_PX = 340;
/** Estimated strip line widths (bold label + regular value). */
export function stripWidthsPx(v: Pick<DuoCardView, 'strengths' | 'weakness'>): { pro: number; con: number } {
  const { pro, con } = stripLines(v);
  return {
    pro: textWidthPx('Advantages: ', STRIP_PX, 'bold') + textWidthPx(pro, STRIP_PX, 'regular'),
    con: textWidthPx('Disadvantage: ', STRIP_PX, 'bold') + textWidthPx(con, STRIP_PX, 'regular'),
  };
}
