// Analytics v2 HUD markup: numbered layer badges (1 LOG · 2 WHY · 3 Odds · 4 ADVICE, data-layer + aria-label), the
// advice card's Why source and its one "Also considered" line, and the numbered legend chips.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StackView } from '../../../src/app/mystery/hudModel.ts';
import type { OddsV3View } from '../../../src/app/mystery/hud/oddsV3.ts';
import { AnalyticsLegend } from '../../../src/ui/mystery/hud/AnalyticsLegend.tsx';
import { OddsPanel } from '../../../src/ui/mystery/hud/OddsPanel.tsx';
import { ThingStackView } from '../../../src/ui/mystery/hud/ThingStack.tsx';
import { LayerPanels } from '../../../src/ui/mystery/LayerPanels.tsx';
import { createMysteryAnalytics } from '../../../src/mystery/analytics/index.ts';
import { Bot } from '../../../src/mystery/bot.ts';
import { CASES } from '../../../src/mystery/data/cases.ts';
import { MysteryRun } from '../../../src/mystery/run.ts';

const log: StackView = { id: 'l1', kind: 'log', head: "THING'S LOG", text: 'Predicted 60% here: found it ✓', why: null, basis: null, priority: 0 };
const advice: StackView = {
  id: 'a1', kind: 'advice', head: "THING'S ADVICE", text: 'Search the Research Archive.', why: 'Clue chance 60% · Bayesian estimate', basis: null, priority: 2,
  whySource: 'Predictive', alt: 'Also considered: Hide 50 · Keep searching 35',
};
const why: StackView = { id: 'w1', kind: 'why', head: 'HYDE ALERT', text: 'It heard your sprint.', why: null, basis: 'rule', priority: 5 };

describe('analytics v2 HUD', () => {
  it('LOG = 1 Descriptive, ADVICE = 4 Prescriptive with source + Also considered', () => {
    const html = renderToStaticMarkup(createElement(ThingStackView, { log, card: advice }));
    expect(html).toMatch(/data-layer="desc"[^>]*aria-label="Layer 1: Descriptive"[^>]*>1</);
    expect(html).toMatch(/data-layer="presc"[^>]*aria-label="Layer 4: Prescriptive"[^>]*>4</);
    expect(html).toContain('Why: Clue chance 60% · Bayesian estimate');
    expect(html).toMatch(/data-testid="thing-why-source" data-layer="pred"> \(Predictive\)/);
    expect(html).toContain('data-testid="thing-alt"');
    expect(html).toContain('Also considered: Hide 50 · Keep searching 35');
    expect(html).toContain('has-alt');
    expect(html).toContain('Predicted 60% here: found it ✓');
  });

  it('no source / no alternatives → nothing extra; WHY = 2 Diagnostic', () => {
    const plain = renderToStaticMarkup(createElement(ThingStackView, { log: null, card: { ...advice, whySource: null, alt: null } }));
    expect(plain).not.toContain('thing-why-source');
    expect(plain).not.toContain('thing-alt');
    expect(plain).not.toContain('has-alt');
    const w = renderToStaticMarkup(createElement(ThingStackView, { log: null, card: why }));
    expect(w).toMatch(/data-layer="diag"[^>]*aria-label="Layer 2: Diagnostic"[^>]*>2</);
  });

  it('Odds panel title = 3 Predictive; legend chips are numbered 1–4 in the same order', () => {
    const odds = {
      phase: 'find_clues', footer: ['Bayesian estimate'],
      rows: [{ id: 'hyde', tone: 'hyde', kind: 'away', icon: 'hat', label: 'Away', aria: 'Hyde away', cell: null, bar: 0 }],
    } as unknown as OddsV3View;
    const html = renderToStaticMarkup(createElement(OddsPanel, { odds }));
    expect(html).toMatch(/mhud-odds__title"><span[^>]*data-layer="pred"[^>]*aria-label="Layer 3: Predictive"[^>]*>3</);
    const leg = renderToStaticMarkup(createElement(AnalyticsLegend, { variant: 'pause' }));
    expect([...leg.matchAll(/alegend__n" aria-hidden="true">(\d)</g)].map((m) => m[1])).toEqual(['1', '2', '3', '4']);
    expect([...leg.matchAll(/data-layer="(\w+)"/g)].map((m) => m[1])).toEqual(['desc', 'diag', 'pred', 'presc']);
  });

  it('results: predictions line, advice scorecard and "Why you lost points" in the Diagnostic panel (hidden when empty)', () => {
    const run = new MysteryRun({ duo: { characterId: 'enid', pokemonId: 'gengar' }, seed: 'v2-results', tutorial: false, caseDef: CASES.poisoned_archive });
    const a = createMysteryAnalytics(run);
    const bot = new Bot(run, { profile: 'careless', startDelayMaxS: 0 }, 'v2-results');
    while (run.status === 'playing' && run.t < 90) a.frame(run, run.update(1 / 30, bot.decide()));
    a.notePredictionCheck({ t: 10, site: 'egg', siteId: 'a', pct: 60, text: '60%', found: true });
    a.notePredictionCheck({ t: 20, site: 'egg', siteId: 'b', pct: 70, text: '70%', found: false });
    const rep = a.report();
    const base = renderToStaticMarkup(createElement(LayerPanels, { report: rep }));
    expect(base).toContain('Thing’s predictions: 1 of 2 right');
    expect(base).not.toContain('data-testid="points-lost"'); // not finished → no lines
    if (rep.prescriptive.summary.given > 0) expect(base).toMatch(/data-testid="results-advice-card".*Followed \d+ of \d+ tip/);
    else expect(base).toContain('data-testid="presc-summary"');
    const html = renderToStaticMarkup(createElement(LayerPanels, { report: { ...rep, diagnostic: { ...rep.diagnostic, pointsLost: [{ pts: 75, text: 'Slurp hit at 2:10 (you were sprinting)' }] } } }));
    expect(html).toMatch(/data-testid="points-lost".*Why you lost points.*−75.*Slurp hit at 2:10 \(you were sprinting\)/);
    expect(html).toMatch(/data-kind="points" data-drop="100"/);
    const none = renderToStaticMarkup(createElement(LayerPanels, { report: { ...rep, predictive: { ...rep.predictive, checks: [] } } }));
    expect(none).not.toContain('results-predictions');
  }, 30_000);
});
