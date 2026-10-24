// ThingStack slot rules (UX_OVERHAUL §6), the hint ladder timer (§5 / R7), the one control reference + Q/R/F mapping
// (§9 / R4), onboarding copy (R1), clue-card copy, and a static render of the new HUD (no F key cap anywhere).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ThingStack, type StackItem } from '../../../src/app/mystery/hud/thingStack.ts';
import { HintLadder, ladderPaused } from '../../../src/app/mystery/hud/hintLadder.ts';
import { EDGE_BY_CODE, GAME_CODES, MysteryInputController } from '../../../src/app/mystery/input.ts';
import { LOCK_CODES } from '../../../src/app/mystery/kiosk.ts';
import { clueCardContent, objectiveText, OBJECTIVE_TEXT, promptView, type MysteryHudModel } from '../../../src/app/mystery/hudModel.ts';
import { STAY_SILENT_LINE } from '../../../src/app/mystery/thingLines.ts';
import { abilityKey, CONTROLS, controlRows, KeyLegend } from '../../../src/ui/mystery/controls.tsx';
import { buildSteps, TUTORIAL_HEADLINES } from '../../../src/ui/mystery/MysteryTutorial.tsx';
import { MysteryHud } from '../../../src/ui/mystery/MysteryHud.tsx';
import { CASES } from '../../../src/mystery/data/cases.ts';
import { ABILITY_KEY_LABEL } from '../../../src/mystery/types.ts';
import type { MysteryRunLike } from '../../../src/app/mystery/runTypes.ts';

const item = (over: Partial<StackItem> & Pick<StackItem, 'id' | 'kind'>): StackItem => ({ head: over.kind === 'log' ? "THING'S LOG" : over.kind === 'why' ? 'HYDE ALERT' : "THING'S ADVICE", text: over.id, priority: 2, t: 0, ...over });

describe('ThingStack (one card + one log line)', () => {
  it('log: own slot, 3.5 s, ≥ 2.5 s apart, latest waiting line wins', () => {
    const s = new ThingStack();
    s.push(item({ id: 'a', kind: 'log', priority: 0 }), 0);
    expect(s.update(0).log?.item.id).toBe('a');
    s.push(item({ id: 'b', kind: 'log', priority: 0 }), 0.5);
    s.push(item({ id: 'c', kind: 'log', priority: 0 }), 1);
    expect(s.update(1).log?.item.id).toBe('a');
    expect(s.update(2.5).log?.item.id).toBe('c'); // b was replaced by c (latest wins)
    expect(s.update(6.1).log).toBeNull();
  });

  it('cards: ≤ 1 visible, equal priority waits, 1.5 s gap, durations WHY 4.5 / ADVICE 6', () => {
    const s = new ThingStack();
    s.push(item({ id: 'w1', kind: 'why', priority: 3, t: 0 }), 0);
    s.push(item({ id: 'adv', kind: 'advice', priority: 2, t: 0 }), 0);
    expect(s.update(0).card?.item.id).toBe('w1');
    expect(s.update(4).card?.item.id).toBe('w1');
    expect(s.update(4.5).card).toBeNull(); // WHY 4.5 s, then the 1.5 s gap
    expect(s.update(5.9).card).toBeNull();
    expect(s.update(6).card?.item.id).toBe('adv');
    expect(s.update(11.9).card?.item.id).toBe('adv');
    expect(s.update(12).card).toBeNull(); // ADVICE 6 s
  });

  it('higher priority pre-empts only after the 1.2 s minimum; P5 needs no gap; queue length 2', () => {
    const s = new ThingStack();
    s.push(item({ id: 'routine', kind: 'advice', priority: 2, t: 0 }), 0);
    s.update(0);
    s.push(item({ id: 'alert', kind: 'why', priority: 5, t: 0.5 }), 0.5);
    expect(s.update(0.5).card?.item.id).toBe('routine'); // held ≥ 1.2 s
    expect(s.update(1.2).card?.item.id).toBe('alert');
    for (const id of ['q1', 'q2', 'q3']) s.push(item({ id, kind: 'advice', priority: 1, t: 1.3 }), 1.3);
    expect(s.queued.length).toBe(2);
  });

  it('a WHY older than 4 s when its turn comes is dropped', () => {
    const s = new ThingStack();
    s.push(item({ id: 'long', kind: 'advice', priority: 4, t: 0 }), 0);
    s.update(0);
    s.push(item({ id: 'stale', kind: 'why', priority: 1, t: 0.2 }), 0.2);
    expect(s.update(6).card).toBeNull(); // advice ended at 6
    expect(s.update(7.6).card).toBeNull(); // the WHY waited 7.4 s → dropped
    expect(s.queued.length).toBe(0);
  });

  it('nothing automatic while blocked (tutorial, ClueCard, overlays) — V-requested items still show', () => {
    const s = new ThingStack();
    s.push(item({ id: 'auto', kind: 'advice', priority: 2, t: 0 }), 0);
    expect(s.update(0, true).card).toBeNull();
    s.push(item({ id: 'asked', kind: 'advice', priority: 4, t: 0.1, auto: false }), 0.1);
    expect(s.update(0.1, true).card?.item.id).toBe('asked');
    expect(s.history.map((h) => h.text)).toEqual(['asked']);
  });
});

describe('V during a threat (code review: cooldown + no stacking)', () => {
  it('a threat answer starts the same 10 s cooldown and leaves the ladder level alone', () => {
    const l = new HintLadder();
    expect(l.press(0, true)).toEqual({ kind: 'advice' });
    expect(l.level).toBe(0);
    for (const t of [0.2, 1, 5, 9.9]) expect(l.press(t, true)).toBeNull(); // mashing V does nothing
    expect(l.cooldownLeftS(5)).toBe(5);
    expect(l.press(10, false)).toEqual({ kind: 'level', level: 1 }); // after the cooldown, outside a threat: L1
    expect(l.press(15, false)).toBeNull();
  });

  it('the stack never queues the same card twice, nor a copy of the card on screen', () => {
    const s = new ThingStack();
    const adv = (t: number, priority = 4) => item({ id: `v${t}`, kind: 'advice', text: 'Hide behind the pillar.', priority, t, auto: false });
    s.push(item({ id: 'other', kind: 'why', priority: 5, t: 0 }), 0);
    s.update(0);
    for (const t of [0.1, 0.2, 0.3]) s.push(adv(t), t);
    expect(s.queued.filter((q) => q.text === 'Hide behind the pillar.')).toHaveLength(1);
    s.update(4.6); // the alert ends; the V answer shows
    expect(s.card?.item.text).toBe('Hide behind the pillar.');
    s.push(adv(5), 5); // the same text again while it is on screen
    expect(s.queued).toHaveLength(0);
    // a later explicit V may repeat the same advice once it is gone (automatic repeats stay suppressed for 30 s)
    s.update(10.7);
    s.push(adv(12), 12);
    expect(s.queued).toHaveLength(1);
    s.push(item({ id: 'auto', kind: 'advice', text: 'Search the Records Crypt.', priority: 2, t: 12 }), 12);
    s.push(item({ id: 'auto2', kind: 'advice', text: 'Search the Records Crypt.', priority: 2, t: 12.5 }), 12.5);
    expect(s.queued.filter((q) => q.text === 'Search the Records Crypt.')).toHaveLength(1);
  });

  it('the idle ladder pauses during holds (search, egg, examine, lever), SEARCH / CHASE, and outside play', () => {
    const base = { status: 'playing', emerged: true, hydeMode: 'PATROL', objective: 'find_clues', interacting: null };
    expect(ladderPaused(base)).toBe(false);
    for (const target of ['clue', 'egg', 'examine', 'lever']) expect(ladderPaused({ ...base, interacting: { target } })).toBe(true);
    expect(ladderPaused({ ...base, hydeMode: 'SEARCH' })).toBe(true);
    expect(ladderPaused({ ...base, hydeMode: 'CHASE' })).toBe(true);
    expect(ladderPaused({ ...base, emerged: false, hydeMode: 'CHASE' })).toBe(false); // dormant: no Hyde to fear
    expect(ladderPaused({ ...base, objective: 'deliver_egg' })).toBe(true);
    expect(ladderPaused({ ...base, status: 'tutorial' })).toBe(true);
  });
});

describe('hint ladder (idle 40 / 80 / 120 s, V jumps one level, 10 s cooldown)', () => {
  it('reaches L1/L2/L3 at 40/80/120 s of no progress; pauses; resets on progress', () => {
    const l = new HintLadder();
    const hits: number[] = [];
    for (let i = 0; i < 1310; i++) {
      const r = l.tick(0.1, i >= 500 && i < 600); // 10 s paused (SEARCH / CHASE / overlay)
      if (r) hits.push(Math.round(l.idleS));
    }
    expect(hits).toEqual([40, 80, 120]);
    l.progress();
    expect(l.level).toBe(0);
    expect(l.tick(39, false)).toBeNull();
    expect(l.tick(1, false)).toBe(1);
  });

  it('V climbs one level per press, L3 repeats, 10 s cooldown', () => {
    const l = new HintLadder();
    expect(l.request(0)).toBe(1);
    expect(l.request(5)).toBeNull();
    expect(l.cooldownLeftS(5)).toBe(5);
    expect(l.request(10)).toBe(2);
    expect(l.request(20)).toBe(3);
    expect(l.request(30)).toBe(3);
    // the idle timer does not re-announce a level V already reached
    expect(l.tick(1, false)).toBeNull();
  });
});

describe('controls: Q power, R move, F silent alias (R4)', () => {
  const prefs = { sensitivity: 5, invertY: false, crouchToggle: false };
  it('maps keys to the sim edges: Q / F → power (slot F), R → move (slot Q), E, V', () => {
    expect(EDGE_BY_CODE).toMatchObject({ KeyQ: 'power', KeyF: 'power', KeyR: 'move', KeyE: 'interact', KeyV: 'hint' });
    const c = new MysteryInputController(prefs);
    c.keyDown('KeyQ');
    expect(c.consume(0.016)).toMatchObject({ power: true, move: false });
    c.keyDown('KeyR');
    expect(c.consume(0.016)).toMatchObject({ power: false, move: true });
    c.keyDown('KeyF');
    expect(c.consume(0.016)).toMatchObject({ power: true, move: false });
    expect(GAME_CODES.has('KeyR')).toBe(true);
    expect(LOCK_CODES).toContain('KeyR');
  });

  it('one reference: ABILITY_KEY_LABEL caps, no F anywhere, M only in Pause (full), Ctrl only under the keyboard lock', () => {
    expect(abilityKey('F')).toBe(ABILITY_KEY_LABEL.F);
    expect(abilityKey('Q')).toBe(ABILITY_KEY_LABEL.Q);
    for (const variant of ['card', 'full', 'strip', 'inline'] as const) {
      for (const ctrl of [false, true]) {
        const rows = controlRows(variant, { power: 'Wolf Shift', move: 'Shadow Ball', ctrlCrouch: ctrl });
        const caps = rows.flatMap((r) => r.keys);
        expect(caps).not.toContain('F');
        if (variant !== 'full') expect(caps).not.toContain('M');
        expect(caps.includes('Ctrl')).toBe(ctrl && rows.some((r) => r.id === 'crouch'));
      }
    }
    expect(controlRows('full').flatMap((r) => r.keys)).toContain('M');
    // UX_FINAL §0: the strip reads "Tab Evidence · X Map · Esc Pause"; V (Ask Weems, −50) lives in Pause + the Weems button
    expect(controlRows('strip').map((r) => `${r.keys[0]} ${r.label}`)).toEqual(['Tab Evidence', 'X Map', 'Esc Pause']);
    expect(controlRows('full').find((r) => r.id === 'hint')).toMatchObject({ keys: ['V'], label: 'Ask Weems (−50)' });
    expect(controlRows('full').find((r) => r.id === 'lens')).toMatchObject({ keys: ['X'], label: 'Map: switch danger view' });
    const full = controlRows('full', { power: 'Wolf Shift', move: 'Shadow Ball' });
    expect(full.find((r) => r.id === 'power')).toMatchObject({ keys: ['Q'], label: 'Wolf Shift' });
    expect(full.find((r) => r.id === 'ability_move')).toMatchObject({ keys: ['R'], label: 'Shadow Ball' });
    expect(full.find((r) => r.id === 'sprint')?.loud).toBe(true);
    expect(CONTROLS.every((c) => !c.keys.includes('F'))).toBe(true);
    const html = renderToStaticMarkup(createElement(KeyLegend, { variant: 'full', power: 'P', move: 'M2' }));
    expect(html).not.toMatch(/<kbd[^>]*>F<\/kbd>/);
  });

  it('grep: no F key cap in the mystery UI this team owns', () => {
    const ROOT = join(__dirname, '../../..');
    for (const f of ['src/ui/mystery/MysteryHud.tsx', 'src/ui/mystery/MysteryTutorial.tsx', 'src/ui/mystery/controls.tsx', 'src/ui/mystery/hud/ClueCard.tsx', 'src/ui/mystery/hud/ThingStack.tsx', 'src/ui/mystery/hud/OddsPanel.tsx']) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, f).not.toMatch(/<kbd[^>]*>\s*F\s*<\/kbd>|k=["']F["']|kbd=["']F["']|keys: \[['"]F['"]\]/);
    }
  });
});

describe('onboarding (§9, R1) and copy', () => {
  it('3 steps after the 2 s DuoIntro, ≤ 20 s total; step 2 = the R1 headline + the exact owner line', () => {
    const steps = buildSteps({ character: 'Enid', pokemon: 'Gengar', power: 'Wolf Shift', move: 'Shadow Ball', clues: 3 });
    expect(steps.map((s) => s.id)).toEqual(['intro', 'walk', 'silent', 'search']);
    expect(steps.reduce((s, x) => s + x.timeoutS, 0)).toBeLessThanOrEqual(20);
    expect(steps[1]!.headline).toBe('Find 3 clues. Save the egg.');
    expect(steps[2]!.headline).toBe('Stay quiet. The Hyde hunts by sound.');
    expect(steps[2]!.text.startsWith(STAY_SILENT_LINE)).toBe(true);
    expect(TUTORIAL_HEADLINES.search).toBe('Search with E. Powers: Q and R.');
    expect(steps[3]!.text).toContain('Q: Wolf Shift');
    expect(steps[3]!.text).toContain('R: Shadow Ball');
    for (const s of steps) expect(`${s.headline} ${s.text}`).not.toMatch(/\bF\b(?!-)/);
  });

  it('objective copy (UX §1, R5: the egg line never names a site)', () => {
    expect(OBJECTIVE_TEXT).toMatchObject({ find_egg: 'Find the egg.', retrieve_egg: 'Pick up the egg (E).', deliver_egg: 'Take the egg to Iago Tower.', accuse: 'Name the culprit.' });
    const run = { objective: () => 'find_clues', caseDef: CASES.midnight_signal } as unknown as MysteryRunLike;
    expect(objectiveText(run)).toBe('Find 3 clues.');
  });

  it('clue cards: TL;DR from short/meaning (fallback: deduction), never culprit wording', () => {
    for (const c of Object.values(CASES)) {
      for (const clue of c.clues) {
        const card = clueCardContent(c, clue.id);
        expect(card.title).toBe(clue.shortTitle ?? clue.title);
        expect(card.fullTitle).toBe(clue.title);
        expect(card.title.length).toBeLessThanOrEqual(26); // fits the 400 px card in Cinzel caps
        expect(card.short.length).toBeGreaterThan(0);
        expect(`${card.short} ${card.meaning ?? ''}`).not.toMatch(/culprit|guilty|did it|released the hyde/i);
      }
    }
  });

  it('prompt copy: tower warning before deposit; carried egg → "Hold E: set the egg down"; stand still only for holds', () => {
    expect(promptView({ kind: 'tower', id: 't', label: 'Deposit the egg at Iago Tower', progress: 0 }, 1, 3, false)?.warning).toBe('1 of 3 clues — the case will stay unsolved.');
    expect(promptView({ kind: 'tower', id: 't', label: 'x', progress: 0 }, 3, 3, false)?.warning).toBeNull();
    expect(promptView({ kind: 'egg', id: 'egg', label: 'Hold E to set the egg down', progress: 0 }, 0, 3, false)?.label).toBe('Hold E: set the egg down');
    expect(promptView({ kind: 'examine', id: 'x', label: 'Examine the vial', progress: 0.2 }, 0, 3, true)?.standStill).toBe(true);
    expect(promptView({ kind: 'tower', id: 't', label: 'x', progress: 0 }, 0, 3, true)?.standStill).toBe(false);
  });
});

describe('HUD render (static)', () => {
  const ability = (key: 'F' | 'Q') => ({ key, name: key === 'F' ? 'Wolf Shift' : 'Shadow Ball', art: '', ready: true, cooldownLeftS: 0, cooldownS: 20, activeLeftS: 0, loud: false, denied: null, aimed: false });
  const hud: MysteryHudModel = {
    t: 30, status: 'playing', hp: 100, maxHp: 100, catches: 1, stance: 'walk', hidden: false, tooClose: false,
    noise: { level: 0.3, band: 'audible', radiusM: 7 },
    hyde: { mode: 'PATROL', suspicion: 0.1, level: 0, canSee: false, effect: null, bearing: null, edge: false, edgeAt: null, emerged: false, emergesInS: 18 },
    objective: 'find_clues', objectiveText: 'Find 3 clues.',
    clues: { found: [], total: 3, order: CASES.poisoned_archive.clues.map((c) => c.id) },
    egg: { state: 'resting', tier: null, points: 0, security: 100, seenLabel: 'Potting shed' },
    power: ability('F'), move: ability('Q'),
    prompt: { kind: 'clue', id: 'c', label: 'Search the archive desk', progress: 0.4, warning: null, standStill: false },
    examineToast: null, clueCard: { id: 1, clueId: 'access_ledger', title: 'Door Ledger', fullTitle: 'Archive and Greenhouse Access Ledger', short: 'Someone signed in late.', meaning: 'The door was used at night.', icon: 'key', leaving: false },
    stack: { log: { id: 'l', kind: 'log', head: "THING'S LOG", text: '1 of 3 clues found.', why: null, basis: null, priority: 0 }, card: { id: 'w', kind: 'why', head: 'PATTERN', text: '2 of 3 alerts came while sprinting. Not proof.', why: null, basis: 'pattern', priority: 1 } },
    captions: [], toast: null, catchFlashSeq: 0, hintCooldownS: 0, hintLevel: 0, risk: null,
    odds: { phase: 'hidden', rows: [], footer: [] }, areaName: null,
    crack: null, banner: null, cursedLeftS: null, threatEdge: null,
  };
  const html = renderToStaticMarkup(createElement(MysteryHud, { hud, tutorial: false, pointerLocked: false, showPredictions: true, nav: () => null }));

  it('Q / R ability caps, KeyStrip, DORMANT countdown, egg seen line, pattern card, no F / M caps', () => {
    expect(html).not.toMatch(/<kbd[^>]*>F<\/kbd>/);
    expect(html).not.toMatch(/<kbd[^>]*>M<\/kbd>/);
    expect(html).toMatch(/data-testid="hud-ability-F".*?<kbd[^>]*>Q<\/kbd>/s);
    expect(html).toMatch(/data-testid="hud-ability-Q".*?<kbd[^>]*>R<\/kbd>/s);
    expect(html).toContain('Arrives in 0:18'); // UX_FINAL §1a director state (was "Hyde emerges in 0:18")
    expect(html).toContain('>HYDE<');
    expect(html).toContain('Egg: seen · Potting shed');
    expect(html).toContain('data-testid="hud-keystrip"');
    expect(html).toContain('data-basis="pattern"');
    expect(html).toContain('≈ PATTERN');
    expect(html).toContain('Clue found');
    expect(html).toContain('<strong>Meaning:</strong>');
    expect(html).toContain('Click to look around');
    expect(html).toContain('Caught');
  });
});
