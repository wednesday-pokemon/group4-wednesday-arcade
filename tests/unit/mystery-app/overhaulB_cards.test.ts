// Frontend B — duo cards (UX_OVERHAUL §8), Pause → Controls (§9, R1, R4), results wording, and "no F key cap anywhere
// in the mystery UI" (§12 item 3). Settings are mocked so the components render in node (app/settings.ts touches the
// DOM at import); reduced motion makes the duo cards render settled at once (the slot-machine reveal is skipped).
import { createElement } from 'react';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/app/settings.ts', () => {
  const s = {
    muted: true, reducedMotion: true, highContrast: false, lowGraphics: false, lookSensitivity: 5, invertY: false, crouchToggle: true,
    captionSize: 'normal', showRisk: true, motionPref: 'on',
  };
  return { getSettings: () => s, useSettings: () => s, updateSettings: () => undefined, setMotionPref: () => undefined, VISITOR_DEFAULTS: {} };
});

const { DEFAULT_TUNING } = await import('../../../src/mystery/config.ts');
const { allPairs, buildCard, draftOffer } = await import('../../../src/mystery/draft.ts');
const { combineMods } = await import('../../../src/mystery/stats.ts');
const { NIGHTSHADES } = await import('../../../src/mystery/data/nightshades.ts');
const { PARTNERS } = await import('../../../src/mystery/data/partners.ts');
const { STAY_SILENT_LINE } = await import('../../../src/app/mystery/thingLines.ts');
const {
  duoVitals, NAME_BUDGET_PX, NAME_PX, nameFitOf, offerViews, textWidthPx, vitalsSpeech, vitalsText,
} = await import('../../../src/ui/mystery/duoView.ts');
const { DuoCards } = await import('../../../src/ui/mystery/DuoCards.tsx');
const { MysteryPause } = await import('../../../src/ui/mystery/MysteryPause.tsx');

describe('duo card vitals chip (§8)', () => {
  it('HP and grab cost come from the real tuning with the sim formula round(grab.hpLoss × catchDamageMult)', () => {
    for (const d of allPairs()) {
      const n = NIGHTSHADES[d.characterId as keyof typeof NIGHTSHADES];
      const p = PARTNERS[d.pokemonId as keyof typeof PARTNERS];
      const mods = combineMods(n, p);
      const card = buildCard(d);
      const [v] = offerViews([card, card, card], 'draft');
      expect(v!.vitals).toEqual({ maxHp: DEFAULT_TUNING.player.maxHp, grabHp: Math.round(DEFAULT_TUNING.grab.hpLoss * mods.catchDamageMult), maxCatches: DEFAULT_TUNING.grab.maxCatches });
    }
    expect(duoVitals(buildCard({ characterId: 'bianca', pokemonId: 'gengar' }).mods).grabHp).toBe(42); // Bianca −42
    expect(duoVitals(buildCard({ characterId: 'wednesday', pokemonId: 'gengar' }).mods).grabHp).toBe(35);
  });

  it('copy: "100 HP · grab −35", compact "♥ 100 · −42/grab", SR sentence', () => {
    const v = { maxHp: 100, grabHp: 42, maxCatches: 2 };
    expect(vitalsText(v)).toBe('100 HP · grab −42');
    expect(vitalsText(v, true)).toBe('♥ 100 · −42/grab');
    expect(vitalsSpeech({ maxHp: 100, grabHp: 35, maxCatches: 2 })).toBe('100 HP. A Hyde grab costs 35 HP. Two grabs end the run.');
  });

  it('126-pair header fit (UX_DUO_CARDS §6): "Name’s Pokémon" fits the 275 px name column at 17/15/14 px, never ellipsis', () => {
    let widest = 0;
    const steps = { lg: 0, md: 0, sm: 0 };
    for (const d of allPairs()) {
      const card = buildCard(d);
      const [v] = offerViews([card, card, card], 'draft');
      expect(v!.displayName).toBe(`${NIGHTSHADES[d.characterId as keyof typeof NIGHTSHADES].shortName}’s ${PARTNERS[d.pokemonId as keyof typeof PARTNERS].name}`);
      const fit = nameFitOf(v!.displayName);
      expect(fit, v!.displayName).not.toBeNull();
      expect(v!.nameFit).toBe(fit);
      const w = textWidthPx(v!.displayName, NAME_PX[v!.nameFit], 'display');
      expect(w, v!.displayName).toBeLessThanOrEqual(NAME_BUDGET_PX);
      widest = Math.max(widest, w);
      steps[v!.nameFit] += 1;
    }
    expect(steps.lg).toBeGreaterThan(100); // most names keep the full 17 px
    expect(widest).toBeGreaterThan(240);
    // calibration anchors (output/duo-cards/measure-glyphs.mjs, Chromium): the widest pair at 17 / 15 px Cinzel 700
    expect(Math.abs(textWidthPx('Wednesday’s Galarian Corsola', 17, 'display') - 291.2)).toBeLessThan(4);
    expect(Math.abs(textWidthPx('Wednesday’s Galarian Corsola', 15, 'display') - 257)).toBeLessThan(4);
    expect(nameFitOf('Wednesday’s Galarian Corsola')).toBe('md');
  });

  it('settled cards render the vitals, Q / R key caps and never an F cap; stats + trade-list live in the Details panel', () => {
    const offer = draftOffer('cards1');
    const html = renderToStaticMarkup(createElement(DuoCards, {
      cards: offerViews(offer.cards, 'draft'), stepLabel: 'Step 2 of 3 · Duo', tools: null, onBack: () => undefined, onSelect: () => undefined,
    }));
    expect((html.match(/data-testid="duo-vitals"/g) ?? []).length).toBe(3);
    expect(html.replace(/<[^>]+>/g, '')).toMatch(/100 HP · grab −\d+|♥ 100 · −\d+\/grab/);
    // the vitals' aria-hidden text reads exactly "100 HP · grab −N" (the separator is visually hidden, still in the text)
    const vitals = [...html.matchAll(/data-testid="duo-vitals"><span class="duo-card__vt" aria-hidden="true">(.*?)<\/span><span class="type-disc/g)]
      .map((m) => m[1]!.replace(/<[^>]+>/g, ''));
    expect(vitals).toHaveLength(3);
    for (const t of vitals) expect(t).toMatch(/^100 HP · grab −\d+$/);
    expect(html).toContain('A Hyde grab costs');
    const caps = [...html.matchAll(/<kbd class="kcap">([^<]*)<\/kbd>/g)].map((m) => m[1]);
    expect(caps.filter((k) => k === 'Q')).toHaveLength(3);
    expect(caps.filter((k) => k === 'R')).toHaveLength(3);
    expect(caps).not.toContain('F');
    for (const i of [0, 1, 2]) {
      expect(html).toContain(`data-testid="duo-card-${i}"`);
      expect(html).toContain(`data-testid="btn-select-duo-${i}"`);
      expect(html).toMatch(new RegExp(`<h2 id="duo-${i}-title" class="duo-card__duo`));
      expect(html).toMatch(new RegExp(`data-testid="btn-duo-details-${i}"`));
      // Details is closed by default: the panel (stats + trade list) is in the markup but hidden
      expect(html).toMatch(new RegExp(`<section id="duo-${i}-details" class="duo-card__details" hidden=""`));
    }
    expect((html.match(/aria-expanded="false"/g) ?? []).length).toBe(3);
    expect((html.match(/data-testid="stats"/g) ?? []).length).toBe(3);
    expect((html.match(/data-testid="trade-list"/g) ?? []).length).toBe(3);
    expect((html.match(/class="ability-box ability-box--(power|move)"/g) ?? []).length).toBe(6);
    expect(html).toContain('>Select duo<');
  });
});

describe('Pause → Controls (§9, R1, R4)', () => {
  const html = renderToStaticMarkup(createElement(MysteryPause, {
    tutorial: false, powerName: 'Wolf Shift', moveName: 'Shadow Ball', onResume: async () => true, onSkipTutorial: () => undefined, onLeave: () => undefined,
  }));
  const panel = html.slice(html.indexOf('>', html.indexOf('data-testid="controls-help"')) + 1);

  it('headed by the exact Stay Silent line, then the full KeyLegend from the one control reference', () => {
    expect(STAY_SILENT_LINE).toBe('Stay Silent: Move slowly and avoid making noise — Hydes are sensitive to sound.');
    expect(panel.replace(/<[^>]+>/g, '').startsWith(STAY_SILENT_LINE.replace(/'/g, '&#x27;'))).toBe(true);
    expect(panel).toContain('data-testid="key-legend-full"');
    expect(panel).toMatch(/<kbd class="kcap">Q<\/kbd><\/dt><dd>Wolf Shift/);
    expect(panel).toMatch(/<kbd class="kcap">R<\/kbd><\/dt><dd>Shadow Ball/);
    expect(panel).toContain('>Mute<'); // M only here
  });

  it('never an F cap; Ctrl only under the kiosk keyboard lock (not active here)', () => {
    const caps = [...panel.matchAll(/<kbd class="kcap">([^<]*)<\/kbd>/g)].map((m) => m[1]);
    expect(caps).not.toContain('F');
    expect(caps).not.toContain('Ctrl');
    expect(caps).toEqual(expect.arrayContaining(['W', 'A', 'S', 'D', 'Shift', 'C', 'E', 'Q', 'R', 'Tab', 'V', 'Esc', 'M']));
  });

  it('settings call the switch "Predictions"', () => {
    // the Controls tab is open by default; the settings labels live in the source
    const src = readFileSync('src/ui/mystery/MysteryPause.tsx', 'utf8');
    expect(src).toContain("choice('Predictions', 'showRisk'");
    expect(src).not.toContain("'Risk estimate'");
  });
});

describe('no F key cap anywhere in the mystery UI (§12.3)', () => {
  it('no source renders an F cap or tells players to press F', () => {
    const dirs = ['src/ui/mystery', 'src/ui/mystery/map', 'src/app/mystery'];
    const offenders: string[] = [];
    for (const dir of dirs) {
      for (const f of readdirSync(dir)) {
        if (!/\.(tsx|ts)$/.test(f)) continue;
        const src = readFileSync(join(dir, f), 'utf8');
        if (/<kbd[^>]*>\s*F\s*<\/kbd>/.test(src) || /KeyCap k=["']F["']/.test(src) || /\bPress F\b/.test(src) || /kcap">\{?['"]F['"]\}?</.test(src)) offenders.push(join(dir, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('results panel counts uses with the pressed key (Q / R), never the slot id', () => {
    const src = readFileSync('src/ui/mystery/LayerPanels.tsx', 'utf8');
    expect(src).toContain('ABILITY_KEY_LABEL[slot]');
    expect(src).not.toMatch(/kcap">F</);
    expect(src).toMatch(/'use' : 'uses'/);
  });
});
