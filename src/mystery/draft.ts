// Bundled duo cards + the seeded three-card draft (pure; shared with Deno).
//
// buildCard(duo): combined mods → duoStats (stats.ts), dominant role (design §6 rule 3), cosmetic rarity (seed-free hash
// of the pair, never a strength promise), 2 advantages + 1–2 disadvantages from the registries' sim-true statements
// (cardLines: never two lines about the same modifier; a modifier both members change is restated from the combined
// mods, e.g. Enid × Dragapult footsteps 1.15 × 1.05 → "Footsteps ~21% louder").
//
// draftOffer(seed): all 126 pairs are ordered by a keyed PRF draw on (seed, pair). The first POOL pairs of that order
// are searched (i < j < k, lexicographic in draw order) for the first triple with the best achievable score:
//   1000 × all three characters distinct + 500 × all three Pokémon distinct + 100 × role-category coverage
// where coverage = max over card→category assignments of cards that qualify for their category (it is (near-)dominant
// for the card, or a member's role tag names it),
// categories A investigation/stealth, B mobility/escape, C defense/control(/support). The search stops at the first
// triple reaching the maximum (3 distinct + full coverage); otherwise the best-scoring triple found is the
// deterministic fallback (ties → earliest in draw order). Same seed → same offer; it never favours specific pairs
// beyond the role-diversity rule because candidates come in random (seeded) order.
import { POKEMON } from '../game/constants.ts';
import { NIGHTSHADES } from './data/nightshades.ts';
import { hearingRadiusM } from './data/tuning.ts';
import { PARTNERS } from './data/partners.ts';
import { prfUniform } from './prf.ts';
import { combineMods, duoScores, duoStats, type StatScores } from './stats.ts';
import {
  NIGHTSHADE_IDS, type Duo, type DuoCard, type DuoOffer, type NightshadeDef, type PlayMods, type NightshadeId,
  type PokemonId, type PokemonPartnerDef, type RoleTag,
} from './types.ts';

export interface Registries {
  nightshades: Record<NightshadeId, NightshadeDef>;
  partners: Record<PokemonId, PokemonPartnerDef>;
}

export const POKEMON_IDS: readonly PokemonId[] = POKEMON.map((p) => p.id);

export function allPairs(): Duo[] {
  const out: Duo[] = [];
  for (const characterId of NIGHTSHADE_IDS) for (const pokemonId of POKEMON_IDS) out.push({ characterId, pokemonId });
  return out;
}

const ROLE_ORDER: readonly RoleTag[] = ['investigation', 'stealth', 'mobility', 'control', 'defense', 'support'];

/** Role → its stat score 0..1 (design §6 rule 3: defense → max(Defense, Egg Protection), support → mean(Defense, Investigation)). */
const SCORE_FOR_ROLE: Record<RoleTag, (s: StatScores) => number> = {
  investigation: (s) => s.investigation,
  stealth: (s) => s.stealth,
  mobility: (s) => s.mobility,
  control: (s) => s.hydeControl,
  defense: (s) => Math.max(s.defense, s.eggProtection),
  support: (s) => (s.defense + s.investigation) / 2,
};

/**
 * Card role (design §6 rule 3): the role tag shared by the character and the Pokémon (the highest-scoring one if
 * several); otherwise, among both members' tags, the role whose stat score is highest. Ties → ROLE_ORDER.
 */
export function dominantRole(n: NightshadeDef, p: PokemonPartnerDef, scores: StatScores): RoleTag {
  const shared = ROLE_ORDER.filter((r) => n.roleTags.includes(r) && p.roleTags.includes(r));
  const union = ROLE_ORDER.filter((r) => n.roleTags.includes(r) || p.roleTags.includes(r));
  const pool = shared.length ? shared : union.length ? union : ROLE_ORDER;
  let role = pool[0];
  for (const r of pool) if (SCORE_FOR_ROLE[r](scores) > SCORE_FOR_ROLE[role](scores) + 1e-9) role = r;
  return role;
}

export type RoleCategory = 'investigation_stealth' | 'mobility_escape' | 'defense_control';
export const CATEGORIES: readonly RoleCategory[] = ['investigation_stealth', 'mobility_escape', 'defense_control'];

const CATEGORY_TAGS: Record<RoleCategory, readonly RoleTag[]> = {
  investigation_stealth: ['investigation', 'stealth'],
  mobility_escape: ['mobility'],
  defense_control: ['defense', 'control', 'support'],
};

/**
 * Offer-diversity category affinity: best stat score of the category + 0.15 per member tag in the category
 * (+ 0.15 more for the card's own role), so both what the duo can do and how it is labelled count.
 */
export function categoryScores(n: NightshadeDef, p: PokemonPartnerDef, scores: StatScores, role: RoleTag): Record<RoleCategory, number> {
  const base: Record<RoleCategory, number> = {
    investigation_stealth: Math.max(scores.investigation, scores.stealth),
    mobility_escape: scores.mobility,
    defense_control: Math.max(scores.defense, scores.hydeControl, scores.eggProtection),
  };
  const out = {} as Record<RoleCategory, number>;
  for (const c of CATEGORIES) {
    const tags = CATEGORY_TAGS[c];
    const tagCount = tags.filter((t) => n.roleTags.includes(t)).length + tags.filter((t) => p.roleTags.includes(t)).length;
    out[c] = base[c] + 0.15 * tagCount + (tags.includes(role) ? 0.15 : 0);
  }
  return out;
}

const ADJECTIVE: Record<NightshadeId, string> = {
  wednesday: 'Silent', morticia: 'Velvet', enid: 'Howling', bianca: 'Siren', eugene: 'Buzzing', gomez: 'Crackling', ajax: 'Stone-Eyed',
};
const NOUN: Record<RoleTag, string> = {
  investigation: 'Sleuth', stealth: 'Shadow', mobility: 'Runner', control: 'Warden', defense: 'Bulwark', support: 'Keeper',
};

export function rarityFor(duo: Duo): DuoCard['rarity'] {
  const u = prfUniform('card-rarity', `${duo.characterId}|${duo.pokemonId}`);
  return u < 0.15 ? 'epic' : u < 0.5 ? 'rare' : 'common';
}

// ---------------------------------------------------------------------------------------------- card trade-off lines

export type ModField = keyof PlayMods;
const FAVOURABLE_UP: ReadonlySet<ModField> = new Set<ModField>(['walkSpeedMult', 'sprintSpeedMult', 'hydeEffectDurationMult']);
export const CARD_LINE_MAX = 46;

/**
 * The PlayMods fields a registry line describes: a field counts when the line names it (keyword) AND that member really
 * modifies it. Lines naming the member's own F power / Q move (or "during …") describe the ability, not a passive mod.
 */
export function lineFields(line: string, memberMods: Partial<PlayMods>, abilityName: string): ModField[] {
  const l = line.toLowerCase();
  if (l.includes(abilityName.toLowerCase()) || /\bduring\b/.test(l)) return [];
  const has = (f: ModField) => (memberMods[f] ?? 1) !== 1;
  const out: ModField[] = [];
  if (/footstep/.test(l) && has('footstepNoiseMult')) out.push('footstepNoiseMult');
  if (/\bwalks?\b/.test(l) && has('walkSpeedMult')) out.push('walkSpeedMult');
  if (/\bsprints?\b/.test(l) && has('sprintSpeedMult')) out.push('sprintSpeedMult');
  if (/\bsearch/.test(l) && has('interactTimeMult')) out.push('interactTimeMult');
  if (/\bgrab/.test(l) && /\bhp\b/.test(l) && has('catchDamageMult')) out.push('catchDamageMult');
  if (/security/.test(l) && has('eggSecurityLossMult')) out.push('eggSecurityLossMult');
  if (/longer/.test(l) && has('hydeEffectDurationMult')) out.push('hydeEffectDurationMult');
  return out;
}

/** Topics a line occupies: its fields, and walk lines also cover sprint speed (walkSpeedMult scales sprinting too). */
export function lineTopics(fields: ModField[]): ModField[] {
  return fields.includes('walkSpeedMult') ? [...new Set<ModField>([...fields, 'sprintSpeedMult'])] : fields;
}

function pct(mult: number): { n: number; text: string } {
  const raw = Math.abs(mult - 1) * 100;
  const n = Math.round(raw);
  return { n, text: `${Math.abs(raw - n) > 0.05 ? '~' : ''}${n}%` };
}

/** One truthful line for a combined modifier (null when it rounds to no change). */
export function modLine(field: ModField, mods: PlayMods, baseGrabHp = 35): { text: string; good: boolean } | null {
  const v = mods[field];
  const { n, text } = pct(v);
  if (field === 'walkSpeedMult') {
    const sprint = mods.walkSpeedMult * mods.sprintSpeedMult;
    const sp = pct(sprint);
    if (n === 0 && sp.n === 0) return null;
    if (n === 0) return { text: `Sprints ${sp.text} ${sprint > 1 ? 'faster' : 'slower'}`, good: sprint > 1 };
    const up = v > 1;
    if (sp.n === n && (sprint > 1) === up) return { text: `Walks and sprints ${text} ${up ? 'faster' : 'slower'}`, good: up };
    if ((sprint > 1) === up && sp.n > 0) return { text: `Walks ${text} and sprints ${sp.text} ${up ? 'faster' : 'slower'}`, good: up };
    return { text: `Walks ${text} ${up ? 'faster' : 'slower'}`, good: up };
  }
  if (n === 0) return null;
  const up = v > 1;
  const good = FAVOURABLE_UP.has(field) ? up : !up;
  switch (field) {
    case 'footstepNoiseMult':
      return { text: `Footsteps ${text} ${up ? 'louder' : 'quieter'}`, good };
    case 'sprintSpeedMult':
      return { text: `Sprints ${text} ${up ? 'faster' : 'slower'}`, good };
    case 'interactTimeMult':
      return { text: `Searches clues and the egg ${text} ${up ? 'slower' : 'faster'}`, good };
    case 'catchDamageMult':
      return { text: `A Hyde grab costs ${Math.round(baseGrabHp * v)} HP instead of ${baseGrabHp}`, good };
    case 'eggSecurityLossMult':
      return { text: `Carried egg loses ${text} ${up ? 'more' : 'less'} security`, good };
    case 'hydeEffectDurationMult':
      return { text: `Stuns/slows/distracts last ${text} ${up ? 'longer' : 'shorter'}`, good };
    default:
      return null;
  }
}

interface LineSource { text: string; mods: Partial<PlayMods>; ability: string; other: Partial<PlayMods> }

/**
 * 2 advantages + 1–2 disadvantages with no two lines about the same modifier. Candidate order: character line 1,
 * Pokémon line 1, character line 2, Pokémon line 2. A passive-mod line is kept verbatim when only its member modifies
 * that field; when BOTH members modify it, it is restated from the combined mods and only kept on the side it really
 * falls (dropped if it rounds to no change). Fallbacks (rare): the strongest remaining combined modifiers.
 */
export function cardLines(n: NightshadeDef, p: PokemonPartnerDef, mods: PlayMods): { advantages: string[]; disadvantages: string[] } {
  const used = new Set<string>(); // topics: mod fields + exact ability lines
  const pick = (cands: LineSource[], wantGood: boolean, max: number): string[] => {
    const out: string[] = [];
    for (const c of cands) {
      if (out.length >= max) break;
      const fields = lineFields(c.text, c.mods, c.ability);
      if (fields.length === 0) {
        if (used.has(c.text)) continue;
        used.add(c.text);
        out.push(c.text);
        continue;
      }
      let topics = lineTopics(fields);
      if (topics.some((f) => used.has(f))) continue;
      const speed = topics.includes('sprintSpeedMult');
      const shared = topics.some((f) => (c.other[f] ?? 1) !== 1) || (speed && (c.other.walkSpeedMult ?? 1) !== 1);
      let text = c.text;
      if (shared) {
        // speed lines are restated from the effective walk / sprint speeds (walk × sprint for sprinting)
        const gen: ModField = speed ? (mods.walkSpeedMult !== 1 ? 'walkSpeedMult' : 'sprintSpeedMult') : fields[0];
        if (speed) topics = ['walkSpeedMult', 'sprintSpeedMult'];
        if (topics.some((f) => used.has(f))) continue;
        const line = modLine(gen, mods);
        if (!line || line.good !== wantGood) continue;
        text = line.text;
      }
      for (const f of topics) used.add(f);
      out.push(text);
    }
    return out;
  };
  const src = (texts: string[], mine: Partial<PlayMods>, ability: string, other: Partial<PlayMods>): LineSource[] =>
    texts.map((text) => ({ text, mods: mine, ability, other }));
  const interleave = (a: LineSource[], b: LineSource[]) => {
    const out: LineSource[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i]) out.push(a[i]);
      if (b[i]) out.push(b[i]);
    }
    return out;
  };
  const advantages = pick(interleave(src(n.advantages, n.mods, n.power.name, p.mods), src(p.advantages, p.mods, p.move.name, n.mods)), true, 2);
  const disadvantages = pick(interleave(src(n.disadvantages, n.mods, n.power.name, p.mods), src(p.disadvantages, p.mods, p.move.name, n.mods)), false, 2);
  // fallbacks: strongest remaining combined modifiers on the right side
  const remaining = (good: boolean) => (Object.keys(mods) as ModField[])
    .filter((f) => !used.has(f) && !(f === 'sprintSpeedMult' && used.has('walkSpeedMult')))
    .map((f) => ({ f, line: modLine(f, mods), dev: Math.abs(mods[f] - 1) }))
    .filter((x) => x.line !== null && x.line.good === good)
    .sort((a, b) => b.dev - a.dev);
  for (const x of remaining(true)) {
    if (advantages.length >= 2) break;
    advantages.push(x.line!.text);
    for (const f of lineTopics([x.f])) used.add(f);
  }
  for (const x of remaining(false)) {
    if (disadvantages.length >= 1) break;
    disadvantages.push(x.line!.text);
    for (const f of lineTopics([x.f])) used.add(f);
  }
  if (disadvantages.length === 0) {
    // every passive trade-off cancelled out: state a real ability cost (activation noise, else the longer cooldown)
    const loud = [n.power, p.move].filter((ab) => ab.noise > 0).sort((x, y) => y.noise - x.noise)[0];
    if (loud) disadvantages.push(`${loud.name} is heard ~${Math.round(hearingRadiusM(loud.noise))} m away`);
    else {
      const slow = [n.power, p.move].sort((x, y) => y.cooldownS - x.cooldownS)[0];
      disadvantages.push(`${slow.name} recharges in ${slow.cooldownS} s`);
    }
  }
  return { advantages, disadvantages };
}

export interface CardInfo {
  card: DuoCard;
  categories: Record<RoleCategory, number>;
  /** Categories named by a role tag of the character or the Pokémon. */
  tagged: RoleCategory[];
}

export function buildCardFrom(duo: Duo, reg: Registries): CardInfo {
  const n = reg.nightshades[duo.characterId];
  const p = reg.partners[duo.pokemonId];
  if (!n || !p) throw new Error(`unknown duo ${duo.characterId}+${duo.pokemonId}`);
  const mods = combineMods(n, p);
  const scores = duoScores(mods, n.power, p.move);
  const stats = duoStats(mods, n.power, p.move);
  const role = dominantRole(n, p, scores);
  const { advantages, disadvantages } = cardLines(n, p, mods);
  const card: DuoCard = {
    characterId: duo.characterId, pokemonId: duo.pokemonId,
    duoName: `The ${ADJECTIVE[duo.characterId]} ${NOUN[role]}`,
    role, rarity: rarityFor(duo), stats, mods, advantages, disadvantages,
  };
  const tagged = CATEGORIES.filter((c) => CATEGORY_TAGS[c].some((t) => n.roleTags.includes(t) || p.roleTags.includes(t)));
  return { card, categories: categoryScores(n, p, scores, role), tagged };
}

const NEAR_DOMINANT = 0.1;

/**
 * A card can fill a category slot if that category is (near-)dominant for it, or if the character or the Pokémon carries
 * a role tag of that category (e.g. any Gomez or Drifblim card can be the mobility/escape pick).
 */
export function qualifies(info: Pick<CardInfo, 'categories' | 'tagged'>, cat: RoleCategory): boolean {
  const c = info.categories;
  const top = Math.max(c.investigation_stealth, c.mobility_escape, c.defense_control);
  return c[cat] >= top - NEAR_DOMINANT || info.tagged.includes(cat);
}

const PERMS: [number, number, number][] = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

/** Max number of cards that can be matched one-to-one to distinct categories they qualify for (0..3). */
export function coverage(infos: Pick<CardInfo, 'categories' | 'tagged'>[]): number {
  let best = 0;
  for (const perm of PERMS) {
    let n = 0;
    for (let i = 0; i < 3; i++) if (qualifies(infos[i], CATEGORIES[perm[i]])) n++;
    if (n > best) best = n;
  }
  return best;
}

export const DRAFT_POOL = 40;
const MAX_SCORE = 1000 + 500 + 300;

export function draftOfferFrom(seed: string, reg: Registries): DuoOffer {
  const order = allPairs()
    .map((d, i) => ({ d, i, u: prfUniform(seed, `draft:${d.characterId}:${d.pokemonId}`) }))
    .sort((a, b) => a.u - b.u || a.i - b.i)
    .slice(0, DRAFT_POOL)
    .map((x) => buildCardFrom(x.d, reg));
  let best: [number, number, number] = [0, 1, 2];
  let bestScore = -1;
  outer: for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      for (let k = j + 1; k < order.length; k++) {
        const a = order[i].card;
        const b = order[j].card;
        const c = order[k].card;
        const distinctChars = a.characterId !== b.characterId && a.characterId !== c.characterId && b.characterId !== c.characterId;
        const distinctPkmn = a.pokemonId !== b.pokemonId && a.pokemonId !== c.pokemonId && b.pokemonId !== c.pokemonId;
        const score = (distinctChars ? 1000 : 0) + (distinctPkmn ? 500 : 0)
          + 100 * coverage([order[i], order[j], order[k]]);
        if (score > bestScore) {
          bestScore = score;
          best = [i, j, k];
          if (score >= MAX_SCORE) break outer;
        }
      }
    }
  }
  return { seed, cards: [order[best[0]].card, order[best[1]].card, order[best[2]].card] };
}

// ---------------------------------------------------------------------------------------------- default registries

export const REGISTRIES: Registries = { nightshades: NIGHTSHADES, partners: PARTNERS };

/** Card for any of the 126 pairs from the designer's registries. */
export function buildCard(duo: Duo): DuoCard {
  return buildCardFrom(duo, REGISTRIES).card;
}

/** The seeded three-card offer (same seed → same offer). */
export function draftOffer(seed: string): DuoOffer {
  return draftOfferFrom(seed, REGISTRIES);
}
