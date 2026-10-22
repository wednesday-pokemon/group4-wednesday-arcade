// Shared fixtures for the analytics tests: seeded simulated episodes (any of the three cases) and hand-written logs.
import { simulateEpisode, type EpisodeHooks, type SimEpisode } from '../../../src/mystery/analytics/episodes.ts';
import type { SessionRecord } from '../../../src/mystery/analytics/types.ts';
import type { BotOptions } from '../../../src/mystery/bot.ts';
import { CASES } from '../../../src/mystery/data/cases.ts';
import type { CaseId, Duo, GameEvent, StampedEvent } from '../../../src/mystery/types.ts';

const cache = new Map<string, SimEpisode>();

/** One seeded bot episode of `caseId` (default: the run's default case, Case 01). Cached unless hooks are given. */
export function episode(duo: Duo, seed: string, options: BotOptions, hooks?: EpisodeHooks, caseId?: CaseId): SimEpisode {
  const runOptions = caseId ? { caseDef: CASES[caseId] } : {};
  const key = `${duo.characterId}+${duo.pokemonId}|${seed}|${caseId ?? 'default'}|${JSON.stringify(options)}`;
  if (hooks) return simulateEpisode(duo, seed, options, hooks, runOptions);
  let ep = cache.get(key);
  if (!ep) {
    ep = simulateEpisode(duo, seed, options, {}, runOptions);
    cache.set(key, ep);
  }
  return ep;
}

/** The dashboard record of a simulated episode (as MysteryAnalytics.sessionRecord() would build it). */
export function recordOf(ep: SimEpisode): SessionRecord {
  const r = ep.result;
  return {
    sessionId: ep.seed,
    caseId: ep.run.caseDef.id,
    caseVersion: ep.run.caseDef.version,
    duo: ep.duo,
    events: ep.collector.events,
    result: r
      ? {
        outcome: r.outcome, verdict: r.verdict, activeTimeS: r.activeTimeS, score: r.score, cluesFound: [...r.cluesFound], catches: r.catches,
        caseId: r.caseId, caseVersion: r.caseVersion, correct: r.correct, deductionCorrect: r.deductionCorrect, eggPoints: r.eggPoints,
      }
      : null,
  };
}

/** Builds a stamped log from (t, event) pairs with seq 1, 2, 3, … */
export function stamp(items: [number, GameEvent][]): StampedEvent[] {
  return items.map(([t, e], i) => ({ ...e, t, seq: i + 1 }) as StampedEvent);
}

export const NAMED_DUOS: Duo[] = [
  { characterId: 'enid', pokemonId: 'gengar' },
  { characterId: 'morticia', pokemonId: 'aegislash' },
  { characterId: 'ajax', pokemonId: 'gholdengo' },
  { characterId: 'wednesday', pokemonId: 'gengar' },
];
