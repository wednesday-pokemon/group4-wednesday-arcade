// Thing's prologue (story script v3.2): script content, the auto-advance timeline and suspect neutrality.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  initialPrologue, MISSION_INDEX, PROLOGUE_MISSION, PROLOGUE_PANELS, PROLOGUE_TOTAL_S, prologuePanels, prologueReducer, segmentFill,
  type PrologueAction, type PrologueState,
} from '../../../src/app/mystery/prologue.ts';
import { CASES, POISONED_ARCHIVE } from '../../../src/mystery/data/cases.ts';
import { FIXED_SOLUTIONS as CASE_SOLUTIONS } from '../mystery/fixedSolutions.ts';

const SILENT_EVIDENCE = POISONED_ARCHIVE;
import { draftOffer } from '../../../src/mystery/draft.ts';
import { offerViews } from '../../../src/ui/mystery/duoView.ts';
import { PrologueScene, suspectRole } from '../../../src/ui/mystery/PrologueScenes.tsx';
import { ThingPrologue } from '../../../src/ui/mystery/ThingPrologue.tsx';
import { pickThingArt } from '../../../src/ui/mystery/thingArt.ts';

const run = (s: PrologueState, ...a: PrologueAction[]) => a.reduce(prologueReducer, s);
const tick = (seconds: number): PrologueAction[] => Array.from({ length: Math.round(seconds * 10) }, () => ({ type: 'tick', dt: 0.1 }));
const card = offerViews(draftOffer('prologue').cards, 'draft')[0]!;

describe('prologue script', () => {
  it('six panels, ~30 s in total (20–35 s target), exact Stay Silent warning and mission', () => {
    expect(PROLOGUE_PANELS).toHaveLength(6);
    expect(PROLOGUE_TOTAL_S).toBeGreaterThanOrEqual(20);
    expect(PROLOGUE_TOTAL_S).toBeLessThanOrEqual(35);
    expect(PROLOGUE_PANELS.find((p) => p.id === 'hyde')?.warning).toBe('Stay Silent: Move slowly and avoid making noise — Hydes are sensitive to sound.');
    expect(PROLOGUE_MISSION.join(' ')).toBe('Investigate the Murder. Secure the Egg. Escape Alive.');
  });

  it('covers Orloff, the egg, all three suspects and the Hyde without singling anyone out', () => {
    const all = PROLOGUE_PANELS.map((p) => p.narration).join(' ');
    for (const word of ['Orloff', 'egg', 'Hyde']) expect(all).toContain(word);
    for (const s of SILENT_EVIDENCE.suspects) expect(all.split(s.name)).toHaveLength(2); // each named exactly once
    expect(all).not.toMatch(/culprit|guilty|murderer/i);
  });

  it('panels 2–3 tell the ASSIGNED case only — never another case’s story — and never single out its culprit', () => {
    for (const c of Object.values(CASES)) {
      const panels = prologuePanels(c);
      expect(panels).toHaveLength(6);
      expect(panels[1]!.narration).toBe(c.prologue.death.narration);
      expect(panels[2]!.narration).toBe(c.prologue.egg.narration);
      const text = panels.map((p) => `${p.title} ${p.narration}`).join(' ');
      for (const other of Object.values(CASES)) {
        if (other.id === c.id) continue;
        expect(text).not.toContain(other.prologue.death.narration);
        expect(text).not.toContain(other.title);
      }
      // every suspect named exactly once (panel 4), so the culprit is framed like the others
      const culprit = c.suspects.find((s) => s.id === CASE_SOLUTIONS[c.id].culprit)!;
      for (const s of c.suspects) expect(text.split(s.name)).toHaveLength(2);
      expect(text.split(culprit.name)).toHaveLength(2);
    }
  });
});

describe('prologue timeline', () => {
  it('auto-advances through every panel and stops on the mission card', () => {
    let s = run(initialPrologue(), ...tick(4.9));
    expect(s.index).toBe(0);
    s = run(s, ...tick(0.2));
    expect(s.index).toBe(1);
    s = run(s, ...tick(PROLOGUE_TOTAL_S));
    expect(s.index).toBe(MISSION_INDEX);
    expect(run(s, ...tick(30))).toEqual(s); // waits for "Begin Investigation"
  });

  it('manual navigation pauses auto-advance; Play resumes; Back stops at the first panel', () => {
    let s = run(initialPrologue(), { type: 'next' });
    expect(s).toMatchObject({ index: 1, autoplay: false, elapsedS: 0 });
    expect(run(s, ...tick(20)).index).toBe(1);
    s = run(s, { type: 'toggleAutoplay' }, ...tick(5.1));
    expect(s).toMatchObject({ index: 2, autoplay: true });
    s = run(s, { type: 'back' }, { type: 'back' }, { type: 'back' });
    expect(s).toMatchObject({ index: 0, autoplay: false });
  });

  it('a voice clip holds the panel until it ends; replay restarts from panel 1', () => {
    let s = run(initialPrologue(), { type: 'voice', pending: true }, ...tick(8));
    expect(s.index).toBe(0);
    s = run(s, { type: 'voice', pending: false }, { type: 'tick', dt: 0.1 });
    expect(s.index).toBe(1);
    s = run(s, ...Array.from({ length: 6 }, () => ({ type: 'next' }) as const));
    expect(s.index).toBe(MISSION_INDEX);
    expect(run(s, { type: 'toggleAutoplay' })).toBe(s);
    expect(run(s, { type: 'replay' })).toEqual(initialPrologue());
  });

  it('progress segments fill in order', () => {
    const s = run(initialPrologue(), { type: 'next' }, { type: 'toggleAutoplay' }, ...tick(2.5));
    const [a, b, c] = [0, 1, 2].map((i) => segmentFill(s, i));
    expect(a).toBe(1);
    expect(b).toBeCloseTo(0.5);
    expect(c).toBe(0);
  });
});

describe('prologue view', () => {
  it('three suspect cards framed identically, in case order, with no culprit marker', () => {
    const html = renderToStaticMarkup(createElement(PrologueScene, { id: 'suspects', card, suspects: SILENT_EVIDENCE.suspects }));
    const order = [...html.matchAll(/data-suspect="(\w+)"/g)].map((m) => m[1]);
    expect(order).toEqual(SILENT_EVIDENCE.suspects.map((s) => s.id));
    expect([...html.matchAll(/<li class="([^"]+)"/g)].map((m) => m[1])).toEqual(['suspect-card', 'suspect-card', 'suspect-card']);
    expect(html).not.toContain('(role in this story)');
    expect(suspectRole('Archivist (role in this story)')).toBe('Archivist');
  });

  it('first panel shows the title, the translated-message label, the caption and all controls', () => {
    const html = renderToStaticMarkup(createElement(ThingPrologue, { card, caseDef: SILENT_EVIDENCE, onDone: () => undefined }));
    expect(html).toContain('data-panel="island"');
    expect(html).toContain('The Island, After Dark');
    expect(html).toContain('Thing’s message (translated)');
    expect(html).toContain(PROLOGUE_PANELS[0]!.narration);
    for (const id of ['btn-prologue-back', 'btn-prologue-autoplay', 'btn-prologue-next', 'btn-prologue-skip']) expect(html).toContain(id);
  });

  it('renders the case-specific panel 2 for each case (data-case + its title)', () => {
    for (const c of Object.values(CASES)) {
      const html = renderToStaticMarkup(createElement(PrologueScene, { id: 'death', card, suspects: c.suspects, variant: c.prologue.scene }));
      expect(html).toContain(`data-variant="${c.prologue.scene}"`);
      const screen = renderToStaticMarkup(createElement(ThingPrologue, { card, caseDef: c, onDone: () => undefined }));
      expect(screen).toContain(`data-case="${c.id}"`);
    }
  });

  it('Thing art: prefers a file named thing.*, falls back to the sigil when none is supplied', () => {
    expect(pickThingArt({})).toBeNull();
    expect(pickThingArt({ '../../assets/thing/a.webp': '/a.webp', '../../assets/thing/thing.png': '/thing.png' })).toBe('/thing.png');
    expect(pickThingArt({ '../../assets/thing/hand.jpeg': '/hand.jpeg' })).toBe('/hand.jpeg');
  });
});
