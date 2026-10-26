// URL routing for the single deployment:
//   /                                            "The Silent Evidence" mystery journey (rules mystery-v3.1), LOCAL DEMO:
//                                                Home → nickname → three duo cards → Thing's prologue → Thing tutorial
//                                                → island → results
//   /?mode=mystery[&character=..&pokemon=..][&seed=..][&tutorial=0][&prologue=0][&case=<caseId>]
//                                                same journey; dev/operator shortcut. A valid Nightshade + Pokémon pair
//                                                skips straight to the island (tutorial=0 skips the tutorial too;
//                                                prologue=0 skips the case-file reveal + Thing's story; case=<caseId>
//                                                forces that case for this ephemeral session; culprit=<suspectId>
//                                                forces its murderer — LOCAL DEMO test fixture only); `seed`
//                                                alone reproduces that seed's three-card offer. Never persisted.
//                                                TEST FIXTURE: &crackstone=0 plays the case without Joseph Crackstone
//                                                (read by useMysteryLoop; never on the LIVE station).
//   /?mode=rowing[&character=..&pokemon=..][&tutorial=0]
//                                                the previous v3.0 real-time rowing journey (kept reachable);
//                                                `mode=play` is an alias
//   /?legacy=1                                   legacy v2.5 decision race, LOCAL DEMO
//   /?mode=terminal&station=station_a|station_b|station_c  MYSTERY station kiosk (mystery-v3.1), LIVE when .env is configured:
//                                                station sign-in gate → server-issued session/offer → verified result;
//                                                the gate offers an explicit LOCAL DEMO when live is unavailable
//   /?mode=terminal&station=..&legacy=1          legacy v2.5 race terminal (live when configured)
//   /?mode=terminal                              legacy v2.5 race, LOCAL DEMO
//   /?mode=dashboard                             Laptop 1 MYSTERY board, LIVE (Realtime station status + verified standings,
//                                                analytics from server rows, operator sign-in + Reset station)
//   /?mode=dashboard&demo=1                      Laptop 1 MYSTERY dashboard, LOCAL DEMO: sessions finished on this browser
//   /?mode=dashboard&legacy=1[&demo=1]           legacy v2.5 board (its LOCAL DEMO with demo=1)
import { isCaseId } from '../mystery/data/cases.ts';
import type { CaseId, SuspectId } from '../mystery/types.ts';
import { isCharacterId, isPokemonId, isStationId } from '../game/index.ts';
import type { CharacterId, PokemonId, StationId } from '../game/index.ts';
import { NIGHTSHADE_IDS, SUSPECT_IDS, type NightshadeId } from '../mystery/types.ts';

export type Route =
  | { kind: 'terminal'; stationId: StationId | null; forceLocal: boolean }
  | { kind: 'dashboard'; forceLocal: boolean }
  | { kind: 'mystery_dashboard' }
  | { kind: 'mystery_live_dashboard' }
  | { kind: 'mystery_station'; stationId: StationId }
  | { kind: 'play'; characterId: CharacterId | null; pokemonId: PokemonId | null; skipTutorial: boolean }
  | { kind: 'mystery'; characterId: NightshadeId | null; pokemonId: PokemonId | null; seed: string | null; skipTutorial: boolean; skipPrologue: boolean; caseId: CaseId | null; culprit?: SuspectId | null }
  | { kind: 'invalid'; message: string };

export function parseRoute(search: string): Route {
  const params = new URLSearchParams(search);
  const mode = params.get('mode');
  if (mode === null) {
    if (params.get('legacy') === '1') return { kind: 'terminal', stationId: null, forceLocal: true };
    return { kind: 'mystery', characterId: null, pokemonId: null, seed: null, skipTutorial: false, skipPrologue: false, caseId: null };
  }
  if (mode === 'dashboard') {
    const demo = params.get('demo') === '1';
    if (params.get('legacy') === '1') return { kind: 'dashboard', forceLocal: demo };
    return demo ? { kind: 'mystery_dashboard' } : { kind: 'mystery_live_dashboard' };
  }
  if (mode === 'mystery') {
    const character = params.get('character');
    const pokemon = params.get('pokemon');
    const seed = params.get('seed');
    const pair = isNightshadeId(character) && isPokemonId(pokemon);
    return {
      kind: 'mystery',
      characterId: pair ? (character as NightshadeId) : null,
      pokemonId: pair ? (pokemon as PokemonId) : null,
      seed: seed && /^[A-Za-z0-9_-]{1,64}$/.test(seed) ? seed : null,
      skipTutorial: params.get('tutorial') === '0',
      skipPrologue: params.get('prologue') === '0',
      caseId: isCaseId(params.get('case')) ? (params.get('case') as CaseId) : null,
      ...((SUSPECT_IDS as readonly (string | null)[]).includes(params.get('culprit')) ? { culprit: params.get('culprit') as SuspectId } : {}),
    };
  }
  if (mode === 'rowing' || mode === 'play') {
    const character = params.get('character');
    const pokemon = params.get('pokemon');
    return {
      kind: 'play',
      characterId: isCharacterId(character) ? character : null,
      pokemonId: isPokemonId(pokemon) ? pokemon : null,
      skipTutorial: params.get('tutorial') === '0',
    };
  }
  if (mode === 'terminal') {
    const station = params.get('station');
    if (station === null) return { kind: 'terminal', stationId: null, forceLocal: true };
    if (isStationId(station)) {
      return params.get('legacy') === '1' ? { kind: 'terminal', stationId: station, forceLocal: false } : { kind: 'mystery_station', stationId: station };
    }
    return { kind: 'invalid', message: `Unknown station "${station}". Use station_a, station_b or station_c.` };
  }
  return { kind: 'invalid', message: `Unknown mode "${mode}". Use mode=mystery, mode=rowing, mode=terminal or mode=dashboard.` };
}

function isNightshadeId(v: string | null): v is NightshadeId {
  return v !== null && (NIGHTSHADE_IDS as readonly string[]).includes(v);
}

export function stationLabel(stationId: StationId | 'local' | null): string {
  if (stationId === 'station_a') return 'Station A';
  if (stationId === 'station_b') return 'Station B';
  if (stationId === 'station_c') return 'Station C';
  return 'Demo station';
}
