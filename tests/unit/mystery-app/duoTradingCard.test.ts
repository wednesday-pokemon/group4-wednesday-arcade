// Duo trading cards (docs/overhaul/UX_DUO_CARDS.md): view-model rules over all 126 pairs — short ability lines never
// invent a value and fit their width, the type theme covers every partner type, the strengths / weakness strip follows
// §5 and fits, set numbers are unique, and the Details panel / D key / Esc order in the rendered markup.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/app/settings.ts', () => {
  const s = {
    muted: true, reducedMotion: true, highContrast: false, lowGraphics: false, lookSensitivity: 5, invertY: false, crouchToggle: true,
    captionSize: 'normal', showRisk: true, motionPref: 'on',
  };
  return { getSettings: () => s, useSettings: () => s, updateSettings: () => undefined, setMotionPref: () => undefined, VISITOR_DEFAULTS: {} };
});

const { allPairs, buildCard, draftOffer } = await import('../../../src/mystery/draft.ts');
const { NIGHTSHADES } = await import('../../../src/mystery/data/nightshades.ts');
const { PARTNERS } = await import('../../../src/mystery/data/partners.ts');
const V = await import('../../../src/ui/mystery/duoView.ts');
const { DuoCards } = await import('../../../src/ui/mystery/DuoCards.tsx');
type Stats = import('../../../src/mystery/types.ts').DuoStats;

const NIGHTSHADE_LIST = Object.values(NIGHTSHADES);
const PARTNER_LIST = Object.values(PARTNERS);

/** Relative luminance / contrast ratio (WCAG). */
function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

describe('short ability lines (§4)', () => {
  it('every Nightshade power and every Pokémon move has a hand-written short line', () => {
    for (const n of NIGHTSHADE_LIST) expect(V.POWER_SHORT[n.id], n.id).toBeTruthy();
    for (const p of PARTNER_LIST) expect(V.MOVE_SHORT[p.id], p.id).toBeTruthy();
  });

  it('no data value invented: every number in a short line appears in that ability\'s full data text', () => {
    const check = (short: string, full: string, who: string) => {
      const have = new Set(V.numbersIn(full));
      for (const n of V.numbersIn(short)) expect(have.has(n), `${who}: "${n}" in "${short}" not in "${full}"`).toBe(true);
    };
    for (const n of NIGHTSHADE_LIST) check(V.POWER_SHORT[n.id]!, n.power.text, n.id);
    for (const p of PARTNER_LIST) check(V.MOVE_SHORT[p.id]!, p.move.text, p.id);
  });

  it('"silent" only where the data says Silent, and LOUD comes from the data noise (≥ 0.5)', () => {
    for (const n of NIGHTSHADE_LIST) {
      if (/silent/i.test(V.POWER_SHORT[n.id]!)) expect(n.power.noise, n.id).toBe(0);
    }
    const card = buildCard({ characterId: 'gomez', pokemonId: 'gholdengo' });
    const [v] = V.offerViews([card, card, card], 'draft');
    expect(v!.power.loud).toBe(true); // Electric Spark, noise .8
    expect(v!.move.loud).toBe(true); // Make It Rain, noise .5
  });

  it('effect lines fit one line at 15 px (≤ 296 px, ≤ 246 px after the LOUD tag); line 1 (glyph, cap, name, badge) ≤ 300 px', () => {
    const abilities = [...NIGHTSHADE_LIST.map((n) => ({ def: n.power, short: V.POWER_SHORT[n.id]!, adapt: !!n.power.adaptationNote })),
      ...PARTNER_LIST.map((p) => ({ def: p.move, short: V.MOVE_SHORT[p.id]!, adapt: true }))];
    let widest = 0;
    for (const { def, short, adapt } of abilities) {
      const loud = def.noise >= 0.5;
      const w = V.textWidthPx(short, V.EFFECT_PX, 'regular');
      widest = Math.max(widest, w);
      expect(w, short).toBeLessThanOrEqual(loud ? V.EFFECT_BUDGET_LOUD_PX : V.EFFECT_BUDGET_PX);
      // line 1: icons column 48 + gap 6 + name (Alegreya 700 17 px) + gap 6 + badge (14 px text + 12 padding + 2 border)
      const line1 = 48 + 6 + V.textWidthPx(def.name, 17, 'bold') + (adapt ? 6 + V.textWidthPx('Game adaptation', 14, 'regular') + 14 : 0);
      expect(line1, def.name).toBeLessThanOrEqual(300);
    }
    expect(widest).toBeGreaterThan(200); // the estimate is real
  });

  it('fallback = the full text up to its first sentence break (decimals are not breaks)', () => {
    expect(V.shortFallback('Petrify a Hyde you face (12 m, 40° cone) for 2.5 s. Walls block the gaze.')).toBe('Petrify a Hyde you face (12 m, 40° cone) for 2.5 s');
    expect(V.shortFallback('Near the gate switch: opens the Shortcut.')).toBe('Near the gate switch');
    expect(V.shortFallback('Bursts ahead; staggers')).toBe('Bursts ahead');
    expect(V.shortFallback(null)).toBeNull();
  });
});

describe('type theme (§3)', () => {
  it('covers every Pokémon type in the registry; theme = first non-Ghost type, pure Ghost = Ghost', () => {
    for (const p of PARTNER_LIST) {
      for (const t of p.types) expect(V.themeKeyOf(t), `${p.id}: ${t}`).not.toBeNull();
      const expected = p.types.find((t) => t !== 'Ghost')?.toLowerCase() ?? 'ghost';
      expect(V.themeTypeOf(p.types), p.id).toBe(expected);
    }
    expect(V.themeTypeOf(['Ghost', 'Poison'])).toBe('poison');
    expect(V.themeTypeOf(['Fire', 'Ghost'])).toBe('fire');
    expect(V.themeTypeOf(['Ghost'])).toBe('ghost');
  });

  it('face text contrast: ivory ≥ 4.5:1 on both face stops, ink glyph ≥ 5:1 on every accent; no red hue', () => {
    for (const [k, th] of Object.entries(V.TYPE_THEME)) {
      expect(contrast('#f3ecdc', th.top), `${k} top`).toBeGreaterThanOrEqual(4.5);
      expect(contrast('#d4cbb5', th.top), `${k} secondary`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(V.TYPE_INK, th.accent), `${k} accent`).toBeGreaterThanOrEqual(5);
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(th.accent.slice(i, i + 2), 16));
      expect(r! > 180 && g! < 90 && b! < 90, `${k} accent is red`).toBe(false);
    }
  });

  it('view: themeType, Ghost secondary disc, types caption, identity without the parenthesis', () => {
    const card = buildCard({ characterId: 'gomez', pokemonId: 'alolan_marowak' });
    const [v] = V.offerViews([card, card, card], 'draft');
    expect(v!.themeType).toBe('fire');
    expect(v!.ghostSecondary).toBe(true);
    expect(v!.typesLabel).toBe('Fire / Ghost');
    expect(v!.identityShort).toBe('Electricity');
    const pure = buildCard({ characterId: 'bianca', pokemonId: 'misdreavus' });
    const [w] = V.offerViews([pure, pure, pure], 'draft');
    expect(w!.themeType).toBe('ghost');
    expect(w!.ghostSecondary).toBe(false);
    expect(w!.displayName).toBe('Bianca’s Misdreavus');
  });
});

describe('strengths / weakness strip (§5)', () => {
  const S = (o: Partial<Stats>): Stats => ({ investigation: 3, stealth: 3, mobility: 3, defense: 3, hydeControl: 3, eggProtection: 3, ...o });

  it('strengths = stats ≥ 4 by value, then best-of-three, then STAT_ROWS order, max two', () => {
    expect(V.strengthsOf(S({ stealth: 4, investigation: 5, mobility: 4 }), []).map((s) => s.key)).toEqual(['investigation', 'stealth']);
    // tie at 4: best-of-three first
    expect(V.strengthsOf(S({ stealth: 4, mobility: 4 }), ['mobility']).map((s) => [s.key, s.best])).toEqual([['mobility', true], ['stealth', false]]);
    // tie at 4, no best: STAT_ROWS order
    expect(V.strengthsOf(S({ eggProtection: 4, defense: 4, hydeControl: 4 }), []).map((s) => s.key)).toEqual(['defense', 'hydeControl']);
  });

  it('no stat ≥ 4 → the single highest (same tie order)', () => {
    expect(V.strengthsOf(S({}), []).map((s) => s.key)).toEqual(['investigation']);
    expect(V.strengthsOf(S({ mobility: 3, hydeControl: 3, investigation: 2 }), ['hydeControl']).map((s) => s.key)).toEqual(['hydeControl']);
    expect(V.strengthsOf(S({ investigation: 2, stealth: 2, mobility: 3 }), [])).toHaveLength(1);
  });

  it('weakness = the lowest stat when ≤ 2 (first in STAT_ROWS order), else Balanced', () => {
    expect(V.weaknessOf(S({ defense: 1, mobility: 2 }))?.label).toBe('Defense');
    expect(V.weaknessOf(S({ mobility: 2, defense: 2 }))?.key).toBe('mobility');
    expect(V.weaknessOf(S({}))).toBeNull();
    expect(V.stripLines({ strengths: [], weakness: null }).con).toBe('Balanced — no stat below 3');
    expect(V.stripLines({ strengths: [], weakness: { key: 'defense', label: 'Defense', value: 1, best: false } }).con).toBe('Low Defense');
  });

  it('every offer view derives the strip from its absolute stats + best-of-three, and both lines fit (126 pairs)', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const offer = draftOffer(seed);
      for (const [i, v] of V.offerViews(offer.cards, 'draft').entries()) {
        expect(v.strengths).toEqual(V.strengthsOf(offer.cards[i]!.stats, v.best));
        expect(v.weakness).toEqual(V.weaknessOf(offer.cards[i]!.stats));
        for (const s of v.strengths) expect(s.best).toBe(v.best.includes(s.key));
      }
    }
    let widest = 0;
    for (const d of allPairs()) {
      const card = buildCard(d);
      // worst case for the ▲ marks: pretend every strength is also best-of-three
      const best = V.STAT_ROWS.map((r) => r.key);
      const v = { strengths: V.strengthsOf(card.stats, best), weakness: V.weaknessOf(card.stats) };
      expect(v.strengths.length).toBeGreaterThanOrEqual(1);
      expect(v.strengths.length).toBeLessThanOrEqual(2);
      const w = V.stripWidthsPx(v);
      widest = Math.max(widest, w.pro, w.con);
      expect(w.pro, `${d.characterId}+${d.pokemonId}`).toBeLessThanOrEqual(V.STRIP_BUDGET_PX);
      expect(w.con, `${d.characterId}+${d.pokemonId}`).toBeLessThanOrEqual(V.STRIP_BUDGET_PX);
    }
    expect(widest).toBeGreaterThan(150);
  });
});

describe('flavour + rendered card', () => {
  it('set numbers are unique "NNN/126" over all pairs', () => {
    const nums = allPairs().map((d) => V.setNumberOf(d));
    expect(new Set(nums).size).toBe(126);
    expect(nums[0]).toBe('001/126');
    expect(nums[125]).toBe('126/126');
  });

  it('settled markup: trading-card anatomy, type theme on the root, cooldown labels, closed Details per card', () => {
    const offer = draftOffer('cards1');
    const views = V.offerViews(offer.cards, 'draft');
    const html = renderToStaticMarkup(createElement(DuoCards, {
      cards: views, stepLabel: 'Step 2 of 3 · Duo', tools: null, onBack: () => undefined, onSelect: () => undefined,
    }));
    for (const v of views) {
      const th = V.TYPE_THEME[v.themeType];
      expect(html).toContain(`data-type="${v.themeType}"`);
      expect(html).toContain(`--type-face-top:${th.top};--type-face-bottom:${th.bottom};--type-accent:${th.accent}`);
      expect(html).toContain(`>${v.displayName.replace(/’/g, '’')}</h2>`);
      expect(html).toContain(`aria-label="cooldown ${Math.round(v.power.cooldownS!)} seconds"`);
      expect(html).toContain(`aria-label="cooldown ${Math.round(v.move.cooldownS!)} seconds"`);
      expect(html).toContain(`Nevermore · ${v.setNumber}`);
      expect(html).toContain(v.move.short!.replace(/’/g, '’'));
    }
    expect((html.match(/class="duo-card(?: |")/g) ?? []).length).toBe(3);
    expect((html.match(/data-slot-phase="settled"/g) ?? []).length).toBe(3);
    expect(html).toContain('Game adaptation');
    expect(html).toContain('<kbd>D</kbd> details');
    expect(html).toContain('Three duos were drawn for you.');
  });
});
