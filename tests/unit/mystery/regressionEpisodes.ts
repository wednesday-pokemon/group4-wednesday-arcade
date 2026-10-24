// Regression episodes for maps WITHOUT Joseph Crackstone (fixtures + the three case maps with `crackstone: null`).
// Their event logs were hashed BEFORE Crackstone was added to the sim (crackstone.test.ts pins the hashes): adding the
// second enemy must not change a single byte of any run where he is absent (ENEMY_CONTRACT R2).
import { createHash } from 'node:crypto';
import { CASES } from '../../../src/mystery/data/cases.ts';
import { caseMap } from '../../../src/mystery/defaults.ts';
import { playEpisode } from '../../../src/mystery/episode.ts';
import { drawLayout } from '../../../src/mystery/layout.ts';
import type { BotOptions } from '../../../src/mystery/bot.ts';
import { CASE_IDS, type CaseId, type Duo, type MapDef } from '../../../src/mystery/types.ts';
import { CASE, fixtureMap, neutralRegistries } from './helpers.ts';
import { fixtureWorldMap, WORLD_TUNING } from './worldFixture.ts';

/** A case map with its Crackstone removed (geometry arrays shared, so nav grids stay cached). */
export function withoutCrackstone(caseId: CaseId): MapDef {
  const base = caseMap(caseId);
  return { ...base, world: base.world ? { ...base.world, crackstone: null } : undefined };
}

const DUOS: Duo[] = [
  { characterId: 'wednesday', pokemonId: 'gengar' },
  { characterId: 'gomez', pokemonId: 'dusknoir' },
  { characterId: 'bianca', pokemonId: 'froslass' },
  { characterId: 'ajax', pokemonId: 'aegislash' },
];
const PROFILES: BotOptions[] = [
  { profile: 'stealthy', useAbilities: true, startDelayMaxS: 0 },
  { profile: 'careless', useAbilities: true },
];

export function hashEvents(events: unknown): string {
  return createHash('sha256').update(JSON.stringify(events)).digest('hex').slice(0, 16);
}

/** name → sha256(JSON events) prefix, for every regression episode. */
export function regressionHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  DUOS.forEach((duo, i) => {
    PROFILES.forEach((o, j) => {
      const seed = `reg-${i}-${j}`;
      const fx = playEpisode(duo, seed, o, { map: fixtureMap(), caseDef: CASE, registries: neutralRegistries() });
      out[`fixture:${duo.characterId}+${duo.pokemonId}:${o.profile}`] = hashEvents(fx.events);
      const wm = fixtureWorldMap();
      const wf = playEpisode(duo, seed, o, { map: wm, layout: drawLayout(wm.world!, seed), caseDef: CASE, tuning: WORLD_TUNING });
      out[`world:${duo.characterId}+${duo.pokemonId}:${o.profile}`] = hashEvents(wf.events);
    });
  });
  for (const caseId of CASE_IDS) {
    DUOS.slice(0, 2).forEach((duo, i) => {
      const seed = `reg-${caseId}-${i}`;
      const map = withoutCrackstone(caseId);
      const ep = playEpisode(duo, seed, PROFILES[i % 2], { map, layout: drawLayout(map.world!, seed), caseDef: CASES[caseId] });
      out[`case:${caseId}:${duo.characterId}+${duo.pokemonId}`] = hashEvents(ep.events);
    });
  }
  return out;
}
