// PrescriptiveService property tests over many live bot states (several duos and profiles): advice is always feasible,
// never recommends an unavailable / cooling / irrelevant ability or another character's power, a found clue, an
// unreachable spot, a suspect or an accusation. Ability advice is verified by actually pressing the key.
import { describe, expect, it } from 'vitest';
import { hydeTargetable } from '../../../src/mystery/abilities.ts';
import { Bot } from '../../../src/mystery/bot.ts';
import { simulateEpisode } from '../../../src/mystery/analytics/episodes.ts';
import { eggAdvice, evaluateFollow, evaluateOutcome, MAX_REASON, MAX_TEXT, PrescriptiveService, summariseAdvice } from '../../../src/mystery/analytics/prescriptive.ts';
import { CASES } from '../../../src/mystery/data/cases.ts';
import type { Advice, AdviceRecord } from '../../../src/mystery/analytics/types.ts';
import { REGISTRIES } from '../../../src/mystery/draft.ts';
import { MysteryRun } from '../../../src/mystery/run.ts';
import { CASE_IDS, type Duo } from '../../../src/mystery/types.ts';
import { stamp } from './helpers.ts';

const svc = new PrescriptiveService();
const ALL_ABILITY_NAMES = [
  ...Object.values(REGISTRIES.nightshades).map((n) => n.power.name),
  ...Object.values(REGISTRIES.partners).map((p) => p.move.name),
];

function checkAdvice(run: MysteryRun, a: Advice): void {
  const all = [a, ...a.alternatives];
  const suspects = run.caseDef.suspects.flatMap((s) => [s.name, ...s.name.split(' ')]).filter((w) => w.length > 2);
  for (const o of all) {
    expect(o.feasible).toBe(true);
    expect(o.text.length).toBeLessThanOrEqual(MAX_TEXT);
    expect(o.reason.length).toBeLessThanOrEqual(MAX_REASON);
    expect(`Why: ${o.reason}`.length).toBeLessThanOrEqual(60);
    expect(o.text + o.reason).not.toMatch(/accus/i);
    for (const w of suspects) expect(o.text + o.reason).not.toContain(w);
    // another duo's ability is never named
    const own = [run.power.def.name, run.move.def.name];
    for (const name of ALL_ABILITY_NAMES) if (!own.includes(name)) expect(o.text).not.toContain(name);
    if (o.action === 'use_power' || o.action === 'use_move') {
      const slot = o.action === 'use_power' ? run.power : run.move;
      const status = o.action === 'use_power' ? run.powerStatus() : run.moveStatus();
      expect(status.ready, 'never a cooling ability').toBe(true);
      expect(o.ability?.id).toBe(slot.def.id);
      expect(o.ability?.key).toBe(o.action === 'use_power' ? 'F' : 'Q');
      // a Hyde-targeted-only ability is only suggested when the sim's own targeting rule accepts it now
      const kinds = slot.def.effects.map((e) => e.kind);
      if (kinds.every((k) => k === 'stun' || k === 'slow' || k === 'distract')) {
        expect(slot.def.effects.some((e) => hydeTargetable(run, run.hydeBrain, e).ok)).toBe(true);
      }
    }
    if (o.clueId) {
      expect(run.cluesFound).not.toContain(o.clueId);
      const c = run.map.clues.find((x) => x.clueId === o.clueId)!;
      expect(run.playerNav().reachable(run.player, c, run.tuning.player.interactRangeM + 0.7)).toBe(true);
    }
    if (o.action === 'hide') {
      const t = o.target!;
      expect(run.playerNav().reachable(run.player, t, 2)).toBe(true);
      const dMe = Math.hypot(t.x - run.player.x, t.z - run.player.z);
      const dH = Math.hypot(t.x - run.hyde.x, t.z - run.hyde.z);
      expect(dH).toBeGreaterThanOrEqual(dMe + 2);
    }
    if (o.action === 'retrieve_egg') expect(run.egg.state).toBe('dropped');
    if (o.action === 'go_to_tower' || o.action === 'deposit') expect(run.egg.state).toBe('carried');
    if (o.action === 'inspect_clue' || o.action === 'search_room') expect(run.objective()).toBe('find_clues');
    if (o.action === 'stop_sprinting') expect(run.player.stance).toBe('sprint');
    if (o.action === 'evade') expect(run.hyde.mode).toBe('CHASE');
  }
  expect(new Set(all.map((o) => o.action)).size).toBe(all.length);
  expect(a.engine).toBe('rule-based decision engine');
}

describe('PrescriptiveService', () => {
  it('property: every suggestion over many bot snapshots is feasible and honest', () => {
    const duos: Duo[] = [
      { characterId: 'gomez', pokemonId: 'decidueye' },
      { characterId: 'ajax', pokemonId: 'basculegion' },
      { characterId: 'eugene', pokemonId: 'aegislash' },
      { characterId: 'wednesday', pokemonId: 'chandelure' },
      { characterId: 'bianca', pokemonId: 'dhelmise' },
      { characterId: 'enid', pokemonId: 'froslass' },
      { characterId: 'morticia', pokemonId: 'gholdengo' },
    ];
    let checked = 0;
    const actions = new Set<string>();
    duos.forEach((duo, i) => {
      for (const profile of ['careless', 'stealthy'] as const) {
        simulateEpisode(duo, `presc-${i}-${profile}`, { profile, sprintProb: 0.6, useAbilities: true }, {
          onSample(run, sample) {
            if (Math.round(sample.snapshot.t) % 2 === 1) return; // every other second keeps the test fast
            const a = svc.recommend(run);
            expect(a).not.toBeNull();
            checkAdvice(run, a!);
            actions.add(a!.action);
            checked++;
          },
        });
      }
    });
    expect(checked).toBeGreaterThan(600);
    // the engine really exercises several kinds of advice
    expect(actions.size).toBeGreaterThanOrEqual(6);
  }, 120_000);

  it('ability advice holds when acted on: pressing the suggested key is never denied', () => {
    let pressed = 0;
    const duos: Duo[] = [
      { characterId: 'ajax', pokemonId: 'sableye' },
      { characterId: 'gomez', pokemonId: 'dusknoir' },
      { characterId: 'eugene', pokemonId: 'misdreavus' },
      { characterId: 'bianca', pokemonId: 'galarian_corsola' },
      { characterId: 'wednesday', pokemonId: 'gengar' },
    ];
    duos.forEach((duo, i) => {
      for (let k = 0; k < 3; k++) {
        const run = new MysteryRun({ duo, seed: `press-${i}-${k}`, tutorial: false });
        const bot = new Bot(run, { profile: 'careless', sprintProb: 0.7, startDelayMaxS: 0 }, `press-${i}-${k}`);
        const dt = run.tuning.fixedStepS;
        let nextAdvice = 0;
        while (run.status === 'playing' && run.t < 240) {
          const input = bot.decide();
          let press: 'F' | 'Q' | null = null;
          // the visitor turns first, THEN reads Thing's advice and presses at once (a facing-cone power such as a gaze
          // that was valid before the turn may not be after it)
          run.applyLook(input);
          if (run.t >= nextAdvice) {
            nextAdvice = run.t + 0.5;
            const a = svc.recommend(run);
            if (a && (a.action === 'use_power' || a.action === 'use_move')) press = a.ability!.key;
          }
          const before = run.log.length;
          run.setInput({ ...input, power: press === 'F', move: press === 'Q' });
          for (let s = 0; s < 6 && run.status === 'playing'; s++) {
            run.step(dt);
            run.setInput({ ...input, interact: false, power: false, move: false, hint: false });
          }
          if (press) {
            pressed++;
            const fresh = run.log.slice(before);
            expect(fresh.some((e) => e.type === 'ability_denied' && e.key === press), `${duo.characterId}+${duo.pokemonId} ${press} denied`).toBe(false);
            expect(fresh.some((e) => e.type === 'ability_used' && e.key === press)).toBe(true);
          }
        }
      }
    });
    expect(pressed).toBeGreaterThan(3);
  }, 120_000);

  it('property holds on every case (case-specific clue / egg placements and room names)', () => {
    const duos: Duo[] = [
      { characterId: 'ajax', pokemonId: 'gengar' },
      { characterId: 'morticia', pokemonId: 'chandelure' },
    ];
    let checked = 0;
    const roomTexts = new Set<string>();
    for (const [ci, caseId] of CASE_IDS.entries()) {
      duos.forEach((duo, i) => {
        simulateEpisode(duo, `presc-case-${ci}-${i}`, { profile: i ? 'stealthy' : 'careless', sprintProb: 0.5, useAbilities: true, maxTimeS: 300 }, {
          onSample(run, sample) {
            expect(run.caseDef.id).toBe(caseId);
            if (Math.round(sample.snapshot.t) % 3 !== 0) return;
            const a = svc.recommend(run);
            expect(a).not.toBeNull();
            checkAdvice(run, a!);
            checked++;
            const names = run.map.rooms.map((r) => r.name);
            for (const o of [a!, ...a!.alternatives]) {
              const m = /^(?:Search the|Go around via the) (.+?)(?: for evidence)?$/.exec(o.text);
              if (m && !o.text.endsWith('…')) {
                expect([...names, 'open ground']).toContain(m[1]);
                roomTexts.add(`${caseId}:${m[1]}`);
              }
              if (o.action === 'get_egg') expect(o.text).toBe(eggAdvice(run));
            }
          },
        }, { caseDef: CASES[caseId] });
      });
    }
    expect(checked).toBeGreaterThan(150);
  }, 120_000);

  it('egg advice comes from the case being played (its egg objective), never a fixed room', () => {
    const texts = new Set<string>();
    for (const caseId of CASE_IDS) {
      const run = new MysteryRun({ duo: { characterId: 'enid', pokemonId: 'gengar' }, seed: `egg-${caseId}`, tutorial: false, caseDef: CASES[caseId] });
      for (const c of run.caseDef.clues) run.cluesFound.push(c.id);
      expect(run.objective()).toBe('find_egg');
      const expected = CASES[caseId].egg.objective.replace(/\.$/, '');
      expect(eggAdvice(run)).toBe(expected);
      const get = svc.candidates(run).find((o) => o.action === 'get_egg');
      expect(get, caseId).toBeDefined();
      expect(get!.text).toBe(expected);
      expect(get!.target).toEqual({ x: run.egg.x, z: run.egg.z });
      texts.add(get!.text);
      // a run without a case egg objective falls back to the (case-renamed) room the egg lies in
      const fallback = eggAdvice({ ...run, caseDef: { ...run.caseDef, egg: { ...run.caseDef.egg, objective: '' } }, roomAt: run.roomAt.bind(run), egg: run.egg } as unknown as MysteryRun);
      expect(fallback).toBe(`Fetch the egg from the ${run.roomAt(run.egg.x, run.egg.z)?.name ?? 'open ground'}`);
    }
    expect(texts.size).toBe(3);
    expect([...texts].join(' ')).not.toMatch(/Egg Chamber.*Egg Chamber.*Egg Chamber/);
  });

  it('after the deposit it only suggests reviewing the board (never accusing); nothing after the run ends', () => {
    const run = new MysteryRun({ duo: { characterId: 'enid', pokemonId: 'gengar' }, seed: 'acc-1', tutorial: false });
    run.status = 'accusing';
    const a = svc.recommend(run)!;
    expect(a.action).toBe('review_evidence');
    expect(a.alternatives).toEqual([]);
    run.status = 'finished';
    expect(svc.recommend(run)).toBeNull();
  });

  it('follow-up: followed / not followed / no chance, outcome worded "after"', () => {
    const base = (action: Advice['action'], t: number, extra: Partial<Advice> = {}): AdviceRecord => ({
      recNo: 0, t, trigger: 'hint', followed: null, outcome: null, startPos: { x: 0, z: 0 }, startHydeDistM: 10,
      advice: { action, text: 'x', reason: 'y', feasible: true, score: 1, target: null, ability: null, clueId: null, t, alternatives: [], engine: 'rule-based decision engine', ...extra },
    });
    const ev = stamp([
      [10.5, { type: 'stance', stance: 'crouch' }],
      [12, { type: 'ability_used', key: 'Q', abilityId: 'm', kinds: ['stun'], success: true, detail: '' }],
      [30, { type: 'hyde_mode', from: 'PATROL', to: 'CHASE', reason: 'saw_player' }],
    ]);
    const view = (nowT: number, ended = false) => ({ events: ev, samples: [], nowT, ended });
    expect(evaluateFollow(base('crouch', 10), view(11))).toBe(true);
    expect(evaluateFollow(base('use_power', 10), view(19))).toBe(false); // F never pressed within 8 s
    expect(evaluateFollow(base('use_move', 10), view(19))).toBe(true);
    expect(evaluateFollow(base('use_power', 10), view(14, true))).toBeNull(); // run ended inside the window
    expect(evaluateOutcome(base('crouch', 10), view(26))).toBe('undetected_15s');
    expect(evaluateOutcome(base('crouch', 20), view(31))).toBe('detected_15s');
    expect(evaluateOutcome(base('crouch', 20), view(22))).toBeNull();
    const s = summariseAdvice([
      { followed: true, outcome: 'undetected_15s' }, { followed: true, outcome: 'undetected_15s' }, { followed: false, outcome: 'detected_15s' },
    ]);
    expect(s.text).toBe('You followed 2 of 3 tips. After following, you stayed undetected for 15 s in 2 of 2 cases.');
    expect(s.text).not.toMatch(/because/);
  });
});
