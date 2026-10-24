// Shared driver for the per-case "all 126 duos" bot runs (botDuos.<case>.test.ts — one file per case so vitest runs them
// in parallel). The stealthy bot plays the overhaul rules from public knowledge only (site checks, traces, priors).
import { expect } from 'vitest';
import { CASES } from '../../../src/mystery/data/cases.ts';
import { allPairs } from '../../../src/mystery/draft.ts';
import { playEpisode, type BotEpisode } from '../../../src/mystery/episode.ts';
import type { CaseId } from '../../../src/mystery/types.ts';

export interface DuoSummary {
  caseId: CaseId;
  n: number;
  finished: number;
  dnf: number;
  timedOut: number;
  solved: number;
  medianTimeS: number;
  p90TimeS: number;
  maxTimeS: number;
  caught: number;
  sitesChecked: number; // mean site_checked events per episode
  traces: number; // mean trace_found per episode
  examines: number; // mean examined per episode
  passages: number; // episodes that opened the passage
  hazards: number; // mean hazard_triggered per episode
}

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN;
}

export function playAllDuos(caseId: CaseId): { eps: BotEpisode[]; summary: DuoSummary } {
  const caseDef = CASES[caseId];
  const eps = allPairs().map((duo, i) => playEpisode(duo, `duos-${caseId}-${i}`, { profile: 'stealthy', useAbilities: true, startDelayMaxS: 0 }, { caseDef }));
  const fin = eps.filter((e) => e.result?.outcome === 'finished');
  const times = fin.map((e) => e.result!.activeTimeS);
  const count = (type: string) => eps.reduce((a, e) => a + e.events.filter((x) => x.type === type).length, 0) / eps.length;
  const summary: DuoSummary = {
    caseId,
    n: eps.length,
    finished: fin.length,
    dnf: eps.filter((e) => e.result?.outcome === 'dnf').length,
    timedOut: eps.filter((e) => e.timedOut).length,
    solved: fin.filter((e) => e.result!.verdict === 'case_solved').length,
    medianTimeS: quantile(times, 0.5),
    p90TimeS: quantile(times, 0.9),
    maxTimeS: Math.max(...times),
    caught: eps.filter((e) => (e.result?.catches ?? 0) > 0).length,
    sitesChecked: Math.round(count('site_checked') * 10) / 10,
    traces: Math.round(count('trace_found') * 10) / 10,
    examines: Math.round(count('examined') * 10) / 10,
    passages: eps.filter((e) => e.events.some((x) => x.type === 'passage_opened')).length,
    hazards: Math.round(count('hazard_triggered') * 10) / 10,
  };
  return { eps, summary };
}

/** No softlock ever; DNFs (two catches) are fair outcomes but must stay rare; finishers found all 3 clues and solved it. */
export function expectAllDuosOk(caseId: CaseId): DuoSummary {
  const { eps, summary } = playAllDuos(caseId);
  console.log(`126 duos ${caseId}`, JSON.stringify(summary));
  expect(eps.filter((e) => e.timedOut).map((e) => e.seed)).toEqual([]);
  expect(summary.dnf).toBeLessThanOrEqual(6);
  for (const e of eps) {
    if (e.result?.outcome !== 'finished') continue;
    expect(e.result.cluesFound, e.seed).toHaveLength(3);
    expect(e.result.verdict, e.seed).toBe('case_solved');
    expect(e.events.filter((x) => x.type === 'hyde_emerged'), e.seed).toHaveLength(1);
  }
  return summary;
}
