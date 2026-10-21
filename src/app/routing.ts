// URL routing for the single deployment:
//   /                                            v3 real-time journey (Home → crew → tutorial → Stage 1), LOCAL DEMO
//   /?mode=play[&character=..&pokemon=..][&tutorial=0]
//                                                same v3 journey; with a valid character+pokemon pair the selection
//                                                screens are skipped (dev shortcut), tutorial=0 also skips the tutorial
//   /?legacy=1                                   legacy v2.5 decision race, LOCAL DEMO (kept until v3 replaces it)
//   /?mode=terminal&station=station_a|station_b  player terminal — still the legacy v2.5 race (live when configured;
//                                                v3 has no backend until the scoring phase)
//   /?mode=terminal                              legacy v2.5 race, LOCAL DEMO
//   /?mode=dashboard                             Laptop 1 spectator board + operator panel (live when configured)
//   /?mode=dashboard&demo=1                      the LOCAL DEMO board (explicit choice, never a silent fallback)
import { isCharacterId, isPokemonId, isStationId } from '../game/index.ts';
import type { CharacterId, PokemonId, StationId } from '../game/index.ts';

export type Route =
  | { kind: 'terminal'; stationId: StationId | null; forceLocal: boolean }
  | { kind: 'dashboard'; forceLocal: boolean }
  | { kind: 'play'; characterId: CharacterId | null; pokemonId: PokemonId | null; skipTutorial: boolean }
  | { kind: 'invalid'; message: string };

export function parseRoute(search: string): Route {
  const params = new URLSearchParams(search);
  const mode = params.get('mode');
  if (mode === null) {
    if (params.get('legacy') === '1') return { kind: 'terminal', stationId: null, forceLocal: true };
    return { kind: 'play', characterId: null, pokemonId: null, skipTutorial: false };
  }
  if (mode === 'dashboard') return { kind: 'dashboard', forceLocal: params.get('demo') === '1' };
  if (mode === 'play') {
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
    if (isStationId(station)) return { kind: 'terminal', stationId: station, forceLocal: false };
    return { kind: 'invalid', message: `Unknown station "${station}". Use station_a or station_b.` };
  }
  return { kind: 'invalid', message: `Unknown mode "${mode}". Use mode=play, mode=terminal or mode=dashboard.` };
}

export function stationLabel(stationId: StationId | 'local' | null): string {
  if (stationId === 'station_a') return 'Station A';
  if (stationId === 'station_b') return 'Station B';
  return 'Demo station';
}
