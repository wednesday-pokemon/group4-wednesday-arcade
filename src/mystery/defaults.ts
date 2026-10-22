// Default content for a run: the designer's island (dressed for a case), the case, registries and tuning.
import { DEFAULT_TUNING, type SimTuning } from './config.ts';
import { caseById, POISONED_ARCHIVE } from './data/cases.ts';
import { buildIsland, ISLAND_BASE_ID, PRACTICE_CRATE } from './data/island.ts';
import { REGISTRIES, type Registries } from './draft.ts';
import type { CaseDef, CaseId, MapDef, Vec2 } from './types.ts';

const islands = new Map<CaseId, MapDef>();

/** The shared, read-only island for a case (one instance per case so nav grids are cached once per process). */
export function caseMap(caseId: CaseId): MapDef {
  let m = islands.get(caseId);
  if (!m) {
    m = buildIsland(caseById(caseId));
    islands.set(caseId, m);
  }
  return m;
}

/** The default island (Case 01 placements). */
export function defaultMap(): MapDef {
  return caseMap(POISONED_ARCHIVE.id);
}

export function defaultCase(): CaseDef {
  return POISONED_ARCHIVE;
}

export function defaultRegistries(): Registries {
  return REGISTRIES;
}

export function defaultTuning(): SimTuning {
  return DEFAULT_TUNING;
}

/** The pier practice crate when the map is the designer's island (any case), else null. */
export function practiceCrateFor(map: MapDef): Vec2 | null {
  return map.id === ISLAND_BASE_ID || map.id.startsWith(`${ISLAND_BASE_ID}:`) ? { x: PRACTICE_CRATE.x, z: PRACTICE_CRATE.z } : null;
}
