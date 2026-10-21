// Default content for a run: the designer's island, case, registries and tuning.
import { DEFAULT_TUNING, type SimTuning } from './config.ts';
import { SILENT_EVIDENCE, CLUE_INTERACT_LABELS } from './data/case.ts';
import { buildIsland, PRACTICE_CRATE } from './data/island.ts';
import { REGISTRIES, type Registries } from './draft.ts';
import type { CaseDef, ClueId, MapDef, Vec2 } from './types.ts';

let island: MapDef | null = null;

/** The shared, read-only default island (one instance so nav grids are cached once per process). */
export function defaultMap(): MapDef {
  if (!island) island = buildIsland();
  return island;
}

export function defaultCase(): CaseDef {
  return SILENT_EVIDENCE;
}

export function defaultRegistries(): Registries {
  return REGISTRIES;
}

export function defaultTuning(): SimTuning {
  return DEFAULT_TUNING;
}

/** The pier practice crate when the map is the designer's island (by id), else null. */
export function practiceCrateFor(map: MapDef): Vec2 | null {
  return map.id === buildIslandId() ? { x: PRACTICE_CRATE.x, z: PRACTICE_CRATE.z } : null;
}

function buildIslandId(): string {
  return defaultMap().id;
}

export function clueInteractLabel(id: ClueId): string | null {
  return CLUE_INTERACT_LABELS[id] ?? null;
}
