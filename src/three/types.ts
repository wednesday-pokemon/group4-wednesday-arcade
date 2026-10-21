import type { CharacterId, LegIndex, LegResolution, PokemonId, RouteId, WeatherId } from '../game/types.ts';

export interface RaceSceneOptions {
  reducedMotion: boolean;
  lowGraphics: boolean;
}

export type RaceBeat = 'start' | 'route' | 'egg' | 'crash' | 'hyde' | 'catch' | 'escape' | 'dock' | 'finish' | 'dnf';

export type { CharacterId, LegIndex, LegResolution, PokemonId, RouteId, WeatherId };
