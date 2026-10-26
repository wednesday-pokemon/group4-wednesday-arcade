// Lazy loader for the 3D RaceScene (src/three, owned by the 3d-artist). three.js is code-split out of the
// initial bundle. If WebGL or the module is unavailable the game stays playable with the 2D fallback.
import { useEffect, useState, type RefObject } from 'react';
import type { CharacterId, LegIndex, LegResolution, PokemonId, RouteId, WeatherId } from '../game/index.ts';
import type { RaceBeat, RaceSceneOptions } from '../three/types.ts';

export type { RaceBeat };

export interface RaceSceneLike {
  setCrew(characterId: CharacterId, pokemonId: PokemonId): void;
  setLeg(legIndex: LegIndex, weather: WeatherId, gapM: number): void;
  setRoutePreview(route: RouteId | null): void;
  playLeg(resolution: LegResolution, onBeat?: (beat: RaceBeat) => void): Promise<void>;
  skip(): void;
  setOptions(options: Partial<RaceSceneOptions>): void;
  advanceTime(ms: number): void;
  getDebugState(): unknown;
  dispose(): void;
}

// Dynamic import keeps three.js out of the initial bundle (separate chunk).
const loadSceneModule = () => import('../three/index.ts');

export type SceneStatus =
  | { kind: 'loading' }
  | { kind: 'ready'; scene: RaceSceneLike }
  | { kind: 'unavailable'; reason: string };

export function useRaceScene(container: RefObject<HTMLDivElement | null>, options: RaceSceneOptions): SceneStatus {
  const [status, setStatus] = useState<SceneStatus>({ kind: 'loading' });

  useEffect(() => {
    let disposed = false;
    let scene: RaceSceneLike | null = null;
    loadSceneModule()
      .then((mod) => {
        if (disposed || !container.current) return;
        if (!mod.isWebGLAvailable()) {
          setStatus({ kind: 'unavailable', reason: 'WebGL is not available on this computer.' });
          return;
        }
        const created: RaceSceneLike = new mod.RaceScene(container.current, options);
        scene = created;
        setStatus({ kind: 'ready', scene: created });
      })
      .catch((err: unknown) => {
        console.warn('[sceneHost] RaceScene failed to start; using the 2D fallback', err);
        if (!disposed) setStatus({ kind: 'unavailable', reason: 'The 3D scene could not start.' });
      });
    return () => {
      disposed = true;
      scene?.dispose();
    };
    // Created once per terminal; option changes go through setOptions below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scene = status.kind === 'ready' ? status.scene : null;
  useEffect(() => {
    scene?.setOptions({ reducedMotion: options.reducedMotion, lowGraphics: options.lowGraphics });
  }, [scene, options.reducedMotion, options.lowGraphics]);

  return status;
}
