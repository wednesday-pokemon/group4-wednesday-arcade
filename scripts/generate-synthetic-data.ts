// Reproducible synthetic dataset: 10,000 ATTEMPTED races through the real rules engine (rules v2.5).
// Races that DNF early contribute fewer leg rows, so observed rows are < 30,000. Features are computed
// before each leg resolves (no leakage). Usage: npm run data:generate [-- --races 10000]
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  buildLegView, CHARACTERS, createInitialState, createStream, deriveLegContext, getPushOptions, keyedUniform, POKEMON,
  prepareWithSeed, resolveWithSeed, RULES_VERSION,
} from '../src/game/index.ts';
import type { GameState, RacePolicy } from '../src/game/index.ts';
import { buildLegFeatures, collectProbability } from '../src/analytics/features.ts';
import { FUTURE_POLICIES, randomPolicy } from '../src/analytics/policies.ts';

export const DATA_PATH = 'data/synthetic/raven-legs-v2.5.jsonl';
export const SEED_PREFIX = `raven-synthetic-${RULES_VERSION}`;
export const TRAIN_FRACTION = 0.8;

export interface LegRow {
  race: number;
  split: 'train' | 'test';
  leg: number;
  character: string;
  pokemon: string;
  policy: string;
  route: string;
  push: number;
  weather: string;
  egg: string;
  timeX: number[];
  catchX: number[];
  ruleTimeS: number;
  ruleCatchP: number;
  actualTimeS: number;
  caught: 0 | 1;
  outcome: string;
}

const POLICY_NAMES = ['random', ...Object.keys(FUTURE_POLICIES)];

export function raceSplit(race: number): 'train' | 'test' {
  return keyedUniform(`${SEED_PREFIX}|split`, `race-${race}`) < TRAIN_FRACTION ? 'train' : 'test';
}

export function generateRace(race: number): LegRow[] {
  const pairing = race % (CHARACTERS.length * POKEMON.length);
  const characterId = CHARACTERS[Math.floor(pairing / POKEMON.length)].id;
  const pokemonId = POKEMON[pairing % POKEMON.length].id;
  const seed = `${SEED_PREFIX}|race-${race}`;
  const rng = createStream(`${seed}|policy`);
  const policyName = POLICY_NAMES[Math.floor(rng() * POLICY_NAMES.length)];
  const collectIntent = policyName === 'random' ? 0.85 : 1;
  const policy: RacePolicy = policyName === 'random' ? randomPolicy(rng, collectIntent) : FUTURE_POLICIES[policyName];

  let state: GameState = createInitialState({ sessionId: `synthetic-${race}`, nickname: 'Synthetic', characterId, pokemonId });
  const rows: LegRow[] = [];
  while (state.phase !== 'complete') {
    const ctx = deriveLegContext(seed, state.legIndex);
    const view = buildLegView(state, ctx);
    const choice = policy.chooseLeg(state, view, getPushOptions(state));
    const features = buildLegFeatures(state, ctx.weather, choice, collectProbability(state, choice.route, view.visibleOffers[choice.route], collectIntent));
    const prepared = prepareWithSeed(state, seed, choice, state.revision);
    if (!prepared.ok) throw new Error(`race ${race}: ${prepared.error.message}`);
    const egg = policy.chooseEgg(prepared.state, prepared.state.prepared!.selectedOffer);
    const resolved = resolveWithSeed(prepared.state, seed, egg, prepared.state.revision);
    if (!resolved.ok) throw new Error(`race ${race}: ${resolved.error.message}`);
    const r = resolved.resolution;
    rows.push({
      race, split: raceSplit(race), leg: r.legIndex, character: characterId, pokemon: pokemonId, policy: policyName,
      route: r.route, push: r.pushLevel, weather: r.weather, egg, timeX: features.time, catchX: features.catch,
      ruleTimeS: features.probe.expectedTimeS, ruleCatchP: features.probe.expectedCatchP,
      actualTimeS: r.time.totalCs / 100, caught: r.hydeCatch ? 1 : 0, outcome: r.outcome,
    });
    state = resolved.state;
  }
  return rows;
}

function main() {
  const flag = process.argv.indexOf('--races');
  const races = flag > 0 ? Number(process.argv[flag + 1]) : 10000;
  const started = Date.now();
  const lines: string[] = [];
  let dnf = 0;
  for (let race = 0; race < races; race++) {
    const rows = generateRace(race);
    if (rows[rows.length - 1].outcome === 'dnf') dnf++;
    for (const row of rows) lines.push(JSON.stringify(row));
  }
  mkdirSync('data/synthetic', { recursive: true });
  writeFileSync(DATA_PATH, lines.join('\n') + '\n');
  console.log(`attempted races: ${races}; observed leg rows: ${lines.length}; DNF races: ${dnf}; ${Date.now() - started} ms -> ${DATA_PATH}`);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/generate-synthetic-data.ts')) main();
