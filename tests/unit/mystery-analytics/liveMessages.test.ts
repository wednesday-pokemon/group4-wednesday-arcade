// Live descriptive + diagnostic messages (src/mystery/analytics/liveMessages.ts): rule-verified causes from event
// fixtures, labelled patterns, copy limits (log ≤ 34, body ≤ 48), UX rate limits, and INVESTIGATION never naming a
// suspect (R2) or using the answer key.
import { describe, expect, it } from 'vitest';
import {
  DIAG_GAP_S, DIAG_MAX, DIAG_SAME_CODE_S, EventRules, LOG_GAP_S, LOG_MAX, MessageGate, P, TITLES, type MessageCandidate, type MessageContext,
} from '../../../src/mystery/analytics/liveMessages.ts';
import { thingItemText } from '../../../src/mystery/analytics/thingCodes.ts';
import { CASES } from '../../../src/mystery/data/cases.ts';
import { CASE_IDS, type GameEvent, type HazardDef, type NoiseSource, type StampedEvent } from '../../../src/mystery/types.ts';
import { stamp } from './helpers.ts';

const GLASS: HazardDef = { kind: 'noisy_floor', id: 'glass1', name: 'Broken glass', polygon: [{ x: 0, z: 0 }, { x: 0, z: 4 }, { x: 4, z: 4 }, { x: 4, z: 0 }], loudnessAdd: 0.3, look: 'glass' };
const LIGHT: HazardDef = { kind: 'searchlight', id: 'sl1', name: 'Tower searchlight', x: 0, z: 0, rangeM: 20, coneDeg: 30, periodS: 10, phase: 0, loudness: 0.8, cooldownS: 5 };

const ctx = (mentions: Record<string, number> = { falsified_transfer: 1, botanical_residue: 2 }): MessageContext => ({
  abilityLabel: (key, id) => (key === 'Q' ? `Partner's ${id}` : `Hero's ${id}`),
  hazards: [GLASS, LIGHT],
  mentions: (c) => mentions[c] ?? 0,
  clueTotal: 3,
});

function run(items: [number, GameEvent][], c = ctx(), hidden = false): MessageCandidate[] {
  const rules = new EventRules(c, 'walk');
  return stamp(items).flatMap((e: StampedEvent) => rules.onEvent(e, hidden));
}

const heard = (t: number, source: NoiseSource, x = 10, z = 10): [number, GameEvent][] => [
  [t, { type: 'noise', source, x, z, loudness: 0.9, radiusM: 14 }],
  [t, { type: 'hyde_heard', source, loudness: 0.9, distanceM: 9, occluded: false }],
  [t, { type: 'hyde_mode', from: 'PATROL', to: 'INVESTIGATE_SOUND', reason: 'heard_noise' }],
];

describe('diagnostic causes (rule)', () => {
  it('hyde_heard source + stance at that moment → the noise cause', () => {
    const sprint = run([[1, { type: 'stance', stance: 'sprint' }], ...heard(2, 'footstep')]);
    expect(sprint).toEqual([expect.objectContaining({ kind: 'diagnostic', code: 'noise_sprint', title: TITLES.hyde, text: 'Your sprinting made too much noise.', basis: 'rule' })]);
    const crouch = run([[1, { type: 'stance', stance: 'crouch' }], ...heard(2, 'footstep')]);
    expect(crouch[0].code).toBe('noise_crouch');
    const floor = run(heard(2, 'footstep', 2, 2)); // walking on the case's glass floor
    expect(floor[0]).toMatchObject({ code: 'noise_floor', text: 'The broken glass crunched under you.' });
    expect(run(heard(2, 'egg_drop'))[0].code).toBe('noise_egg_drop');
    expect(run(heard(2, 'interact'))[0].code).toBe('noise_search');
    // no hyde_heard at that instant → no claim
    expect(run([[2, { type: 'hyde_mode', from: 'PATROL', to: 'INVESTIGATE_SOUND', reason: 'heard_noise' }]])).toEqual([]);
  });

  it('chase start / catch are P5 HYDE ALERTs; a stun / lure / escape after the own ability is POWER STATUS', () => {
    const m = run([
      [5, { type: 'stance', stance: 'sprint' }],
      [6, { type: 'hyde_sighted', distanceM: 11 }],
      [6, { type: 'hyde_mode', from: 'PATROL', to: 'CHASE', reason: 'saw_player' }],
      [8, { type: 'ability_used', key: 'Q', abilityId: 'shadow_ball', kinds: ['lure', 'stun'], success: true, detail: '' }],
      [8, { type: 'hyde_mode', from: 'CHASE', to: 'SEARCH', reason: 'stunned' }],
    ]);
    expect(m.find((x) => x.code === 'seen')).toMatchObject({ priority: P.alert, text: 'It spotted you sprinting in the open.' });
    expect(m.find((x) => x.code === 'power_stun')).toMatchObject({ title: TITLES.power, text: "Partner's shadow_ball stunned the Hyde.", ref: 'shadow_ball' });
    expect(m.find((x) => x.code === 'escape')).toMatchObject({ kind: 'log', text: 'Hyde lost you. Escapes: 1.' });
    const helped = run([
      [6, { type: 'hyde_mode', from: 'PATROL', to: 'CHASE', reason: 'saw_player' }],
      [7, { type: 'ability_used', key: 'F', abilityId: 'bee_swarm', kinds: ['distract'], success: true, detail: '' }],
      [10, { type: 'hyde_mode', from: 'CHASE', to: 'SEARCH', reason: 'lost_sight' }],
    ]);
    expect(helped.find((x) => x.code === 'power_escape')?.text).toBe("Hero's bee_swarm helped you escape.");
    // too long after the ability (> 5 s) → no claim
    const late = run([
      [6, { type: 'hyde_mode', from: 'PATROL', to: 'CHASE', reason: 'saw_player' }],
      [7, { type: 'ability_used', key: 'F', abilityId: 'bee_swarm', kinds: ['distract'], success: true, detail: '' }],
      [14, { type: 'hyde_mode', from: 'CHASE', to: 'SEARCH', reason: 'lost_sight' }],
    ]);
    expect(late.some((x) => x.code === 'power_escape')).toBe(false);
    const hid = run([[6, { type: 'hyde_mode', from: 'PATROL', to: 'CHASE', reason: 'saw_player' }], [9, { type: 'hyde_mode', from: 'CHASE', to: 'SEARCH', reason: 'lost_sight' }]], ctx(), true);
    expect(hid.some((x) => x.code === 'hidden_escape')).toBe(true);
    const caught = run([[3, { type: 'catch', catchNumber: 1, hpLost: 35, eggSecurityLost: 0, blocked: false }]]);
    expect(caught[0]).toMatchObject({ code: 'caught_1', priority: P.alert, title: TITLES.hyde });
  });

  it('egg damage causes, the searchlight and site / trace logs', () => {
    const m = run([
      [1, { type: 'egg_pickup' }],
      [2, { type: 'egg_damage', amount: 8, cause: 'impact', security: 92 }],
      [3, { type: 'egg_drop', reason: 'impact', security: 92 }],
      [4, { type: 'hazard_triggered', hazardId: 'sl1' }],
      [5, { type: 'site_checked', site: 'egg', siteId: 'e1', found: false }],
      [6, { type: 'trace_found', sourceId: 'vial', siteId: 'e2' }],
      [7, { type: 'passage_opened', passageId: 'p' }],
      [8, { type: 'hyde_emerged', spawnId: 's', x: 0, z: 0 }],
    ]);
    expect(m.map((x) => x.code)).toEqual(['egg_pickup', 'egg_impact', 'egg_drop_impact', 'searchlight', 'site_empty', 'trace', 'passage', 'hyde_emerged']);
    expect(m[0].text).toBe('Egg picked up.'); // "Egg secured." only once it is delivered
    const done = run([[1, { type: 'egg_pickup' }], [9, { type: 'egg_delivered', tier: 'rare', points: 3, security: 90 }]]);
    expect(done.map((x) => x.text)).toEqual(['Egg picked up.', 'Egg secured.']);
    expect(m.find((x) => x.code === 'egg_impact')?.text).toBe('The egg was damaged after a collision.');
    expect(m.find((x) => x.code === 'searchlight')?.text).toBe('The searchlight caught you.');
  });

  it('INVESTIGATION never names a suspect (public mentions count only), for every clue of every case', () => {
    for (const id of CASE_IDS) {
      const c = CASES[id];
      const mentions = Object.fromEntries(c.clues.map((x) => [x.id, x.mentions.length]));
      const items: [number, GameEvent][] = c.clues.map((x, i) => [i + 1, { type: 'clue_found', clueId: x.id, cluesFound: i + 1 }]);
      const m = run(items, { ...ctx(mentions), clueTotal: c.clues.length });
      const inv = m.filter((x) => x.title === TITLES.investigation);
      expect(inv.length).toBe(c.clues.filter((x) => x.mentions.length > 0).length);
      const names = c.suspects.flatMap((s) => [s.name, ...s.name.split(' ')]).filter((w) => w.length > 2);
      for (const x of inv) for (const n of names) expect(x.text).not.toContain(n);
      expect(m.filter((x) => x.kind === 'log').map((x) => x.text)).toEqual(['1 of 3 clues found.', '2 of 3 clues found.', 'All 3 clues found.']);
    }
  });

  it('copy limits: log ≤ 34, diagnostic body ≤ 48', () => {
    const items: [number, GameEvent][] = [
      [1, { type: 'stance', stance: 'sprint' }], ...heard(2, 'footstep'), ...heard(3, 'ability'), ...heard(4, 'impact'), ...heard(5, 'hazard'),
      [6, { type: 'catch', catchNumber: 2, hpLost: 42, eggSecurityLost: 40, blocked: false }],
      [7, { type: 'egg_damage', amount: 40, cause: 'grab', security: 60 }],
      [8, { type: 'clue_found', clueId: 'botanical_residue', cluesFound: 2 }],
    ];
    for (const x of run(items)) {
      if (x.kind === 'log') expect(x.text.length).toBeLessThanOrEqual(LOG_MAX);
      else expect(x.text.length).toBeLessThanOrEqual(DIAG_MAX);
    }
  });
});

describe('patterns (labelled correlation)', () => {
  it('needs ≥ 3 alerts, says "Not proof." and is offered at most once per run', () => {
    const rules = new EventRules(ctx(), 'sprint');
    const items: [number, GameEvent][] = [1, 2, 3].flatMap((k) => heard(k * 10, 'footstep'));
    for (const e of stamp(items)) rules.onEvent(e, false);
    const p = rules.pattern(40)!;
    expect(p).toMatchObject({ basis: 'pattern', title: TITLES.pattern });
    expect(p.text).toMatch(/Not proof\.$/);
    const gate = new MessageGate();
    gate.offer(p);
    expect(gate.release(40, true)).toEqual([]); // never during a threat (dropped)
    gate.offer(p);
    expect(gate.release(41, false).map((r) => r.code)).toEqual(['pattern_sprint']);
    gate.offer({ ...p, t: 100 });
    expect(gate.release(100, false)).toEqual([]); // ≤ 1 per run
  });
});

describe('MessageGate rate limits (UX §6)', () => {
  const diag = (code: string, t: number, priority: number = P.why): MessageCandidate => ({ kind: 'diagnostic', code, title: TITLES.hyde, text: code, basis: 'rule', priority, t });
  const log = (code: string, t: number): MessageCandidate => ({ kind: 'log', code, title: TITLES.log, text: code, priority: P.log, t });

  it('diagnostics ≥ 8 s apart (P5 exempt), same code ≥ 45 s apart, ≤ 3 per minute, a waiting one expires after 4 s', () => {
    const g = new MessageGate();
    g.offer(diag('a', 0));
    expect(g.release(0, false).map((r) => r.code)).toEqual(['a']);
    g.offer(diag('b', 2));
    expect(g.release(2, false)).toEqual([]); // < 8 s since the last
    expect(g.release(2 + DIAG_GAP_S - 3, false)).toEqual([]);
    g.offer(diag('c', 9));
    expect(g.release(9, false).map((r) => r.code)).toEqual(['c']); // b expired / replaced; c released after the gap
    g.offer(diag('alert', 10, P.alert));
    expect(g.release(10, false).map((r) => r.code)).toEqual(['alert']); // P5 interrupts the gap
    g.offer(diag('a', 20));
    expect(g.release(20, false)).toEqual([]); // same code within 45 s
    g.offer(diag('d', 30));
    expect(g.release(30, false)).toEqual([]); // 3 in the last minute already (a, c, alert)
    g.offer(diag('a', DIAG_SAME_CODE_S + 20));
    expect(g.release(DIAG_SAME_CODE_S + 20, false).map((r) => r.code)).toEqual(['a']);
  });

  it('logs ≥ 2.5 s apart; the latest waiting log wins; ids carry the stable code', () => {
    const g = new MessageGate();
    g.offer(log('clues', 0));
    const first = g.release(0, false);
    expect(first[0].msg.id.startsWith('log:clues:')).toBe(true);
    g.offer(log('trace', 1));
    g.offer(log('egg_secured', 1.5));
    expect(g.release(1.5, false)).toEqual([]);
    expect(g.release(LOG_GAP_S, false).map((r) => r.code)).toEqual(['egg_secured']);
  });
});

describe('spectator copy for heartbeat codes', () => {
  it('fixed lines for codes; unknown codes are neutral; abilities only by registry id', () => {
    expect(thingItemText({ kind: 'diagnostic', code: 'noise_sprint', ref: null })).toEqual({ head: TITLES.hyde, text: 'Sprinting made too much noise.' });
    expect(thingItemText({ kind: 'diagnostic', code: 'power_stun', ref: 'shadow_ball' }).text).toBe('Shadow Ball stunned the Hyde.');
    expect(thingItemText({ kind: 'diagnostic', code: 'power_stun', ref: 'nope' }).text).toBe('An ability stunned the Hyde.');
    expect(thingItemText({ kind: 'advice', code: 'use_move', ref: 'shadow_ball' }).text).toBe('Use Shadow Ball');
    expect(thingItemText({ kind: 'advice', code: 'zzz', ref: null }).text).toBe('Advice given');
  });
});
