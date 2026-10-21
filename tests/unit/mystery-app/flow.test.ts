import { describe, expect, it } from 'vitest';
import { initialFlow, mysteryReducer, shortcutFlow, type MysteryAction, type MysteryFlowState } from '../../../src/app/mystery/flow.ts';
import { draftOffer as previewOffer } from '../../../src/mystery/draft.ts';
import type { MysterySession } from '../../../src/app/mystery/session.ts';
import type { RunResult } from '../../../src/mystery/types.ts';

const session = (nickname = '', seed = 'seed-a'): MysterySession => ({
  rulesVersion: 'mystery-v3.1', sessionId: `id-${seed}`, seed, offer: previewOffer(seed), offerSource: 'preview', nickname, createdAt: '2026-10-27T00:00:00Z',
});

const run = (s: MysteryFlowState, ...actions: MysteryAction[]) => actions.reduce(mysteryReducer, s);

const result = (over: Partial<RunResult> = {}): RunResult => ({
  rulesVersion: 'mystery-v3.1', outcome: 'finished', dnfReason: null, verdict: 'case_solved', accused: 'thornhill', correct: true,
  cluesFound: ['transfer_note', 'master_key', 'greenhouse_trace'], eggTier: 'rare', eggPoints: 3, eggSecurity: 80, activeTimeS: 241.3,
  score: 58.7, catches: 0, hp: 100, duo: { characterId: 'enid', pokemonId: 'gengar' }, ...over,
});

describe('mystery flow', () => {
  it('fresh load starts at home; a session with a nickname resumes on its cards', () => {
    expect(initialFlow(session()).screen).toBe('home');
    expect(initialFlow(session('Raven')).screen).toBe('cards');
  });

  it('home → nickname → cards → tutorial → play → accusing → results', () => {
    const s0 = initialFlow(session());
    const card = s0.session.offer.cards[1];
    let s = run(s0, { type: 'start' });
    expect(s.screen).toBe('nickname');
    s = run(s, { type: 'nickname', nickname: 'Raven' });
    expect(s.screen).toBe('cards');
    expect(s.session.nickname).toBe('Raven');
    s = run(s, { type: 'select', duo: card });
    expect(s.screen).toBe('tutorial');
    expect(s.session.selected).toEqual({ characterId: card.characterId, pokemonId: card.pokemonId });
    expect(s.attempt).toBe(1);
    s = run(s, { type: 'tutorialDone' });
    expect(s.screen).toBe('play');
    expect(s.attempt).toBe(1); // same run continues after the tutorial
    s = run(s, { type: 'deposited' });
    expect(s.screen).toBe('accusing');
    s = run(s, { type: 'ended', result: result() });
    expect(s.screen).toBe('results');
    expect(s.result?.verdict).toBe('case_solved');
  });

  it('rejects a duo that was not offered and selections outside the cards screen', () => {
    const s = run(initialFlow(session('Raven')));
    const offered = new Set(s.session.offer.cards.map((c) => c.characterId));
    const other = (['wednesday', 'morticia', 'enid', 'bianca', 'eugene', 'gomez', 'ajax'] as const).find((c) => !offered.has(c))!;
    expect(run(s, { type: 'select', duo: { characterId: other, pokemonId: 'gengar' } })).toBe(s);
    const home = initialFlow(session());
    expect(run(home, { type: 'select', duo: home.session.offer.cards[0] })).toBe(home);
  });

  it('back navigation: cards → nickname → home', () => {
    const s = initialFlow(session('Raven'));
    expect(run(s, { type: 'back' }).screen).toBe('nickname');
    expect(run(s, { type: 'back' }, { type: 'back' }).screen).toBe('home');
  });

  it('board and pause overlays: Tab toggles the board, Esc closes the board first, then toggles pause', () => {
    const s0 = run(initialFlow(session('R')), { type: 'select', duo: session().offer.cards[0] }, { type: 'tutorialDone' });
    let s = run(s0, { type: 'toggleBoard' });
    expect(s.overlay).toBe('board');
    s = run(s, { type: 'togglePause' });
    expect(s.overlay).toBe('none'); // Esc closed the board
    s = run(s, { type: 'togglePause' });
    expect(s.overlay).toBe('pause');
    expect(run(s, { type: 'toggleBoard' }).overlay).toBe('pause'); // no board over the pause menu
    s = run(s, { type: 'togglePause' });
    expect(s.overlay).toBe('none');
    // board is not available on menu screens
    const cards = initialFlow(session('R'));
    expect(run(cards, { type: 'toggleBoard' })).toBe(cards);
    expect(run(cards, { type: 'pause' })).toBe(cards);
  });

  it('deposit is only accepted while playing; results only from the island', () => {
    const cards = initialFlow(session('R'));
    expect(run(cards, { type: 'deposited' })).toBe(cards);
    expect(run(cards, { type: 'ended', result: result() })).toBe(cards);
    const tut = run(cards, { type: 'select', duo: cards.session.offer.cards[0] });
    expect(run(tut, { type: 'deposited' })).toBe(tut);
  });

  it('a DNF during play goes to results', () => {
    const s = run(initialFlow(session('R')), { type: 'select', duo: session().offer.cards[2] }, { type: 'tutorialDone' },
      { type: 'ended', result: result({ outcome: 'dnf', dnfReason: 'second_catch', verdict: 'not_accused', score: null }) });
    expect(s.screen).toBe('results');
    expect(s.result?.outcome).toBe('dnf');
  });

  it('reset starts a new session at home and keeps the attempt counter monotonic', () => {
    const s = run(initialFlow(session('R')), { type: 'select', duo: session().offer.cards[0] });
    const next = session('', 'seed-b');
    const r = run(s, { type: 'reset', session: next });
    expect(r.screen).toBe('home');
    expect(r.session.sessionId).toBe('id-seed-b');
    expect(r.result).toBeNull();
    expect(r.attempt).toBe(s.attempt);
  });

  it('dev shortcut selects the duo; tutorial=0 goes straight to play', () => {
    const s = session('', 'seed-c');
    const duo = s.offer.cards[0];
    expect(shortcutFlow(s, duo, false).screen).toBe('tutorial');
    const fast = shortcutFlow(s, duo, true);
    expect(fast.screen).toBe('play');
    expect(fast.session.nickname).toBe('Guest');
  });
});
