// Shared fixtures for the analytics tests: seeded simulated episodes and hand-written event logs.
import { simulateEpisode, type EpisodeHooks, type SimEpisode } from '../../../src/mystery/analytics/episodes.ts';
import type { BotOptions } from '../../../src/mystery/bot.ts';
import type { Duo, GameEvent, StampedEvent } from '../../../src/mystery/types.ts';

const cache = new Map<string, SimEpisode>();

export function episode(duo: Duo, seed: string, options: BotOptions, hooks?: EpisodeHooks): SimEpisode {
  const key = `${duo.characterId}+${duo.pokemonId}|${seed}|${JSON.stringify(options)}`;
  if (hooks) return simulateEpisode(duo, seed, options, hooks);
  let ep = cache.get(key);
  if (!ep) {
    ep = simulateEpisode(duo, seed, options);
    cache.set(key, ep);
  }
  return ep;
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
