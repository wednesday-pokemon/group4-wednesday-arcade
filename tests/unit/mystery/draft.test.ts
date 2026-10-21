import { describe, expect, it } from 'vitest';
import { allPairs, buildCard, coverage, draftOffer, buildCardFrom, REGISTRIES, CATEGORIES, CARD_LINE_MAX, lineFields, lineTopics } from '../../../src/mystery/draft.ts';
import { combineMods, duoStats, NEUTRAL_MODS, toStat } from '../../../src/mystery/stats.ts';
import { MYSTERY_TUNING } from '../../../src/mystery/data/tuning.ts';
import type { AbilityDef, DuoStats, PlayMods } from '../../../src/mystery/types.ts';

const STAT_KEYS: (keyof DuoStats)[] = ['investigation', 'stealth', 'mobility', 'defense', 'hydeControl', 'eggProtection'];
const SEEDS = Array.from({ length: 400 }, (_, i) => `seed-${i}-${(i * 2654435761) >>> 0}`);

describe('cards for all 126 pairs', () => {
  const pairs = allPairs();

  it('there are exactly 126 pairs and every one builds a truthful card', () => {
    expect(pairs).toHaveLength(126);
    for (const duo of pairs) {
      const card = buildCard(duo);
      for (const k of STAT_KEYS) {
        expect(Number.isInteger(card.stats[k])).toBe(true);
        expect(card.stats[k]).toBeGreaterThanOrEqual(1);
        expect(card.stats[k]).toBeLessThanOrEqual(5);
      }
      expect(card.advantages).toHaveLength(2);
      expect(card.disadvantages.length).toBeGreaterThanOrEqual(1);
      expect(card.disadvantages.length).toBeLessThanOrEqual(2);
      const n = REGISTRIES.nightshades[duo.characterId];
      const p = REGISTRIES.partners[duo.pokemonId];
      // every line is a registry line verbatim, or a restated passive modifier, or a real ability cost
      const restated = (t: string) => lineFields(t, card.mods, '\u0000').length > 0 || /is heard ~\d+ m away$|recharges in \d+ s$/.test(t);
      for (const a of card.advantages) expect([...n.advantages, ...p.advantages].includes(a) || restated(a), a).toBe(true);
      for (const d of card.disadvantages) expect([...n.disadvantages, ...p.disadvantages].includes(d) || restated(d), d).toBe(true);
      expect([...n.roleTags, ...p.roleTags, 'investigation', 'stealth', 'mobility', 'control', 'defense', 'support']).toContain(card.role);
      expect(card.mods).toEqual(combineMods(n, p));
      expect(card.duoName.length).toBeGreaterThan(4);
    }
  });

  it('combined mods are clamped to modsClamp', () => {
    const { min, max } = MYSTERY_TUNING.modsClamp;
    const fake = combineMods({ mods: { ...NEUTRAL_MODS, walkSpeedMult: 1.3 } }, { mods: { walkSpeedMult: 1.3, catchDamageMult: 0.5 } });
    expect(fake.walkSpeedMult).toBe(max);
    expect(fake.catchDamageMult).toBe(Math.max(min, 0.5));
  });

  it('scale "1 low · 3 typical · 5 high": a neutral duo is 3 (Hyde Control 1 = no control); anchors 1 and 5 reachable', () => {
    const none: AbilityDef = { id: 'none', name: 'none', key: 'Q', cooldownS: 30, noise: 0, effects: [], text: '' };
    const neutral = duoStats(NEUTRAL_MODS, { ...none, key: 'F' }, none);
    expect(neutral).toEqual({ investigation: 3, stealth: 3, mobility: 3, defense: 3, hydeControl: 1, eggProtection: 3 });
    expect(toStat(0, 0.3)).toBe(1);
    expect(toStat(0.3, 0.3)).toBe(3);
    expect(toStat(1, 0.3)).toBe(5);
    expect(toStat(0, 0)).toBe(1);
    expect(toStat(1, 0)).toBe(5);
    for (let x = 0; x < 1; x += 0.01) expect(toStat(x + 0.01, 0.3)).toBeGreaterThanOrEqual(toStat(x, 0.3));
    expect(buildCard({ characterId: 'wednesday', pokemonId: 'aegislash' }).stats.investigation).toBe(5);
    expect(buildCard({ characterId: 'morticia', pokemonId: 'aegislash' }).stats.stealth).toBeGreaterThanOrEqual(4);
  });

  it('stats are monotone in the underlying mods (all 126 pairs, each mod nudged both ways)', () => {
    const better: Record<keyof DuoStats, [keyof PlayMods, -1 | 1][]> = {
      investigation: [['interactTimeMult', -1]],
      stealth: [['footstepNoiseMult', -1]],
      mobility: [['walkSpeedMult', 1], ['sprintSpeedMult', 1]],
      defense: [['catchDamageMult', -1]],
      hydeControl: [['hydeEffectDurationMult', 1]],
      eggProtection: [['eggSecurityLossMult', -1]],
    };
    for (const duo of pairs) {
      const n = REGISTRIES.nightshades[duo.characterId];
      const p = REGISTRIES.partners[duo.pokemonId];
      const mods = combineMods(n, p);
      const base = duoStats(mods, n.power, p.move);
      for (const k of STAT_KEYS) {
        for (const [mod, dir] of better[k]) {
          for (const step of [0.05, 0.15, 0.3]) {
            const improved = duoStats({ ...mods, [mod]: mods[mod] * (1 + dir * step) }, n.power, p.move);
            const worse = duoStats({ ...mods, [mod]: mods[mod] * (1 - dir * step) }, n.power, p.move);
            expect(improved[k]).toBeGreaterThanOrEqual(base[k]);
            expect(worse[k]).toBeLessThanOrEqual(base[k]);
          }
        }
      }
    }
  });

  it('stats are not all identical: every stat takes ≥ 3 distinct values across the roster', () => {
    for (const k of STAT_KEYS) {
      const vals = new Set(pairs.map((d) => buildCard(d).stats[k]));
      expect(vals.size, k).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('draftOffer', () => {
  it('exactly 3 cards, no duplicate pair, deterministic per seed', () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const a = draftOffer(seed);
      const b = draftOffer(seed);
      expect(a).toEqual(b);
      expect(a.seed).toBe(seed);
      expect(a.cards).toHaveLength(3);
      const keys = new Set(a.cards.map((c) => `${c.characterId}|${c.pokemonId}`));
      expect(keys.size).toBe(3);
    }
  });

  it('different seeds give different offers (not hard-coded)', () => {
    const offers = new Set(SEEDS.map((s) => draftOffer(s).cards.map((c) => `${c.characterId}|${c.pokemonId}`).sort().join(',')));
    expect(offers.size).toBeGreaterThan(SEEDS.length * 0.95);
  });

  it('distinct characters AND Pokémon, and full role-category coverage in (nearly) every offer', () => {
    let distinct = 0;
    let fullCoverage = 0;
    for (const seed of SEEDS) {
      const o = draftOffer(seed);
      const chars = new Set(o.cards.map((c) => c.characterId));
      const mons = new Set(o.cards.map((c) => c.pokemonId));
      if (chars.size === 3 && mons.size === 3) distinct++;
      const cats = o.cards.map((c) => buildCardFrom(c, REGISTRIES));
      if (coverage(cats) === 3) fullCoverage++;
    }
    expect(distinct).toBe(SEEDS.length);
    expect(fullCoverage / SEEDS.length).toBeGreaterThanOrEqual(0.95);
  });

  it('spreads across the roster: every character and every Pokémon appears in some offer', () => {
    const chars = new Set<string>();
    const mons = new Set<string>();
    const pairCount = new Map<string, number>();
    for (const seed of SEEDS) {
      for (const c of draftOffer(seed).cards) {
        chars.add(c.characterId);
        mons.add(c.pokemonId);
        const k = `${c.characterId}|${c.pokemonId}`;
        pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
      }
    }
    expect(chars.size).toBe(7);
    expect(mons.size).toBe(18);
    // no pair dominates (uniform would be 400 × 3 / 126 ≈ 9.5)
    expect(Math.max(...pairCount.values())).toBeLessThan(25);
    expect(pairCount.size).toBeGreaterThan(100);
    expect(CATEGORIES).toHaveLength(3);
  });
});

describe('card trade-off lines', () => {
  it('no card has two lines about the same modifier; lines are truthful for the combined mods; copy budget', () => {
    for (const duo of allPairs()) {
      const card = buildCard(duo);
      const n = REGISTRIES.nightshades[duo.characterId];
      const p = REGISTRIES.partners[duo.pokemonId];
      expect(card.advantages).toHaveLength(2);
      expect(card.disadvantages.length).toBeGreaterThanOrEqual(1);
      expect(card.disadvantages.length).toBeLessThanOrEqual(2);
      const seen = new Set<string>();
      const lines = [...card.advantages.map((t) => ({ t, good: true })), ...card.disadvantages.map((t) => ({ t, good: false }))];
      for (const { t, good } of lines) {
        expect(t.length, t).toBeLessThanOrEqual(CARD_LINE_MAX);
        // verbatim lines are classified like the sim does (owning member's mods + ability name); restated ones
        // against the combined mods
        const owner = [...n.advantages, ...n.disadvantages].includes(t) ? { mods: n.mods, ab: n.power.name }
          : [...p.advantages, ...p.disadvantages].includes(t) ? { mods: p.mods, ab: p.move.name }
          : { mods: card.mods, ab: '\u0000' };
        const fields = lineFields(t, owner.mods, owner.ab);
        for (const f of lineTopics(fields)) {
          expect(seen.has(f), `${duo.characterId}+${duo.pokemonId}: two lines about ${f}: ${JSON.stringify(lines)}`).toBe(false);
          seen.add(f);
        }
        // truthfulness: a line about a modifier sits on the side the combined modifier really falls
        for (const f of fields) {
          const v = f === 'sprintSpeedMult' && !fields.includes('walkSpeedMult') ? card.mods.walkSpeedMult * card.mods.sprintSpeedMult : card.mods[f];
          const up = f === 'walkSpeedMult' || f === 'sprintSpeedMult' || f === 'hydeEffectDurationMult';
          expect((up ? v > 1 : v < 1), `${duo.characterId}+${duo.pokemonId} "${t}"`).toBe(good);
        }
      }
      expect(new Set(lines.map((l) => l.t)).size).toBe(lines.length);
    }
  });

  it('Enid × Dragapult states ONE combined footstep line (1.15 × 1.05 ≈ 21% louder)', () => {
    const card = buildCard({ characterId: 'enid', pokemonId: 'dragapult' });
    const foot = [...card.advantages, ...card.disadvantages].filter((t) => /^Footsteps/.test(t));
    expect(foot).toEqual(['Footsteps ~21% louder']);
  });
});
