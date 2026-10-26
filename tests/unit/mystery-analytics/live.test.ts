// MysteryAnalytics.live() — the four analytics during play (overhaul): a smoke run for ALL 126 duos × 3 cases, full
// bot episodes polled at 4 Hz (labels, sums, copy limits, unique ids, feasible advice), the R7 hint ladder, uploads of
// the new forecast targets through the real server parser, and the Laptop 1 heartbeat round trip.
import { describe, expect, it } from 'vitest';
import { parseMysteryAppend } from '../../../supabase/functions/_shared/mystery-validation.ts';
import { createMysteryAnalytics } from '../../../src/mystery/analytics/index.ts';
import { ADVICE_MAX, DIAG_MAX, LOG_MAX, TITLES, WHY_MAX } from '../../../src/mystery/analytics/liveMessages.ts';
import type { LiveAnalytics, LiveMessage } from '../../../src/mystery/analytics/types.ts';
import { Bot } from '../../../src/mystery/bot.ts';
import { CASES } from '../../../src/mystery/data/cases.ts';
import { allPairs, REGISTRIES } from '../../../src/mystery/draft.ts';
import { IDLE_INPUT, MysteryRun } from '../../../src/mystery/run.ts';
import { CASE_IDS, type CaseId, type Duo } from '../../../src/mystery/types.ts';
import { heartbeatFrom } from '../../../src/app/mystery/liveRun.ts';
import { parseHeartbeat, type MysteryHeartbeat, type MysteryStationRow } from '../../../src/lib/supabase/mysteryWire.ts';
import { liveStationView } from '../../../src/app/mystery/liveDashboard.tsx';
import type { BoardStation } from '../../../src/lib/supabase/mysteryDashboardFeed.ts';

/** A live board station (server row + heartbeat) as the Laptop 1 feed delivers it. */
function boardStation(beat: MysteryHeartbeat, caseId: CaseId): BoardStation {
  const row: MysteryStationRow = {
    station_id: 'station_a', label: 'Station A', session_id: 's', nickname: 'Vis', character_id: 'ajax', pokemon_id: 'sableye', case_id: caseId,
    status: 'playing', clues_found: beat.clues, catches: beat.catches, sightings: 0, egg_state: beat.eggState, active_time_s: beat.activeTimeS,
    verdict: null, score: null, is_test: false, notice: null, revision: 1, updated_at: new Date(0).toISOString(),
  };
  return { stationId: 'station_a', label: 'Station A', row, heartbeat: beat, lastSeenAt: 0, signalLost: false };
}

const SID = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b';
const DIAG_TITLES = new Set<string>([TITLES.hyde, TITLES.crackstone, TITLES.power, TITLES.egg, TITLES.investigation, TITLES.pattern]);
const sum = (xs: { p: number }[]) => xs.reduce((a, x) => a + x.p, 0);

function checkLive(run: MysteryRun, L: LiveAnalytics, seen: Set<string>): void {
  const f = L.forecasts;
  const emerged = (run as unknown as { hydeEmerged?: boolean }).hydeEmerged ?? true;
  // Hyde: exact spawn rule before emergence ("Rule-based estimate"), zone filter after ("Bayesian estimate")
  if (f.hyde.phase === 'before_emergence') {
    // final: also while the director has the Hyde away (despawned / cooling down) — then the next spawn's odds
    expect(emerged && run.hydeActive).toBe(false);
    expect(f.hyde.label).toBe('Rule-based estimate');
    expect(f.hyde.emergesInS).toBeGreaterThanOrEqual(0);
    // the director's exact distribution: sums to 1, or all 0 while no spawn is eligible (it waits and retries)
    if (f.hyde.spawns.some((s) => s.p > 0)) expect(sum(f.hyde.spawns)).toBeCloseTo(1, 9);
    expect(f.detection).toBeNull();
  } else {
    expect(emerged).toBe(true);
    expect(f.hyde.label).toBe('Bayesian estimate');
    if (f.hyde.zones.length) expect(sum(f.hyde.zones)).toBeCloseTo(1, 6);
    for (const z of f.hyde.zones) expect(z.polygon.length).toBeGreaterThanOrEqual(3);
  }
  if (f.detection) {
    expect(['ML estimate', 'Rule-based risk estimate']).toContain(f.detection.label);
    expect(f.detection.p).toBeGreaterThanOrEqual(0);
    expect(f.detection.p).toBeLessThanOrEqual(1);
  }
  expect(['ML estimate', 'Rule-based estimate']).toContain(f.extraction.label);
  expect(f.extraction.p).toBeGreaterThanOrEqual(0);
  expect(f.extraction.p).toBeLessThanOrEqual(1);
  if (f.egg) {
    expect(f.egg.label).toBe('Bayesian estimate');
    expect(sum(f.egg.sites)).toBeCloseTo(1, 9);
    expect(run.egg.state === 'carried' || run.egg.state === 'delivered').toBe(false);
  } else expect(run.egg.state === 'carried' || run.egg.state === 'delivered').toBe(true);
  if (f.clueAreas) {
    expect(f.clueAreas.label).toBe('Bayesian estimate');
    for (const a of f.clueAreas.areas) expect(a.p).toBeGreaterThanOrEqual(0);
    expect(run.cluesFound.length).toBeLessThan(run.caseDef.clues.length);
  } else expect(run.cluesFound.length).toBe(run.caseDef.clues.length);
  for (const m of L.messages) checkMessage(run, m, seen);
  if (L.advice) checkMessage(run, L.advice, null);
  // Joseph Crackstone: the rule-based risk exists exactly when the case has him (all three cases do)
  const c = f.crackstone;
  if (run.crackstoneBrain && (run.status === 'playing' || run.status === 'accusing')) {
    expect(c).toBeTruthy();
    expect(c!.label).toBe('Rule-based estimate');
    expect(c!.horizonS).toBe(10);
    expect(c!.cells.length).toBeGreaterThan(10);
    expect(c!.cells.every((cell) => cell.sizeM === 4 && cell.p >= 0 && cell.p <= 1 && Number.isFinite(cell.x) && Number.isFinite(cell.z))).toBe(true);
    expect(c!.here.p).toBeGreaterThanOrEqual(0);
    expect(c!.here.p).toBeLessThanOrEqual(1);
    if (c!.here.fact === 'hunting' || c!.here.fact === 'seen') expect(c!.here.p).toBe(1);
    expect(c!.area.name).toBe(run.crackstoneDef!.areaName);
    // scan / curse WARNINGS never enter the message stream (the HUD banners own them)
    for (const m of L.messages) expect(m.id).not.toMatch(/^advice:(take_cover|leave_curse):/);
  } else if (!run.crackstoneBrain) expect(c ?? null).toBeNull();
}

function checkMessage(run: MysteryRun, m: LiveMessage, seen: Set<string> | null): void {
  if (seen) {
    expect(seen.has(m.id), `duplicate id ${m.id}`).toBe(false);
    seen.add(m.id);
  }
  expect(m.id.split(':').length).toBeGreaterThanOrEqual(3); // "<kind>:<code>:<t>…"
  if (m.kind === 'log') {
    expect(m.title).toBe(TITLES.log);
    if (!m.id.startsWith('hint:')) expect(m.text.length).toBeLessThanOrEqual(LOG_MAX); // L1 hint = designer copy, verbatim
  } else if (m.kind === 'diagnostic') {
    expect(DIAG_TITLES.has(m.title)).toBe(true);
    expect(m.text.length).toBeLessThanOrEqual(DIAG_MAX);
    expect(m.basis === 'rule' || m.basis === 'pattern').toBe(true);
    if (m.basis === 'pattern') expect(m.text).toMatch(/Not proof\.$/);
  } else {
    // Crackstone advice (and his area intro) carry the CRACKSTONE headword (UX_ENEMIES §6)
    expect([TITLES.advice, TITLES.crackstone]).toContain(m.title);
    expect(m.text.length).toBeLessThanOrEqual(ADVICE_MAX);
    expect((m.why ?? '').length).toBeLessThanOrEqual(WHY_MAX);
  }
  // facts are words (UX §7.2): copy never prints 0 % or 100 %; estimates use the 5 % display steps
  for (const s of [m.text, m.why ?? '']) {
    expect(s, s).not.toMatch(/(^|[^0-9>])(0|100)%/);
    for (const x of s.match(/\d+%/g) ?? []) expect(Number(x.slice(0, -1)) % 5, s).toBe(0);
  }
  expect(m.priority).toBeGreaterThanOrEqual(0);
  expect(m.priority).toBeLessThanOrEqual(5);
  // never a suspect's name, never an accusation, never another duo's ability
  const names = run.caseDef.suspects.flatMap((s) => [s.name, ...s.name.split(' ')]).filter((w) => w.length > 2);
  for (const n of names) expect(m.text + (m.why ?? '')).not.toContain(n);
  expect(m.text).not.toMatch(/accus|culprit|guilty/i);
  const own = [run.power.def.name, run.move.def.name];
  const all = [...Object.values(REGISTRIES.nightshades).map((n) => n.power.name), ...Object.values(REGISTRIES.partners).map((p) => p.move.name)];
  for (const name of all) if (!own.includes(name)) expect(m.text).not.toContain(name);
}

describe('live() for every duo × case (smoke)', () => {
  it('all 126 duos × 3 cases: forecasts, messages and advice are well-formed before and after emergence', () => {
    const pairs = allPairs();
    expect(pairs).toHaveLength(126);
    let phases = { before: 0, active: 0 };
    let n = 0;
    for (const caseId of CASE_IDS) {
      for (const duo of pairs) {
        const run = new MysteryRun({ duo, seed: `live-smoke-${n++}`, tutorial: false, caseDef: CASES[caseId] });
        const a = createMysteryAnalytics(run, { sessionId: SID });
        const seen = new Set<string>();
        for (let i = 0; i < 23 * 4; i++) {
          a.frame(run, run.update(0.25, { ...IDLE_INPUT, moveZ: 1, lookYawDelta: i % 16 === 0 ? 0.6 : 0 }));
          if (i % 4 === 0) {
            const L = a.live();
            checkLive(run, L, seen);
            if (L.forecasts.hyde.phase === 'active') phases.active++;
            else phases.before++;
          }
        }
      }
    }
    expect(phases.before).toBeGreaterThan(0);
    expect(phases.active).toBeGreaterThan(0);
  }, 180_000);
});

function playWithLive(duo: Duo, seed: string, caseId: CaseId, hintAt: number[] = []) {
  const run = new MysteryRun({ duo, seed, tutorial: false, caseDef: CASES[caseId] });
  const a = createMysteryAnalytics(run, { sessionId: SID, stationId: 'station_a' });
  const bot = new Bot(run, { profile: 'careless', sprintProb: 0.5, useAbilities: true, startDelayMaxS: 0 }, seed);
  const seen = new Set<string>();
  const hints: LiveMessage[] = [];
  const kinds = new Map<string, number>();
  let nextLive = 0;
  let h = 0;
  while (run.status === 'playing' && run.t < 400) {
    a.frame(run, run.update(1 / 60, bot.decide()));
    if (run.t >= nextLive) {
      nextLive += 0.25;
      const L = a.live();
      checkLive(run, L, seen);
      for (const m of L.messages) kinds.set(m.kind, (kinds.get(m.kind) ?? 0) + 1);
    }
    if (h < hintAt.length && run.t >= hintAt[h]) {
      const lvl = ((h % 3) + 1) as 1 | 2 | 3;
      const m = a.hint(lvl);
      if (m) {
        checkMessage(run, m, null);
        hints.push(m);
      }
      h++;
    }
  }
  return { run, a, hints, kinds };
}

describe('advice copy and milestones', () => {
  it('probabilities in copy use display rounding; certainty is said in words', async () => {
    const { pct, oddsCopy } = await import('../../../src/mystery/analytics/prescriptive.ts');
    expect([0, 0.004, 0.03, 0.05, 0.123, 0.5, 0.94, 0.951, 0.999, 1].map(pct)).toEqual(['<5%', '<5%', '<5%', '5%', '10%', '50%', '95%', '>95%', '>95%', '>95%']);
    expect(oddsCopy(1, (x) => `Clue chance ${x}`, 'A missing clue is there')).toBe('A missing clue is there');
    expect(oddsCopy(0.62, (x) => `Clue chance ${x}`, 'A missing clue is there')).toBe('Clue chance 60%');
  });

  it('right after the egg pickup the first automatic advice is the route to Iago Tower', () => {
    let checked = 0;
    for (const [i, caseId] of CASE_IDS.entries()) {
      const run = new MysteryRun({ duo: { characterId: 'morticia', pokemonId: 'aegislash' }, seed: `pickup-${i}`, tutorial: false, caseDef: CASES[caseId] });
      const a = createMysteryAnalytics(run);
      const bot = new Bot(run, { profile: 'stealthy', startDelayMaxS: 0 }, `pickup-${i}`);
      let pickedAt: number | null = null;
      let first: LiveMessage | null = null;
      while (run.status === 'playing' && run.t < 400 && !first) {
        const ev = run.update(1 / 60, bot.decide());
        a.frame(run, ev);
        if (ev.some((e) => e.type === 'egg_pickup')) pickedAt = run.t;
        const msgs = a.live().messages.filter((m) => m.kind === 'advice');
        if (pickedAt !== null && msgs.length) first = msgs[0];
        if (pickedAt !== null && run.t - pickedAt > 20) break;
      }
      if (pickedAt === null || !first || run.hyde.mode === 'CHASE') continue;
      expect(first.text).toBe('Take the egg to Iago Tower.');
      expect(first.target?.label).toBe('Iago Tower');
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  }, 60_000);
});

describe('spectator rule: Laptop 1 never names the true egg site', () => {
  it('once the egg is seen (or certain) the heartbeat carries no site and the card says "seen"', () => {
    const run = new MysteryRun({ duo: { characterId: 'enid', pokemonId: 'gengar' }, seed: 'spect-1', tutorial: false, caseDef: CASES.midnight_signal });
    const a = createMysteryAnalytics(run);
    for (let i = 0; i < 8; i++) a.frame(run, run.update(0.25, IDLE_INPUT));
    const before = a.heartbeat();
    expect(before.eggLocated).toBe(false);
    expect(before.eggSite).not.toBeNull(); // the uncertain estimate (top candidate, p < 0.95)
    expect(before.eggSite!.p).toBeLessThan(0.95);
    // the player sees the egg: the sim publishes eggSeenAt (public); analytics must stop broadcasting any site
    const world = run.map.world!;
    const seenSite = world.eggSites[0].id;
    const spy = Object.create(run) as MysteryRun;
    (spy as unknown as { investigation: () => unknown }).investigation = () => ({ ...run.investigation(), eggSeenAt: seenSite });
    const after = (a as unknown as { engine: { heartbeat(r: MysteryRun): ReturnType<typeof a.heartbeat> } }).engine.heartbeat(spy);
    expect(after.eggLocated).toBe(true);
    expect(after.eggSite).toBeNull();
    const beat = heartbeatFrom('station_a', {
      stationId: 'station_a', phase: 'investigating', nickname: 'x', duo: run.duo, clues: 0, egg: { state: 'resting', tier: null, security: 100 },
      hp: 100, catches: 0, hydeMode: 'PATROL', risk: null, advice: null, activeTimeS: 5, updatedAt: 0,
    }, 'live', after);
    expect(JSON.stringify(beat)).not.toContain(seenSite);
    const parsed = parseHeartbeat(JSON.parse(JSON.stringify(beat)))!;
    const card = liveStationView(boardStation(parsed, 'midnight_signal'), 0);
    expect(card.egg).toBe('seen');
    expect(card.eggOdds).toBeNull();
    // a forged beat with a certain site is not shown either
    expect(parseHeartbeat({ ...beat, eggLocated: undefined, eggSite: { id: seenSite, p: 0.99 } })!.eggSite).toBeNull();
  });
});

describe('live() during whole bot episodes (4 Hz)', () => {
  it('every case: well-formed live analytics, log + advice messages, the hint ladder and recorded hints', () => {
    for (const [i, caseId] of CASE_IDS.entries()) {
      const { run, a, hints, kinds } = playWithLive({ characterId: (['gomez', 'bianca', 'eugene'] as const)[i], pokemonId: (['dusknoir', 'gengar', 'froslass'] as const)[i] }, `live-ep-${i}`, caseId, [3, 6, 9]);
      expect(kinds.get('log') ?? 0).toBeGreaterThan(0);
      expect(kinds.get('advice') ?? 0).toBeGreaterThan(0);
      expect(hints.length).toBe(3);
      // L1: the case's area line (a log line, no target) · L2: an area target · L3: a candidate SITE target
      const [l1, l2, l3] = hints;
      const world = run.map.world!;
      expect(l1.kind).toBe('log');
      expect(l1.text).toBe(run.caseDef.thing.whereHint); // the designer's line verbatim
      if (l2.kind === 'advice' && l2.target && l2.why?.startsWith('Clue chance')) {
        expect(world.areas.some((x) => x.x === l2.target!.x && x.z === l2.target!.z)).toBe(true);
      }
      if (l3.target && /may be wrong/.test(l3.why ?? '')) {
        const sites = [...world.clueSites.flatMap((g) => g.sites), ...world.eggSites];
        expect(sites.some((s) => s.x === l3.target!.x && s.z === l3.target!.z)).toBe(true);
      }
      // Thing's ladder is FREE advice (final): recorded as context recommendations, never as a (paid) hint
      expect(a.collector.recommendations.filter((r) => r.trigger === 'context').length).toBeGreaterThanOrEqual(3);
      expect(a.collector.recommendations.filter((r) => r.trigger === 'hint' && !/^weems_l[123]$/.test(r.action))).toEqual([]);
      // uploads carry the overhaul targets and pass the real server parser without drops
      const targets = new Set<string>();
      for (let b = a.pendingBatch(); b; b = a.pendingBatch()) {
        const body = parseMysteryAppend({ sessionId: SID, events: b.events, forecasts: b.forecasts, recommendations: b.recommendations });
        expect(body.forecasts.length).toBe(b.forecasts.length);
        for (const fc of b.forecasts) {
          targets.add(fc.target);
          expect(Object.keys(fc.features).length).toBeLessThanOrEqual(40);
          for (const [k, v] of Object.entries(fc.features)) {
            expect(k.length).toBeLessThanOrEqual(40);
            expect(v === null || ['number', 'boolean', 'string'].includes(typeof v)).toBe(true);
            if (typeof v === 'string') expect(v.length).toBeLessThanOrEqual(40);
          }
        }
        a.ackBatch(b);
      }
      for (const t of ['egg_site', 'clue_area', 'hyde_spawn', 'hyde_zone', 'extraction', 'detection_15s']) expect(targets.has(t), `${caseId} ${t}`).toBe(true);
    }
  }, 180_000);

  it('heartbeat: analytics numbers round-trip through the strict parser as tokens (no free text) and render fixed copy', () => {
    const { run, a } = playWithLive({ characterId: 'ajax', pokemonId: 'sableye' }, 'live-hb', 'crypt_last_witness', [5]);
    const hb = a.heartbeat();
    expect(hb.cluesTotal).toBe(run.caseDef.clues.length);
    const beat = heartbeatFrom('station_a', {
      stationId: 'station_a', phase: 'investigating', nickname: 'x', duo: run.duo, clues: run.cluesFound.length, egg: { state: run.egg.state, tier: null, security: 100 },
      hp: run.player.hp, catches: run.player.catches, hydeMode: run.hyde.mode, risk: null, advice: null, activeTimeS: run.t, updatedAt: 0,
    }, 'live', hb);
    const parsed = parseHeartbeat(JSON.parse(JSON.stringify(beat)))!;
    expect(parsed).not.toBeNull();
    expect(parsed.objective).toBe(hb.objective);
    expect(parsed.chases).toBe(hb.chases);
    expect(parsed.hydeEmerged).toBe(hb.hydeEmerged);
    expect(parsed.extraction).toBeCloseTo(hb.extraction!.p, 3);
    if (hb.lastThing) expect(parsed.thing).toEqual({ kind: hb.lastThing.kind, code: hb.lastThing.code, ref: hb.lastThing.ref, followed: hb.lastThing.followed });
    expect(JSON.stringify(parsed)).not.toContain(hb.lastThing?.text ?? '§§');
    const card = liveStationView(boardStation(parsed, 'crypt_last_witness'), 0);
    expect(card.tower?.pct).toEqual(expect.any(Number));
    expect(card.objectiveText).toEqual(expect.any(String));
    // forged: free text / bad ids are dropped
    const forged = parseHeartbeat({ ...beat, thing: { kind: 'advice', code: '<b>rude</b>', ref: null, followed: true }, eggSite: { id: 'Robert"); drop', p: 2 } })!;
    expect(forged.thing).toBeNull();
    expect(forged.eggSite).toBeNull();
    // an old station without the overhaul fields still parses
    const old = parseHeartbeat({ v: 1, stationId: 'station_b', phase: 'idle' })!;
    expect(old.objective).toBeNull();
    expect(old.thing).toBeNull();
  }, 60_000);
});
