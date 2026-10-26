// Regression episodes for maps WITHOUT Joseph Crackstone (fixtures + the three case maps with `crackstone: null`).
// Their event logs were hashed BEFORE Crackstone was added to the sim (crackstone.test.ts pins the hashes): adding the
// second enemy must not change a single byte of any run where he is absent (ENEMY_CONTRACT R2).
import { createHash } from 'node:crypto';
import { CASES } from '../../../src/mystery/data/cases.ts';
import { caseMap } from '../../../src/mystery/defaults.ts';
import { playEpisode } from '../../../src/mystery/episode.ts';
import { drawLayout } from '../../../src/mystery/layout.ts';
import { round1, scoreFor } from '../../../src/mystery/scoring.ts';
import type { BotOptions } from '../../../src/mystery/bot.ts';
import { CASE_IDS, type CaseId, type Duo, type MapDef, type StampedEvent, type SuspectId } from '../../../src/mystery/types.ts';
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

/** The murderers the pins were captured with (before the murderer was randomized per session). */
const PINNED: Record<CaseId, SuspectId> = { poisoned_archive: 'thornhill', crypt_last_witness: 'galpin', midnight_signal: 'barry' };

export function hashEvents(events: unknown): string {
  return createHash('sha256').update(JSON.stringify(events)).digest('hex').slice(0, 16);
}

/** Event types added by the final wave (director / scoring evidence) — absent from every pre-final log. */
const FINAL_EVENT_TYPES = new Set(['enemy_spawned', 'enemy_despawned', 'enemy_detected', 'enemy_hit']);

/**
 * A log as the pre-final sim would have written it: the final-only events dropped, seq renumbered, the new optional
 * fields (`hint_requested.level`, `dnf.by`) removed. Hashing this proves the final changes added events only.
 */
export function preFinalView(events: readonly StampedEvent[]): unknown[] {
  let seq = 0;
  const out: unknown[] = [];
  let delivered: { points: number; t: number } | null = null;
  for (const e of events) {
    if (FINAL_EVENT_TYPES.has(e.type)) continue;
    const c = { ...e, seq: e.seq === 0 ? 0 : ++seq } as Record<string, unknown>;
    if (e.type === 'hint_requested') delete c.level;
    if (e.type === 'dnf') delete c.by;
    if (e.type === 'egg_delivered') delivered = { points: e.points, t: e.t };
    // the finish event carried the v3.1 score (points × 100 − active time at the deposit)
    if (e.type === 'finish' && delivered) c.score = scoreFor(delivered.points, round1(delivered.t));
    out.push(c);
  }
  return out;
}

/** name → sha256(JSON events) prefix, for every regression episode (`view` = preFinalView for the pre-final pins). */
export function regressionHashes(view: (ev: StampedEvent[]) => unknown = (ev) => ev, cases = true): Record<string, string> {
  const out: Record<string, string> = {};
  DUOS.forEach((duo, i) => {
    PROFILES.forEach((o, j) => {
      const seed = `reg-${i}-${j}`;
      const fx = playEpisode(duo, seed, o, { map: fixtureMap(), caseDef: CASE, registries: neutralRegistries() }, PINNED[CASE.id]);
      out[`fixture:${duo.characterId}+${duo.pokemonId}:${o.profile}`] = hashEvents(view(fx.events));
      const wm = fixtureWorldMap();
      const wf = playEpisode(duo, seed, o, { map: wm, layout: drawLayout(wm.world!, seed), caseDef: CASE, tuning: WORLD_TUNING }, PINNED[CASE.id]);
      out[`world:${duo.characterId}+${duo.pokemonId}:${o.profile}`] = hashEvents(view(wf.events));
    });
  });
  if (!cases) return out;
  for (const caseId of CASE_IDS) {
    DUOS.slice(0, 2).forEach((duo, i) => {
      const seed = `reg-${caseId}-${i}`;
      const map = withoutCrackstone(caseId);
      const ep = playEpisode(duo, seed, PROFILES[i % 2], { map, layout: drawLayout(map.world!, seed), caseDef: CASES[caseId] }, PINNED[caseId]);
      out[`case:${caseId}:${duo.characterId}+${duo.pokemonId}`] = hashEvents(view(ep.events));
    });
  }
  return out;
}

/** Final-wave pins: full logs of real case episodes (compact play areas, director, Crackstone, Slurp, cabinets). */
export function caseHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const caseId of CASE_IDS) {
    DUOS.forEach((duo, i) => {
      const seed = `final-${caseId}-${i}`;
      const ep = playEpisode(duo, seed, PROFILES[i % 2], { caseDef: CASES[caseId] }, PINNED[caseId]);
      out[`${caseId}:${duo.characterId}+${duo.pokemonId}`] = hashEvents(ep.events);
    });
  }
  return out;
}

