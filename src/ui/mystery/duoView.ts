// View-model for one offered duo card (UX_MYSTERY §2): merges the DuoCard (stats/trade-offs from src/mystery/draft.ts)
// with the Nightshade F power and the Pokémon Q move from the registries, plus the best-of-three stat marks across the
// offer. Pure; a preview offer restored from an old session renders "pending" instead of invented numbers.
import type { PokemonId } from '../../game/types.ts';
import type {
  AbilityDef, Duo, DuoCard, DuoStats, MoveLegalityStatus, NightshadeId, RoleTag,
} from '../../mystery/types.ts';
import { nightshadeDef, partnerDef, type OfferSource } from '../../app/mystery/integration.ts';
import type { IconName } from '../Icon.tsx';

export interface AbilityView {
  key: 'F' | 'Q';
  /** 'Character power' / 'Pokémon move'. */
  kind: string;
  /** Activation noise ≥ 0.5 (LoudTag). */
  loud: boolean;
  name: string;
  text: string | null;
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
}

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
  { key: 'hydeControl', label: 'Hyde Control' },
  { key: 'eggProtection', label: 'Egg Protection' },
];

export const STAT_MAX = 5;

export const characterArt = (id: NightshadeId) => `/art/characters/${id}.webp`;
export const pokemonArt = (id: PokemonId) => `/art/pokemon/${id}.webp`;

function abilityView(key: 'F' | 'Q', def: AbilityDef, legality: MoveLegalityStatus | null): AbilityView {
  return {
    key,
    kind: key === 'F' ? 'Character power' : 'Pokémon move',
    loud: def.noise >= 0.5,
    name: def.name,
    text: def.text,
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
    power: abilityView('F', n.power, null),
    move: abilityView('Q', p.move, p.legality.status),
    // De-duplicated (the same statement can come from both the Nightshade and the Pokémon registry), then capped.
    advantages: uniq(card.advantages).slice(0, MAX_ADVANTAGES),
    disadvantages: uniq(card.disadvantages).slice(0, MAX_DISADVANTAGES),
    preview,
    characterArt: characterArt(card.characterId),
    pokemonArt: pokemonArt(card.pokemonId),
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
  return views;
}

function uniq(xs: readonly string[]): string[] {
  return [...new Set(xs)];
}
