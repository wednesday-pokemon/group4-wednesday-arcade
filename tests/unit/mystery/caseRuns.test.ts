// Full visits in every case: solvability with any duo (powers help, never required), the one-shot accusation rules,
// F powers pointing at THIS case's clues / egg, and determinism per (duo, seed, case).
import { describe, expect, it } from 'vitest';
import { CASES } from '../../../src/mystery/data/cases.ts';
import { CASE_SOLUTIONS } from '../../../src/mystery/data/solutions.ts';
import { caseMap } from '../../../src/mystery/defaults.ts';
import { POKEMON_IDS, REGISTRIES } from '../../../src/mystery/draft.ts';
import { playEpisode, type BotEpisode } from '../../../src/mystery/episode.ts';
import { yawTo } from '../../../src/mystery/geometry.ts';
import { MysteryRun } from '../../../src/mystery/run.ts';
import {
  CASE_IDS, NIGHTSHADE_IDS, SUSPECT_IDS, type CaseId, type ClueId, type Duo, type NightshadeId, type SuspectId, type Vec2,
} from '../../../src/mystery/types.ts';
import { hold } from './helpers.ts';

/** Duos with a reveal power (F or Q) — the rest must find the clues by exploring. */
const REVEALS = (d: Duo) =>
  [REGISTRIES.nightshades[d.characterId].power, REGISTRIES.partners[d.pokemonId].move].some((a) => a.effects.some((e) => e.kind === 'reveal_clues'));

/** 21 duos per case: every Nightshade × 3 Pokémon, rotated per case so the 3 cases cover all 18 Pokémon each. */
function duosFor(caseIndex: number): { duo: Duo; useAbilities: boolean }[] {
  const out: { duo: Duo; useAbilities: boolean }[] = [];
  NIGHTSHADE_IDS.forEach((c, n) => {
    for (let k = 0; k < 3; k++) out.push({ duo: { characterId: c, pokemonId: POKEMON_IDS[(n * 3 + k + caseIndex * 7) % 18] }, useAbilities: k !== 1 });
  });
  return out;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

function expectSolved(ep: BotEpisode, caseId: CaseId): void {
  const tag = `${caseId} ${ep.duo.characterId}+${ep.duo.pokemonId} ${ep.seed}`;
  const sol = CASE_SOLUTIONS[caseId];
  const r = ep.result!;
  expect(ep.timedOut, tag).toBe(false);
  expect(r, tag).toMatchObject({ outcome: 'finished', verdict: 'case_solved', caseId, caseVersion: CASES[caseId].version, accused: sol.culprit, correct: true, deductionCorrect: true });
  expect([...r.cluesFound].sort(), tag).toEqual([...sol.supportingEvidence].sort());
  expect([...r.evidence].sort(), tag).toEqual([...sol.supportingEvidence].sort());
  expect(ep.events.filter((e) => e.type === 'egg_delivered'), tag).toHaveLength(1);
  expect(r.eggPoints).toBe(ep.run.egg.points);
  expect(r.activeTimeS, tag).toBeGreaterThan(60);
  expect(r.activeTimeS, tag).toBeLessThan(360);
  for (const e of ep.events) if (e.type === 'clue_found') expect(CASES[caseId].clues.map((c) => c.id), tag).toContain(e.clueId);
}

const pacing: Record<string, unknown> = {};

describe('every case is solvable by the stealthy bot with a spread of duos (21 per case)', () => {
  CASE_IDS.forEach((caseId, ci) => {
    it(`${CASES[caseId].number} ${caseId}`, () => {
      const caseDef = CASES[caseId];
      const times: number[] = [];
      const retried: string[] = [];
      let withReveal = 0;
      let abilityUses = 0;
      for (const { duo, useAbilities } of duosFor(ci)) {
        const seed = `solve-${caseId}-${duo.characterId}-${duo.pokemonId}`;
        let ep = playEpisode(duo, seed, { profile: 'stealthy', useAbilities }, { caseDef });
        expect(ep.timedOut, seed).toBe(false); // a softlock is never acceptable
        if (ep.result?.outcome === 'dnf') {
          // two catches are a fair outcome, not a design hole: the same duo must solve it on another night
          retried.push(`${duo.characterId}+${duo.pokemonId}`);
          ep = playEpisode(duo, `${seed}-again`, { profile: 'stealthy', useAbilities }, { caseDef });
        }
        expectSolved(ep, caseId);
        expect(ep.run.map.id).toBe(caseMap(caseId).id);
        times.push(ep.result!.activeTimeS);
        if (REVEALS(duo)) withReveal++;
        abilityUses += ep.events.filter((e) => e.type === 'ability_used').length;
        if (!useAbilities) expect(ep.events.some((e) => e.type === 'ability_used')).toBe(false);
      }
      expect(withReveal).toBeGreaterThanOrEqual(3);
      expect(21 - withReveal).toBeGreaterThanOrEqual(3);
      expect(retried.length, `DNFs (retried): ${retried.join(', ')}`).toBeLessThanOrEqual(2);
      pacing[caseId] = { n: times.length, medianS: median(times), minS: Math.min(...times), maxS: Math.max(...times), dnfRetried: retried, abilityUses };
      expect(median(times)).toBeLessThan(300);
      console.log(`pacing ${caseId}`, JSON.stringify(pacing[caseId]));
    }, 120_000);
  });
});

// ------------------------------------------------------------------------------------------------ accusation

/** A run of `caseId` standing at the deposit: chosen clues found, egg delivered (status 'accusing'). */
function atAccusation(caseId: CaseId, found: ClueId[] = CASES[caseId].clues.map((c) => c.id)): MysteryRun {
  const run = new MysteryRun({ duo: { characterId: 'enid', pokemonId: 'gengar' }, seed: `acc-${caseId}`, caseDef: CASES[caseId] });
  run.hydeBrain.active = false;
  run.cluesFound.push(...found);
  run.egg.state = 'carried';
  run.player.x = run.map.tower.x;
  run.player.z = run.map.tower.z;
  hold(run, 1.2, { interact: true });
  expect(run.status).toBe('accusing');
  return run;
}

for (const caseId of CASE_IDS) {
  const def = CASES[caseId];
  const sol = CASE_SOLUTIONS[caseId];
  const all = def.clues.map((c) => c.id);
  const innocents = SUSPECT_IDS.filter((s) => s !== sol.culprit);
  const other = CASE_IDS.find((c) => c !== caseId)!;

  describe(`${def.number} ${caseId}: the one-shot accusation`, () => {
    it('culprit + exactly the three clues → case_solved', () => {
      const run = atAccusation(caseId);
      const ev = run.accuse({ suspectId: sol.culprit, evidence: [...all].reverse() }, sol);
      expect(ev.map((e) => e.type)).toEqual(['accusation', 'finish']);
      expect(ev[0]).toMatchObject({ suspectId: sol.culprit, correct: true, cluesFound: 3, deductionCorrect: true });
      expect(ev[1]).toMatchObject({ verdict: 'case_solved' });
      expect(run.result()).toMatchObject({ verdict: 'case_solved', caseId, caseVersion: def.version, correct: true, deductionCorrect: true });
    });

    for (const s of innocents) {
      it(`accusing the innocent ${s} → egg_secured_mystery_unsolved, correct false`, () => {
        const run = atAccusation(caseId);
        run.accuse({ suspectId: s, evidence: [...all] }, sol);
        // the evidence itself was the right set: deductionCorrect reports the evidence, not the suspect
        expect(run.result()).toMatchObject({ verdict: 'egg_secured_mystery_unsolved', accused: s, correct: false, deductionCorrect: true });
      });
    }

    it('culprit with missing evidence → unsolved, deductionCorrect false', () => {
      const run = atAccusation(caseId);
      run.accuse({ suspectId: sol.culprit, evidence: all.slice(0, 2) }, sol);
      expect(run.result()).toMatchObject({ verdict: 'egg_secured_mystery_unsolved', correct: true, deductionCorrect: false, evidence: all.slice(0, 2) });
    });

    it('culprit with an extra case-file note cited → unsolved, deductionCorrect false (the note is recorded)', () => {
      const run = atAccusation(caseId);
      run.accuse({ suspectId: sol.culprit, evidence: [...all, def.notes[0].id] }, sol);
      expect(run.result()).toMatchObject({ verdict: 'egg_secured_mystery_unsolved', correct: true, deductionCorrect: false, evidence: [...all, def.notes[0].id] });
    });

    it('the culprit with only two clues found cannot cite the third → unsolved', () => {
      const run = atAccusation(caseId, all.slice(1));
      run.accuse({ suspectId: sol.culprit, evidence: [...all, 'bogus', CASES[other].clues[0].id] }, sol);
      expect(run.result()).toMatchObject({ verdict: 'egg_secured_mystery_unsolved', correct: true, deductionCorrect: false, evidence: all.slice(1) });
    });

    it('null → not_accused with no evidence recorded', () => {
      const run = atAccusation(caseId);
      run.accuse({ suspectId: null, evidence: [...all] }, sol);
      expect(run.result()).toMatchObject({ verdict: 'not_accused', accused: null, correct: false, deductionCorrect: false, evidence: [] });
    });

    it('a second accuse() returns [] and changes nothing', () => {
      const run = atAccusation(caseId);
      run.accuse({ suspectId: innocents[0], evidence: [def.notes[1].id] }, sol);
      const before = { result: run.result(), log: run.log.length };
      expect(run.accuse({ suspectId: sol.culprit, evidence: [...all] }, sol)).toEqual([]);
      expect(run.result()).toEqual(before.result);
      expect(run.log).toHaveLength(before.log);
    });

    it("another case's (or a stale) answer key and unknown suspects are refused; the real one still works", () => {
      const run = atAccusation(caseId);
      expect(run.accuse({ suspectId: sol.culprit, evidence: [...all] }, CASE_SOLUTIONS[other])).toEqual([]);
      expect(run.accuse({ suspectId: sol.culprit, evidence: [...all] }, { ...sol, version: sol.version + 1 })).toEqual([]);
      expect(run.accuse({ suspectId: 'wednesday' as SuspectId, evidence: [...all] }, sol)).toEqual([]);
      expect(run.status).toBe('accusing');
      expect(run.log.some((e) => e.type === 'accusation')).toBe(false);
      expect(run.accuse({ suspectId: sol.culprit, evidence: [...all] }, sol).map((e) => e.type)).toEqual(['accusation', 'finish']);
    });
  });
}

// ------------------------------------------------------------------------------------------------ F powers per case

/** A walkable spot 5–9 m from `goal` (start component), from which `goal` is clearly the nearest of `among`. */
function standNear(run: MysteryRun, goal: Vec2, among: Vec2[]): Vec2 {
  const nav = run.playerNav(true);
  const comp = nav.componentAt(run.map.playerStart);
  let best: { at: Vec2; d: number } | null = null;
  for (let i = 0; i < nav.blocked.length; i++) {
    if (nav.component[i] !== comp) continue;
    const at = nav.center(i);
    const d = Math.hypot(at.x - goal.x, at.z - goal.z);
    if (d < 5 || d > 9) continue;
    if (among.some((o) => o !== goal && Math.hypot(at.x - o.x, at.z - o.z) < d + 2)) continue;
    if (!best || Math.abs(d - 7) < Math.abs(best.d - 7)) best = { at, d };
  }
  expect(best, `no stand point near ${goal.x},${goal.z}`).not.toBeNull();
  return best!.at;
}

function powerRun(caseId: CaseId, characterId: NightshadeId): MysteryRun {
  return new MysteryRun({ duo: { characterId, pokemonId: 'aegislash' }, seed: `fx-${caseId}-${characterId}`, caseDef: CASES[caseId] });
}

function pressF(run: MysteryRun) {
  run.power.readyAt = run.t; // re-arm between probes
  return hold(run, run.tuning.fixedStepS, { power: true });
}

/** Puts the Hyde ~3 m in front of the player with a clear line (for the Hyde-targeted powers). */
function faceHyde(run: MysteryRun, at: Vec2): void {
  const hn = run.hydeNav();
  for (const [dx, dz] of [[0, -3], [3, 0], [0, 3], [-3, 0], [2, -2], [-2, 2]]) {
    const h = { x: at.x + dx, z: at.z + dz };
    if (!hn.walkable(h.x, h.z) || !run.world.lineOfSight(at.x, at.z, h.x, h.z)) continue;
    run.player.x = at.x;
    run.player.z = at.z;
    run.player.yaw = yawTo(at.x, at.z, h.x, h.z);
    run.hyde.x = h.x;
    run.hyde.z = h.z;
    run.hyde.yaw = yawTo(h.x, h.z, at.x, at.z);
    run.hyde.path = [];
    return;
  }
  throw new Error(`no Hyde spot near ${at.x},${at.z}`);
}

for (const caseId of CASE_IDS) {
  const def = CASES[caseId];
  const map = caseMap(caseId);
  const clueSpots = map.clues.map((c) => ({ id: c.clueId, at: { x: c.x, z: c.z } }));
  const spots = clueSpots.map((c) => c.at);

  describe(`${def.number} ${caseId}: every F power works on this case's island`, () => {
    for (const who of ['wednesday', 'eugene'] as const) {
      it(`${who}: reveal_clues shows this case's nearest clue, then the egg once all clues are in`, () => {
        const run = powerRun(caseId, who);
        for (const c of clueSpots) {
          const at = standNear(run, c.at, spots);
          run.player.x = at.x;
          run.player.z = at.z;
          const ev = pressF(run);
          expect(ev.find((e) => e.type === 'ability_used'), c.id).toBeTruthy();
          expect(run.effects().revealedClues, c.id).toEqual([c.id]);
        }
        run.cluesFound.push(...def.clues.map((c) => c.id));
        const at = standNear(run, map.eggSpawn, [map.eggSpawn]);
        run.player.x = at.x;
        run.player.z = at.z;
        pressF(run);
        expect(run.effects()).toMatchObject({ revealedClues: [], revealEgg: true });
      });
    }

    it("enid: the scent trail leads to this case's nearest clue, then the egg, then the tower", () => {
      const run = powerRun(caseId, 'enid');
      run.hydeBrain.active = false;
      for (const c of clueSpots) {
        const at = standNear(run, c.at, spots);
        run.player.x = at.x;
        run.player.z = at.z;
        hold(run, 0.6); // the sim caches the trail for 0.5 s; let the teleport's stale path expire
        pressF(run);
        const trail = run.effects().scentTrail!;
        expect(trail.length, c.id).toBeGreaterThan(1);
        const end = trail[trail.length - 1];
        expect(Math.hypot(end.x - c.at.x, end.z - c.at.z), c.id).toBeLessThan(0.75);
        expect(run.effects().speedBoost).toBe(true);
      }
      run.cluesFound.push(...def.clues.map((c) => c.id));
      const at = standNear(run, map.eggSpawn, [map.eggSpawn]);
      run.player.x = at.x;
      run.player.z = at.z;
      hold(run, 0.6);
      pressF(run);
      let trail = run.effects().scentTrail!;
      let end = trail[trail.length - 1];
      expect(Math.hypot(end.x - map.eggSpawn.x, end.z - map.eggSpawn.z)).toBeLessThan(0.75);
      run.egg.state = 'carried';
      hold(run, 0.6); // the trail is cached for 0.5 s
      trail = run.effects().scentTrail!;
      end = trail[trail.length - 1];
      expect(Math.hypot(end.x - map.tower.x, end.z - map.tower.z)).toBeLessThan(map.tower.radius);
    });

    it('morticia / bianca / ajax / gomez: the Hyde-targeted powers land next to each clue spot', () => {
      for (const who of ['morticia', 'bianca', 'ajax', 'gomez'] as const) {
        for (const c of clueSpots) {
          const run = powerRun(caseId, who);
          faceHyde(run, standNear(run, c.at, spots));
          const ev = pressF(run);
          expect(ev.find((e) => e.type === 'ability_used'), `${who} @ ${c.id}`).toMatchObject({ success: true });
          const fx = run.effects();
          if (who === 'morticia') expect(fx.premonitionPath?.length ?? 0).toBeGreaterThanOrEqual(1);
          if (who === 'bianca') expect(fx.lurePoint).not.toBeNull();
          if (who === 'ajax') expect(fx.hydeStunned && fx.hydePetrified).toBe(true);
          if (who === 'gomez') expect(fx.hydeStunned).toBe(true); // away from the switch: the stun applies
        }
      }
    });

    it('gomez at the switch opens the shortcut gate; the tower is then closer and every clue still reachable', () => {
      const run = powerRun(caseId, 'gomez');
      run.hydeBrain.active = false;
      const sw = map.powerSwitch!;
      run.player.x = sw.x;
      run.player.z = sw.z + 0.8;
      pressF(run);
      expect(run.isWallOpen(sw.gateWallId)).toBe(true);
      const open = run.playerNav();
      const closed = run.playerNav(true);
      const from = { x: sw.x, z: sw.z + 0.8 };
      const len = (path: Vec2[] | null) => (path ?? []).reduce((acc, p, i, a) => acc + Math.hypot(p.x - (i ? a[i - 1].x : from.x), p.z - (i ? a[i - 1].z : from.z)), 0);
      expect(len(open.findPath(from, map.tower))).toBeLessThan(len(closed.findPath(from, map.tower)) - 10);
      for (const c of spots) expect(open.reachable(map.playerStart, c, run.tuning.player.interactRangeM)).toBe(true);
    });
  });
}

// ------------------------------------------------------------------------------------------------ determinism

describe('determinism per (duo, seed, case)', () => {
  const duo: Duo = { characterId: 'bianca', pokemonId: 'froslass' };

  it('same duo + seed + case → identical log, snapshots and result', () => {
    for (const caseId of CASE_IDS) {
      const a = playEpisode(duo, 'det-case', { profile: 'careless' }, { caseDef: CASES[caseId] });
      const b = playEpisode(duo, 'det-case', { profile: 'careless' }, { caseDef: CASES[caseId] });
      expect(JSON.stringify(a.events), caseId).toBe(JSON.stringify(b.events));
      expect(a.snapshots).toEqual(b.snapshots);
      expect(a.result).toEqual(b.result);
    }
  });

  it('different cases → disjoint clue sets, different logs; the egg tier depends on the seed only', () => {
    const eps = CASE_IDS.map((caseId) => playEpisode(duo, 'det-case', { profile: 'stealthy' }, { caseDef: CASES[caseId] }));
    const found = eps.map((ep) => new Set(ep.events.filter((e) => e.type === 'clue_found').map((e) => (e as { clueId: ClueId }).clueId)));
    for (let i = 0; i < 3; i++) {
      expect(found[i].size).toBe(3);
      for (let j = i + 1; j < 3; j++) {
        expect([...found[i]].filter((x) => found[j].has(x))).toEqual([]);
        expect(JSON.stringify(eps[i].events)).not.toBe(JSON.stringify(eps[j].events));
      }
    }
    expect(new Set(eps.map((e) => e.run.egg.tier)).size).toBe(1);
    expect(eps.map((e) => e.result!.caseId)).toEqual([...CASE_IDS]);
  });
});
