// Frontend B — Laptop 1 spectator dashboard (docs/overhaul/UX_OVERHAUL.md §10): StationLiveCard rows from real station
// data (local LiveStatus or a live BoardStation) and the header KPI ribbon from real aggregates. Never the culprit, the
// accused suspect or the true egg site.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LiveStatus } from '../../../src/app/mystery/records.ts';
import { createMysteryAnalytics, dashboard } from '../../../src/mystery/analytics/index.ts';
import { caseWorld } from '../../../src/mystery/data/caseWorlds.ts';
import { CASES } from '../../../src/mystery/data/cases.ts';
import { CASE_SOLUTIONS } from '../../../src/mystery/data/solutions.ts';
import { playEpisode } from '../../../src/mystery/episode.ts';
import type { BoardStation } from '../../../src/lib/supabase/mysteryDashboardFeed.ts';
import { KpiRibbon, StationLiveCard } from '../../../src/ui/mystery/MysteryDashboard.tsx';
import { kpiRibbon, stationViewFromBoard, stationViewFromLocal, type LiveStatusWithInsights } from '../../../src/ui/mystery/stationView.ts';

const NOW = 1_800_000_000_000;
const live = (over: Partial<LiveStatusWithInsights> = {}): LiveStatusWithInsights => ({
  stationId: 'local', phase: 'investigating', nickname: 'Raven', duo: { characterId: 'wednesday', pokemonId: 'gengar' }, caseId: 'crypt_last_witness',
  clues: 2, egg: { state: 'resting', tier: null, security: 100 }, hp: 72, catches: 1, hydeMode: 'PATROL', risk: { p: 0.2, label: 'ML estimate' },
  advice: { text: 'Search the greenhouse. The egg is most likely there.', followed: null }, activeTimeS: 134.2, updatedAt: NOW - 3000, ...over,
});
const card = (v: ReturnType<typeof stationViewFromLocal>) => renderToStaticMarkup(createElement(StationLiveCard, { view: v, area: 'mdash-a1', testId: 'station-live' }));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ');

describe('StationLiveCard (local demo data)', () => {
  it('rows: phase + time, duo, case, progress track, HP / caught / Hyde chip, risk + sources, newest Thing item, age', () => {
    const v = stationViewFromLocal(live(), NOW);
    expect(v.phaseText).toBe('Investigating');
    expect(v.timeText).toBe('2:14');
    expect(v.duoText).toBe('Wednesday & Gengar');
    expect(v.caseText).toBe(`Case 02 · ${CASES.crypt_last_witness.title}`);
    expect(v.objectiveText).toBe('Finding clues');
    expect(v.risk).toEqual({ band: 'Low', source: 'ml' });
    expect(v.thing).toEqual({ head: "THING'S ADVICE", text: 'Search the greenhouse. The egg is most likely there.', followed: 'not yet' });
    expect(v.ageText).toBe('updated 3 s ago');
    const html = card(v);
    for (const id of ['station-live-time', 'station-live-case', 'station-live-track', 'station-live-hyde', 'station-live-odds', 'station-live-thing']) expect(html).toContain(`data-testid="${id}"`);
    expect(text(html)).toContain('Patrolling');
    expect(text(html)).toContain('Risk  Low');
    expect(html).not.toContain('CHASING');
  });

  it('states: CHASE frame + "CHASING" chip; signal lost after 15 s; DNF', () => {
    const chase = stationViewFromLocal(live({ hydeMode: 'CHASE' }), NOW);
    expect(chase.chasing).toBe(true);
    expect(card(chase)).toContain('data-testid="station-live-chasing"');
    expect(card(chase)).toContain('mstation is-chase');
    const lost = stationViewFromLocal(live({ updatedAt: NOW - 16_000 }), NOW);
    expect(lost.lost).toBe(true);
    expect(lost.phaseText).toBe('Signal lost');
    const dnf = stationViewFromLocal(live({ phase: 'dnf' }), NOW);
    expect(dnf.dnf).toBe(true);
    expect(dnf.lost).toBe(false);
    expect(stationViewFromLocal(null, NOW).notice).toBe('No visitor yet.');
  });

  it('analytics heartbeat numbers: chases, tower odds, egg odds by public site name — hidden once the egg was seen', () => {
    const site = caseWorld('crypt_last_witness').eggSites[0]!;
    const insights = {
      objective: 'find_egg', chases: 2, escapes: 1, catches: 1, hydeEmerged: true, hydePhase: 'active' as const, hydeZone: null,
      eggSite: { id: site.id, p: 0.62 }, extraction: { p: 0.81, source: 'ml' as const }, clues: 3, cluesTotal: 3,
      lastThing: { kind: 'diagnostic' as const, code: 'noise_sprint', ref: null, text: 'Your sprinting made too much noise.', followed: null },
    };
    const v = stationViewFromLocal(live({ insights }), NOW);
    expect(v.chases).toBe(2);
    expect(v.objectiveText).toBe('Finding the egg');
    expect(v.tower).toEqual({ pct: 80, source: 'ml' });
    expect(v.eggOdds).toEqual({ name: site.label, pct: 60 });
    expect(v.thing).toEqual({ head: 'HYDE ALERT', text: 'Your sprinting made too much noise.', followed: null });
    // seen (posterior ≈ 1): the card says "seen" and never names the site
    const seen = stationViewFromLocal(live({ insights: { ...insights, eggSite: { id: site.id, p: 1 } } }), NOW);
    expect(seen.eggOdds).toBeNull();
    expect(seen.egg).toBe('seen');
    expect(text(card(seen))).not.toContain(site.label);
  });

  it('never shows the culprit or who was accused', () => {
    for (const caseId of ['poisoned_archive', 'crypt_last_witness', 'midnight_signal'] as const) {
      for (const phase of ['investigating', 'accusing', 'results'] as const) {
        const html = text(card(stationViewFromLocal(live({ caseId, phase }), NOW)));
        const culprit = CASES[caseId].suspects.find((s) => s.id === CASE_SOLUTIONS[caseId].culprit)!;
        for (const s of CASES[caseId].suspects) expect(html).not.toContain(s.name);
        expect(html).not.toContain(culprit.name.split(' ')[1]!);
      }
    }
  });
});

describe('StationLiveCard (live board: Supabase row + heartbeat)', () => {
  const station = (over: Partial<BoardStation> = {}): BoardStation => ({
    stationId: 'A' as BoardStation['stationId'], label: 'Station A', lastSeenAt: NOW - 2000, signalLost: false,
    row: {
      station_id: 'A', label: 'Station A', session_id: 's', nickname: 'Morticia fan', character_id: 'morticia', pokemon_id: 'aegislash', case_id: 'midnight_signal',
      status: 'playing', clues_found: 1, catches: 0, sightings: 2, egg_state: 'resting', active_time_s: 61.2, verdict: null, score: null, is_test: false, notice: null,
      revision: 1, updated_at: '',
    },
    heartbeat: {
      v: 1, stationId: 'A' as BoardStation['stationId'], phase: 'investigating', clues: 1, hp: 100, catches: 0, hydeMode: 'SEARCH', risk: 0.7, riskSource: 'rule_based',
      eggState: 'resting', eggTier: null, eggSecurity: 100, activeTimeS: 61.2, sync: 'live', objective: 'find_clues', cluesTotal: 3, chases: 0, escapes: 0,
      hydeEmerged: true, hydeZone: null, eggSite: null, extraction: 0.66, extractionSource: 'rule_based',
      thing: { kind: 'advice', code: 'stay_quiet', ref: null, followed: true },
    },
    ...over,
  });

  it('maps the verified row + beat; fixed copy for the Thing item; heartbeat age', () => {
    const v = stationViewFromBoard(station(), NOW);
    expect(v.label).toBe('Station A');
    expect(v.duoText).toBe('Morticia & Aegislash');
    expect(v.timeText).toBe('1:01');
    expect(v.hyde).toEqual({ word: 'Searching', icon: 'search', chase: false });
    expect(v.risk).toEqual({ band: 'High', source: 'rule' });
    expect(v.tower).toEqual({ pct: 65, source: 'rule' });
    expect(v.thing?.followed).toBe('followed ✓');
    expect(v.ageText).toBe('heartbeat 2 s ago');
    const idle = stationViewFromBoard(station({ row: { ...station().row!, status: 'idle' }, heartbeat: null, lastSeenAt: null }), NOW);
    expect(idle.active).toBe(false);
    expect(idle.ageText).toBe('no heartbeat yet');
    expect(stationViewFromBoard(station({ signalLost: true }), NOW).phaseText).toBe('Signal lost');
  });
});

describe('KPI ribbon (real aggregates)', () => {
  it('"—" at n = 0 (Runs reads 0)', () => {
    const k = kpiRibbon(dashboard([]).descriptive);
    expect(k.map((x) => [x.label, x.value, x.small])).toEqual([
      ['Runs', '0', false], ['Case solved', '—', false], ['Extraction success', '—', false], ['Median time', '—', false], ['Hyde chases / run', '—', false],
      ['Curses dodged', '—', false], // UX_ENEMIES §8 (casts over ended runs; none yet)
    ]);
  });

  it('values + "small sample" (n < 10) from a real bot episode', () => {
    const ep = playEpisode({ characterId: 'ajax', pokemonId: 'gholdengo' }, 'kpi-test', { profile: 'stealthy', accuse: 'deduce' });
    const a = createMysteryAnalytics(ep.run, { sessionId: 'kpi-1', stationId: 'local', offered: [{ characterId: 'ajax', pokemonId: 'gholdengo' }] });
    a.frame(ep.run, []);
    const agg = dashboard([a.sessionRecord()]);
    const k = kpiRibbon(agg.descriptive);
    expect(k[0]!.value).toBe('1');
    expect(k[0]!.small).toBe(true);
    const finished = agg.descriptive.finished;
    expect(k[1]!.value).toBe(finished ? `${Math.round(agg.descriptive.caseSolvedPctOfFinished!)}%` : '—');
    expect(k[2]!.value).toMatch(/^\d+%$/);
    expect(k[4]!.value).toMatch(/^\d+\.\d$/);
    const html = renderToStaticMarkup(createElement(KpiRibbon, { agg }));
    expect(html).toContain('data-testid="kpi-ribbon"');
    expect(html).toContain('small sample');
  });

  it('larger samples drop the "small sample" note', () => {
    const d = { runs: 12, finished: 10, dnf: 2, caseSolvedPctOfFinished: 40, extractionPct: 83.3, medianTimeS: 312, detectionsPerRun: 1.25 };
    expect(kpiRibbon(d).map((x) => [x.value, x.small])).toEqual([['12', false], ['40%', false], ['83%', false], ['5:12', false], ['1.3', false], ['—', false]]);
  });
});

describe('local status type stays compatible', () => {
  it('a plain LiveStatus (no insights) still renders', () => {
    const plain: LiveStatus = live();
    expect(stationViewFromLocal(plain, NOW).chases).toBeNull();
  });
});
