// Frontend B — final wave screens (docs/final/UX_FINAL.md §5 home panel + modal, §6 results; FINAL_CONTRACT §10 board):
// v4 score box (2×4 breakdown incl. missed bonuses "+0 (seen 2×)", penalties, clamp at 0, rank chip), the DNF variant,
// the home panel states (rows + #1, empty, skeleton, chips), the modal's focus trap / tab keys, and the Laptop 1 standings
// + three monster chips. Rendered with react-dom/server (no DOM needed).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CASES } from '../../../src/mystery/data/cases.ts';
import type { RunResult } from '../../../src/mystery/types.ts';
import { HomeBoardPanel } from '../../../src/ui/mystery/leaderboard/HomeLeaderboard.tsx';
import { LeaderboardModal, nextTab, trapTarget } from '../../../src/ui/mystery/leaderboard/LeaderboardModal.tsx';
import type { BoardEntry, HomeBoardSnapshot } from '../../../src/ui/mystery/leaderboard/model.ts';
import { dnfBoxView, rankChipView, scoreBoxView, whyLine } from '../../../src/ui/mystery/leaderboard/scoreView.ts';
import { LayerPanels } from '../../../src/ui/mystery/LayerPanels.tsx';
import { MysteryResults, verdictView } from '../../../src/ui/mystery/MysteryResults.tsx';
import { Standings } from '../../../src/ui/mystery/MysteryDashboard.tsx';
import { kpiRibbon, monsterChipsOf, stationViewFromLocal } from '../../../src/ui/mystery/stationView.ts';
import type { DuoCardView } from '../../../src/ui/mystery/duoView.ts';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const C = CASES.poisoned_archive;

function run(over: Partial<RunResult> = {}): RunResult {
  return {
    rulesVersion: 'mystery-v4', caseId: C.id, caseVersion: C.version, outcome: 'finished', dnfReason: null, verdict: 'case_solved',
    accused: 'thornhill', correct: true, evidence: [], deductionCorrect: true, cluesFound: C.clues.map((c) => c.id), eggTier: 'common',
    eggPoints: 1, eggSecurity: 90, activeTimeS: 142.4, score: 0, catches: 0, hp: 100, duo: { characterId: 'enid', pokemonId: 'gengar' },
    hintsUsed: 0, detections: 2, hits: 2, ...over,
  };
}

describe('results: v4 score box (2×4 breakdown)', () => {
  it('rows, signs, tones and the missed-bonus reasons ("+0 (seen 2×)")', () => {
    const v = scoreBoxView(run())!;
    // 1000 + 300 + 300 + 0 (seen 2×) + 150 + 158 − 0 − 150
    expect(v.total).toBe(1758);
    expect(v.totalText).toBe('1,758');
    const row = (k: string) => [...v.rows!.left, ...v.rows!.right].find((r) => r.key === k)!;
    expect(v.rows!.left.map((r) => r.label)).toEqual(['Egg delivered', 'Right culprit', 'Clues 3/3', 'Time bonus (2:22)']);
    expect(v.rows!.right.map((r) => r.label)).toEqual(['Never detected', 'No hints', 'Hints ×0', 'Hits ×2']);
    expect(row('delivery')).toMatchObject({ value: '+1000', tone: 'gain' });
    expect(row('timeBonus')).toMatchObject({ value: '+158', tone: 'gain' });
    expect(row('noDetection')).toMatchObject({ value: '+0', tone: 'muted', reason: 'seen 2×' });
    expect(row('noHints')).toMatchObject({ value: '+150', tone: 'gain' });
    expect(row('hintPenalty')).toMatchObject({ value: '0', tone: 'muted' });
    expect(row('hitPenalty')).toMatchObject({ value: '−150', tone: 'penalty' });
    expect(v.clamped).toBe(false);
  });

  it('wrong suspect / no accusation / slow run / hints read as reasons; the sim breakdown is used when present', () => {
    const v = scoreBoxView(run({ correct: false, accused: 'barry', activeTimeS: 333, hintsUsed: 2, detections: 0, hits: 0 }))!;
    const all = [...v.rows!.left, ...v.rows!.right];
    expect(all.find((r) => r.key === 'accusation')).toMatchObject({ value: '+0', reason: 'wrong suspect' });
    expect(all.find((r) => r.key === 'timeBonus')).toMatchObject({ value: '+0', reason: 'over 5:00' });
    expect(all.find((r) => r.key === 'noHints')).toMatchObject({ value: '+0', reason: 'used 2×' });
    expect(all.find((r) => r.key === 'hintPenalty')).toMatchObject({ label: 'Hints ×2', value: '−100', tone: 'penalty' });
    expect(all.find((r) => r.key === 'noDetection')).toMatchObject({ value: '+150', tone: 'gain' });
    expect(scoreBoxView(run({ accused: null, correct: false }))!.rows!.left[1]!.reason).toBe('no accusation');
    const own = { delivery: 1000, accusation: 300, clues: 300, noDetection: 150, noHints: 150, timeBonus: 100, hintPenalty: 0, hitPenalty: 0, total: 2000 };
    expect(scoreBoxView(run({ scoreBreakdown: own }))!.total).toBe(2000);
  });

  it('clamps at 0 and says so', () => {
    const v = scoreBoxView(run({ correct: false, accused: 'barry', cluesFound: [], activeTimeS: 600, detections: 9, hits: 20, hintsUsed: 6 }))!;
    expect(v.total).toBe(0);
    expect(v.totalText).toBe('0');
    expect(v.clamped).toBe(true);
  });

  it('no counts and no breakdown → total only (never an invented breakdown); DNF → null', () => {
    const legacy = scoreBoxView(run({ hintsUsed: undefined, detections: undefined, hits: undefined, score: 777 }))!;
    expect(legacy.rows).toBeNull();
    expect(legacy.totalText).toBe('777');
    expect(scoreBoxView(run({ outcome: 'dnf', score: null }))).toBeNull();
  });

  it('rank chip: LIVE "#3 tonight" / LOCAL "#2 on this laptop" / "Verifying…" / "Not ranked"', () => {
    expect(rankChipView({ mode: 'live', final: 'verified', rank: 3 })).toEqual({ kind: 'live', text: '#3 tonight' });
    expect(rankChipView({ mode: 'local', rank: 2 })).toEqual({ kind: 'local', text: '#2 on this laptop' });
    expect(rankChipView({ mode: 'live', final: 'verifying', rank: null })).toEqual({ kind: 'pending', text: 'Verifying…' });
    expect(rankChipView({ mode: 'live', final: 'unverified', rank: null }).text).toBe('Not ranked');
    expect(rankChipView({ mode: 'local', rank: null }).text).toBe('Not ranked');
  });

  it('renders: SCORE + chip + total + 8 rows; the old "tracked separately" / egg-tier lines are gone', () => {
    const card = { characterArt: '/a.webp', pokemonArt: '/b.webp', duoName: 'Fog & Fang', role: 'stealth', characterShort: 'Enid', pokemonName: 'Gengar' } as unknown as DuoCardView;
    const html = renderToStaticMarkup(createElement(MysteryResults, {
      result: run(), analytics: null, nickname: 'Raven', card, caseDef: C, solution: null, tools: null,
      rankChip: { kind: 'local', text: '#2 on this laptop' }, onPlayAgain: () => undefined,
    }));
    const t = text(html);
    expect(html).toContain('data-testid="score-rows"');
    expect((html.match(/data-testid="score-row-/g) ?? []).length).toBe(8);
    expect(t).toContain('SCORE');
    expect(t).toContain('#2 on this laptop');
    expect(t).toContain('1,758');
    expect(t).toContain('+0 (seen 2×)');
    expect(t).not.toContain('tracked separately');
    expect(t).not.toMatch(/Common egg|security \d+ · caught/);
    expect(t).not.toContain('mystery-v3.1');
  });
});

describe('results: DNF variant (DEFEAT LOG)', () => {
  const dnf = run({ outcome: 'dnf', dnfReason: 'hp_depleted', verdict: 'not_accused', accused: null, correct: false, score: null, activeTimeS: 134, cluesFound: C.clues.slice(0, 2).map((c) => c.id), detections: 4, hits: 3, hintsUsed: 1, defeatedBy: 'slurp' });

  it('title "Defeated by Slurp" + flavour; facts; tally; no score', () => {
    const v = verdictView(dnf, C, null);
    expect(v.title).toBe('Defeated by Slurp');
    expect(v.sub).toBe('Slurp lurched out of the dark and grabbed you.');
    const d = dnfBoxView(dnf, null, 3);
    expect(d).toMatchObject({ enemy: 'slurp', lasted: 'Lasted 2:14', clues: 'Clues 2/3', tally: 'Seen 4 · Hits 3 · Hints 1', egg: null, why: null });
    // older DNFs without defeatedBy keep the v3.1 copy
    expect(verdictView({ ...dnf, defeatedBy: undefined }, C, null).title).toBe('Dragged into the fog');
  });

  it('renders DEFEAT LOG + "No score · not ranked" + "Saved to tonight\'s defeat log." and the medallion', () => {
    const card = { characterArt: '/a.webp', pokemonArt: '/b.webp', duoName: 'X', role: 'stealth', characterShort: 'Enid', pokemonName: 'Gengar' } as unknown as DuoCardView;
    const html = renderToStaticMarkup(createElement(MysteryResults, { result: dnf, analytics: null, nickname: 'R', card, caseDef: C, solution: null, tools: null, onPlayAgain: () => undefined }));
    const t = text(html);
    expect(t).toContain('DEFEAT LOG');
    expect(t).toContain('No score · not ranked');
    expect(t).toContain('Saved to tonight’s defeat log.');
    expect(t).toContain('Defeated by Slurp');
    expect(html).toContain('enemy-medal--slurp');
    expect(t).toContain('Seen 4 · Hits 3 · Hints 1');
  });

  it('WHY line = newest rule-verified cause without its m:ss prefix', () => {
    const a = { diagnostic: { causes: [{ t: 10, kind: 'cause', code: 'x', text: '0:10 · Hyde detected your footsteps.', evidenceSeq: [] }, { t: 90, kind: 'cause', code: 'y', text: '1:30 · Slurp saw you and gave chase.', evidenceSeq: [] }], caseReasons: [], top: [] } };
    expect(whyLine(a as never)).toBe('Slurp saw you and gave chase.');
    expect(whyLine(null)).toBeNull();
  });
});

describe('results: descriptive tiles TIME · CLUES · SEEN · HITS · HINTS · EGG', () => {
  it('uses the run tally; "—" when the run has none', () => {
    const report = {
      descriptive: {
        activeTimeS: 142, clues: { count: 2, total: 3, found: [], missing: [] }, hints: 1, stanceShare: { crouch: 0.5, walk: 0.5, sprint: 0, idle: 0 },
        egg: { delivered: false, pickupT: 50, drops: [], security: 90, deliveredT: null, points: 0, securityLost: 0 },
        abilities: { F: { uses: 1, successes: 1, denied: 0, name: 'Power' }, Q: { uses: 0, successes: 0, denied: 0, name: 'Move' } },
        hyde: { chases: 0 }, catches: 0,
      },
      diagnostic: { timeline: [], causes: [], patterns: [], caseReasons: [], top: [], topPattern: null, reasons: [] },
      predictive: { label: 'Rule-based risk estimate', source: 'rule', series: [], detections: [], card: {} },
      prescriptive: { engine: 'rule engine', rows: [], summary: { text: 'ok' } },
    };
    const html = renderToStaticMarkup(createElement(LayerPanels, { report: report as never, result: { detections: 3, hits: 1, hintsUsed: 1 } }));
    const tiles = [...html.matchAll(/<dt>([^<]+)<\/dt><dd class="num">([^<]+)<\/dd>/g)].map((m) => `${m[1]}=${m[2]}`);
    expect(tiles).toEqual(['Time=2:22', 'Clues=2/3', 'Seen=3', 'Hits=1', 'Hints=1', 'Egg=Carried']);
    const none = renderToStaticMarkup(createElement(LayerPanels, { report: report as never }));
    expect(none).toContain('<dt>Seen</dt><dd class="num">—</dd>');
  });
});

// ------------------------------------------------------------------------------------------------- home panel + modal

const e = (id: string, rank: number, score: number, extra: Partial<BoardEntry> = {}): BoardEntry => ({
  id, nickname: id, outcome: 'finished', score, activeTimeS: 120, caseId: 'midnight_signal', duo: { characterId: 'wednesday', pokemonId: 'gengar' },
  hintsUsed: 0, detections: 0, hits: 0, cluesFound: 3, defeatedBy: null, finalizedAt: '2026-10-27T18:00:00Z', rank, ...extra,
});
const snap = (over: Partial<HomeBoardSnapshot> = {}): HomeBoardSnapshot => ({ source: 'local', status: 'ready', top: [], defeats: [], updatedAt: 0, ...over });
const panel = (s: HomeBoardSnapshot | null) => renderToStaticMarkup(createElement(HomeBoardPanel, { snap: s, onOpenFull: () => undefined }));

describe('home leaderboard panel', () => {
  it('top 5 rows (of more), #1 highlighted with the trophy, duo portraits with explicit size, LOCAL DEMO chip + footer', () => {
    const top = Array.from({ length: 7 }, (_, i) => e(`p${i}`, i + 1, 2000 - i * 100));
    const html = panel(snap({ top }));
    expect((html.match(/class="hb-row[ "]/g) ?? []).length).toBe(5);
    expect(html).toMatch(/class="hb-row is-first"[^>]*data-rank="1"/);
    expect(html).toContain('width="28" height="28"');
    expect(text(html)).toContain('TONIGHT · TOP 5');
    expect(text(html)).toContain('Top Detectives');
    expect(text(html)).toContain('LOCAL DEMO');
    expect(text(html)).toContain('This laptop only · not verified');
    expect(text(html)).toContain('View Full Leaderboard');
    expect(text(html)).toContain('2,000');
  });

  it('empty state copy', () => {
    const t = text(panel(snap()));
    expect(t).toContain('No detectives on the board yet.');
    expect(t).toContain('Solve a case to claim #1.');
  });

  it('skeleton while LIVE loads; LIVE chip + verified footer; Reconnecting keeps the last rows', () => {
    expect(panel(null)).toContain('data-testid="home-board-skeleton"');
    expect(panel(snap({ source: 'live', status: 'loading' }))).toContain('data-testid="home-board-skeleton"');
    const live = text(panel(snap({ source: 'live', top: [e('a', 1, 900)] })));
    expect(live).toContain('LIVE');
    expect(live).toContain('Verified scores · new rules (v4)');
    const rec = panel(snap({ source: 'live', status: 'reconnecting', top: [e('a', 1, 900)] }));
    expect(text(rec)).toContain('Reconnecting…');
    expect(rec).toContain('data-testid="home-board-rows"');
  });

  it('modal: dialog semantics, two tabs, top scores table, defeat log by monster', () => {
    const s = snap({ top: [e('a', 1, 900)], defeats: [e('d', 0, 0, { outcome: 'dnf', score: null, rank: null, defeatedBy: 'crackstone' })] });
    const top = renderToStaticMarkup(createElement(LeaderboardModal, { snap: s, onClose: () => undefined }));
    expect(top).toContain('role="dialog"');
    expect(top).toContain('aria-modal="true"');
    expect((top.match(/role="tab"/g) ?? []).length).toBe(2);
    expect(top).toMatch(/aria-selected="true"[^>]*data-testid="board-tab-top"/);
    expect(text(top)).toMatch(/# Detective Case Time Hints Score/);
    const d = renderToStaticMarkup(createElement(LeaderboardModal, { snap: s, onClose: () => undefined, initialTab: 'defeats' }));
    expect(text(d)).toContain('Runs that ended early. Never ranked.');
    expect(text(d)).toContain('Crackstone');
  });

  it('modal focus trap + tab keys (pure helpers)', () => {
    const [a, b, c] = ['tab1', 'tab2', 'close'];
    expect(trapTarget([a, b, c], c, false)).toBe(a); // Tab on the last wraps to the first
    expect(trapTarget([a, b, c], a, true)).toBe(c); // Shift+Tab on the first wraps to the last
    expect(trapTarget([a, b, c], b, false)).toBeNull(); // in the middle: the browser moves focus
    expect(trapTarget([a, b, c], 'outside', false)).toBe(a); // focus escaped: pull it back in
    expect(trapTarget([], null, false)).toBeNull();
    expect(nextTab('top', 'ArrowRight')).toBe('defeats');
    expect(nextTab('defeats', 'ArrowLeft')).toBe('top');
    expect(nextTab('defeats', 'Home')).toBe('top');
    expect(nextTab('top', 'End')).toBe('defeats');
    expect(nextTab('top', 'Enter')).toBeNull();
  });
});

describe('Laptop 1: v4 standings, defeat log, monsters, KPI', () => {
  it('standings rank v4 finishers; the defeat log names the monster', () => {
    const entries = [e('b', 0, 1500), e('a', 0, 1800), e('d', 0, 0, { outcome: 'dnf', score: null, defeatedBy: 'slurp', activeTimeS: 75 })];
    const html = renderToStaticMarkup(createElement(Standings, { entries, scope: 'all' }));
    const t = text(html);
    expect(t.indexOf('1,800')).toBeLessThan(t.indexOf('1,500'));
    expect(t).toContain('Defeat log · never ranked (1)');
    expect(t).toContain('2 ranked');
    expect(t).toContain('Slurp');
    expect(t).toContain('1:15');
    expect(t).toContain('v4');
  });

  it('three monster chips when the station reports them (nested or flat); older stations → null', () => {
    expect(monsterChipsOf({ hydeMode: 'PATROL' }, true)).toBeNull();
    const flat = monsterChipsOf({ hydeMode: 'CHASE', crackstonePresent: true, crackstoneMode: 'PATROL', slurpPresent: true, slurpMode: 'WANDER' }, true)!;
    expect(flat.map((m) => [m.enemy, m.hot])).toEqual([['hyde', true], ['crackstone', false], ['slurp', false]]);
    expect(flat.find((m) => m.enemy === 'hyde')!.word).toBe('CHASING');
    expect(flat.find((m) => m.enemy === 'slurp')!.word).toBe('Wandering');
    const nested = monsterChipsOf({ enemies: { hyde: { present: true, active: false }, crackstone: { present: false }, slurp: { present: true, active: true, mode: 'ATTACK' } } }, true)!;
    expect(nested.map((m) => [m.enemy, m.word, m.away, m.hot])).toEqual([['hyde', 'Away', true, false], ['slurp', 'GRABBING', false, true]]);
    expect(monsterChipsOf({ slurpMode: 'CHASE' }, false)).toBeNull();
    const v = stationViewFromLocal({
      stationId: 'local', phase: 'investigating', nickname: 'R', duo: null, caseId: 'midnight_signal', clues: 1, egg: null, hp: 80, catches: 0, hydeMode: 'PATROL',
      risk: null, advice: null, activeTimeS: 30, updatedAt: 1000, ...({ slurpPresent: true, slurpMode: 'SEARCH' } as object),
    }, 2000);
    expect(v.monsters?.map((m) => m.word)).toEqual(['Patrolling', 'Searching']);
  });

  it('KPI ribbon keeps its six tiles (aggregated over the v4 records by MysteryDashboardApp)', () => {
    const d = { runs: 3, finished: 2, dnf: 1, caseSolvedPctOfFinished: 50, extractionPct: 66.7, medianTimeS: 150, detectionsPerRun: 1 };
    expect(kpiRibbon(d).map((k) => k.key)).toEqual(['runs', 'solved', 'extraction', 'median', 'chases', 'curses']);
  });
});
