// Analytics are SYSTEM services: no character / Pokémon id literals in their sources, identical capability for every
// duo (all 126, smoke) and specifically Enid+Gengar, Morticia+Aegislash, Ajax+Gholdengo, Wednesday+Gengar; every layer
// works for each of the three cases with random duos; no browser-reachable analytics module imports the answer keys.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeCollector } from '../../../src/mystery/analytics/descriptive.ts';
import { diagnoseSession } from '../../../src/mystery/analytics/diagnostic.ts';
import { simulateEpisode } from '../../../src/mystery/analytics/episodes.ts';
import { duoNumbers } from '../../../src/mystery/analytics/features.ts';
import { BUNDLED_MODEL } from '../../../src/mystery/analytics/model/index.ts';
import { PredictiveService } from '../../../src/mystery/analytics/predictive.ts';
import { PrescriptiveService } from '../../../src/mystery/analytics/prescriptive.ts';
import { allPairs, POKEMON_IDS } from '../../../src/mystery/draft.ts';
import { playEpisode } from '../../../src/mystery/episode.ts';
import { CASES } from '../../../src/mystery/data/cases.ts';
import { Rng } from '../../../src/mystery/rng.ts';
import { CASE_IDS, NIGHTSHADE_IDS, type CaseId, type Duo } from '../../../src/mystery/types.ts';
import { dashboard } from '../../../src/mystery/analytics/index.ts';
import { failureReasons } from '../../../src/mystery/analytics/diagnostic.ts';
import { NAMED_DUOS, recordOf } from './helpers.ts';

const ROOT = 'src/mystery/analytics';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe('no character / Pokémon branches in analytics', () => {
  it('source scan: no id literals (case-insensitive, whole words) in src/mystery/analytics/**', () => {
    const ids = [...NIGHTSHADE_IDS, ...POKEMON_IDS, ...POKEMON_IDS.map((p) => p.replace(/_/g, ' '))];
    const re = new RegExp(`\\b(${ids.join('|')})\\b`, 'i');
    const all = files(ROOT);
    expect(all.length).toBeGreaterThan(10);
    for (const f of all) {
      const text = readFileSync(f, 'utf8');
      const m = re.exec(text);
      expect(m, `${f} mentions "${m?.[0]}"`).toBeNull();
      // no switching on ids of the duo either
      expect(/\b(characterId|pokemonId)\s*===/.test(text), `${f} compares a duo id`).toBe(false);
    }
  });
});

describe('answer-key secrecy of the analytics layer', () => {
  it('only the node-only episode simulator imports data/solutions.ts; the public API never reaches it', () => {
    const importers = files(ROOT).filter((f) => /from '[^']*data\/solutions(\.ts)?'/.test(readFileSync(f, 'utf8')));
    expect(importers.map((f) => f.replace(/\\/g, '/'))).toEqual(['src/mystery/analytics/episodes.ts']);
    for (const f of files(ROOT)) {
      if (f.endsWith('episodes.ts')) continue;
      // value imports only (`import type` is erased at build time)
      const text = readFileSync(f, 'utf8');
      expect(/^import (?!type )[^;]*from '\.\/episodes(\.ts)?'/m.test(text), `${f} imports the episode simulator`).toBe(false);
      expect(/^import (?!type )[^;]*mystery\/episode(\.ts)?'/m.test(text) || /from '\.\.\/episode(\.ts)?'/.test(text), `${f} imports src/mystery/episode.ts`).toBe(false);
    }
  });
});

const predictive = new PredictiveService(BUNDLED_MODEL);
const prescriptive = new PrescriptiveService();

function smoke(duo: Duo, seed: string, maxTimeS: number, caseId?: CaseId) {
  let advice = 0;
  let samples = 0;
  const actions = new Set<string>();
  const ep = simulateEpisode(duo, seed, { profile: 'careless', sprintProb: 0.5, useAbilities: true, maxTimeS, startDelayMaxS: 0 }, {
    onSample(run) {
      if (caseId) expect(run.caseDef.id).toBe(caseId);
      samples++;
      const a = prescriptive.recommend(run);
      if (a) {
        advice++;
        actions.add(a.action);
        if (a.ability) expect([run.power.def.id, run.move.def.id]).toContain(a.ability.id);
      }
    },
  }, caseId ? { caseDef: CASES[caseId] } : {});
  const c = ep.collector;
  const rep = describeCollector(c);
  const diag = diagnoseSession(c.events, { initialStance: c.initialStance(), caseId: c.meta.caseId ?? null, result: c.result });
  const duoNums = duoNumbers(c.meta.factors);
  const risks = c.samples.map((s, i) => predictive.detection({
    snapshot: s.snapshot, prev: c.samples[i - 1]?.snapshot ?? null, context: s.context, duo: duoNums, caseId: c.meta.caseId ?? null, clueTotal: ep.run.caseDef.clues.length,
  }));
  return { ep, rep, diag, risks, advice, samples, actions };
}

describe('every duo gets the same analytics', () => {
  it('all 126 duos: telemetry, descriptive, diagnostic, predictive and prescriptive run (short smoke episodes)', () => {
    const pairs = allPairs();
    expect(pairs).toHaveLength(126);
    for (const [i, duo] of pairs.entries()) {
      const s = smoke(duo, `smoke-${i}`, 25);
      expect(s.ep.collector.events.length).toBeGreaterThan(0);
      expect(s.rep.duo).toEqual(duo);
      expect(Array.isArray(s.diag.causes) && Array.isArray(s.diag.patterns)).toBe(true);
      expect(s.risks.length).toBe(s.samples);
      expect(s.risks.every((r) => r.source === 'ml' && r.p >= 0 && r.p <= 1)).toBe(true);
      expect(s.advice).toBe(s.samples); // advice available at every playing sample
    }
  }, 120_000);

  it('Enid+Gengar, Morticia+Aegislash, Ajax+Gholdengo and Wednesday+Gengar have identical capability', () => {
    const shapes = NAMED_DUOS.map((duo, i) => {
      const s = smoke(duo, `named-${i}`, 120);
      return {
        duo,
        reportKeys: Object.keys(s.rep).sort(),
        hydeKeys: Object.keys(s.rep.hyde).sort(),
        diagKeys: Object.keys(s.diag).sort(),
        riskSource: s.risks[0].source,
        riskLabel: s.risks[0].label,
        riskKeys: Object.keys(s.risks[0]).sort(),
        advicePerSample: s.advice / s.samples,
        modelCard: predictive.modelCard().resultsLabel,
      };
    });
    const ref = shapes[0];
    for (const s of shapes) {
      expect(s.reportKeys).toEqual(ref.reportKeys);
      expect(s.hydeKeys).toEqual(ref.hydeKeys);
      expect(s.diagKeys).toEqual(ref.diagKeys);
      expect(s.riskSource).toBe('ml');
      expect(s.riskLabel).toBe(ref.riskLabel);
      expect(s.riskKeys).toEqual(ref.riskKeys);
      expect(s.advicePerSample).toBe(1);
      expect(s.modelCard).toBe(ref.modelCard);
    }
  }, 120_000);
});

describe('every case gets every layer, for random duos', () => {
  it('3 cases × 4 seeded random duos: telemetry, descriptive, diagnostic, predictive, prescriptive and the dashboard', () => {
    const pairs = allPairs();
    const rng = new Rng('analytics-cases', 'duos');
    const records = [];
    for (const [ci, caseId] of CASE_IDS.entries()) {
      for (let k = 0; k < 4; k++) {
        const duo = rng.pick(pairs);
        const s = smoke(duo, `case-smoke-${ci}-${k}`, 240, caseId);
        const c = s.ep.collector;
        expect(c.meta.caseId).toBe(caseId);
        expect(c.meta.caseVersion).toBe(CASES[caseId].version);
        expect(s.rep.caseId).toBe(caseId);
        expect(s.rep.clues.total).toBe(CASES[caseId].clues.length);
        expect(s.rep.clues.found.every((f) => CASES[caseId].clues.some((x) => x.id === f.clueId))).toBe(true);
        expect(Array.isArray(s.diag.caseReasons)).toBe(true);
        if (c.result && c.result.verdict !== 'case_solved') expect(failureReasons(s.diag).length).toBeGreaterThan(0);
        expect(s.risks.length).toBe(s.samples);
        expect(s.risks.every((r) => r.source === 'ml' && r.label === 'ML estimate' && r.p >= 0 && r.p <= 1)).toBe(true);
        expect(s.advice).toBe(s.samples);
        records.push(recordOf(s.ep));
      }
    }
    const d = dashboard(records);
    expect(d.descriptive.cases.map((c) => c.runs)).toEqual([4, 4, 4]);
    for (const id of CASE_IDS) {
      const one = dashboard(records, { caseId: id });
      expect(one.scope).toBe(id);
      expect(one.descriptive.runs).toBe(4);
      expect(one.descriptive.clueRates.every((r) => r.caseId === id)).toBe(true);
      expect(one.predictive.card.source).toBe('ml');
    }
  }, 180_000);
});

describe('simulateEpisode mirrors playEpisode exactly', () => {
  it('same events and snapshots for the same (duo, seed, options, case)', () => {
    for (const [i, duo] of NAMED_DUOS.entries()) {
      const opts = { profile: i % 2 ? 'careless' : 'stealthy', useAbilities: true } as const;
      const caseDef = CASES[CASE_IDS[i % CASE_IDS.length]];
      const a = playEpisode(duo, `mirror-${i}`, opts, { caseDef });
      const b = simulateEpisode(duo, `mirror-${i}`, opts, { onSample: (run) => void prescriptive.recommend(run) }, { caseDef });
      expect(b.run.caseDef.id).toBe(caseDef.id);
      expect(b.collector.events).toEqual(a.events);
      expect(b.collector.samples.map((s) => s.snapshot)).toEqual(a.snapshots);
      expect(b.result).toEqual(a.result);
    }
  }, 120_000);
});
