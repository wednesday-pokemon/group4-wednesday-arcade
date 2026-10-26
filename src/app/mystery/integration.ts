// The ONE seam between the app and the modules other agents own (sim, data, renderer), typed against the real
// modules: pure registries + draft are imported statically; the sim and the three.js renderer are dynamic imports so
// they stay out of the menu bundle. The typed assignments in loadRunCtor/loadSceneCtor make tsc prove the concrete
// classes fit the shapes the app uses (runTypes.ts).
import type { PokemonId } from '../../game/types.ts';
import { caseById, POISONED_ARCHIVE } from '../../mystery/data/cases.ts';
import { NIGHTSHADES } from '../../mystery/data/nightshades.ts';
import { PARTNERS } from '../../mystery/data/partners.ts';
import { buildCard, draftOffer } from '../../mystery/draft.ts';
import type { CaseDef, CaseId, CaseSolution, ClueContent, ClueId, Duo, DuoCard, DuoOffer, MapDef, NightshadeDef, NightshadeId, PokemonPartnerDef, SuspectId } from '../../mystery/types.ts';
import type { MysteryRunCtor, MysterySceneCtor } from './runTypes.ts';

/** 'preview' only exists in sessions stored before the draft landed; openSession() upgrades those (same seed). */
export type OfferSource = 'draft' | 'preview';

/** draftOffer(seed) from src/mystery/draft.ts. */
export function makeOffer(seed: string): { offer: DuoOffer; source: OfferSource } {
  return { offer: draftOffer(seed), source: 'draft' };
}

export function realDraftAvailable(): boolean {
  return true;
}

export function cardFor(duo: Duo): DuoCard {
  return buildCard(duo);
}

export function nightshadeDef(id: NightshadeId): NightshadeDef {
  return NIGHTSHADES[id];
}

export function partnerDef(id: PokemonId): PokemonPartnerDef {
  return PARTNERS[id];
}

/** The PUBLIC definition of the session's assigned case (no answer inside; every clue sealed). */
export function caseDef(id: CaseId = POISONED_ARCHIVE.id): CaseDef {
  return caseById(id);
}

/**
 * The case's ANSWER KEY. Only ever called AFTER the visitor has committed the accusation (and for the results screen):
 * the dynamic import keeps data/solutions.ts out of every chunk the visitor loads before that. In LIVE mode the server
 * recomputes the verdict from its own copy, so this only drives the local view and its analytics.
 */
export async function loadCaseSolution(id: CaseId, culprit: SuspectId): Promise<CaseSolution> {
  const { caseSolution } = await import('../../mystery/data/solutions.ts');
  return caseSolution(id, culprit);
}

/**
 * LOCAL DEMO only (no server to keep the secret): the session murderer's clue texts, loaded when the run starts and
 * merged into the run's case clue by clue as they are found. LIVE never calls this — the server releases each found
 * clue's text with its append ack and keeps the murderer until finalize.
 */
export async function loadLocalClueContents(id: CaseId, culprit: SuspectId): Promise<Partial<Record<ClueId, ClueContent>>> {
  const { caseVariant } = await import('../../mystery/data/solutions.ts');
  return caseVariant(id, culprit).clues;
}

export async function loadRunCtor(): Promise<MysteryRunCtor> {
  const { MysteryRun } = await import('../../mystery/run.ts');
  const ctor: MysteryRunCtor = MysteryRun;
  return ctor;
}

export async function loadSceneCtor(): Promise<MysterySceneCtor> {
  const { MysteryScene } = await import('../../three/mystery/MysteryScene.ts');
  const ctor: MysterySceneCtor = MysteryScene;
  return ctor;
}

/** What is connected (exposed in render_game_to_text). */
export function integrationStatus() {
  return { draft: true, nightshades: true, partners: true, case: true, thing: true, run: true, scene: true };
}

/**
 * TEST FIXTURE (`?mode=mystery…&crackstone=0`, local demo only): the case's island WITHOUT Joseph Crackstone, so the
 * "crackstone: null" HUD (centred Hyde pill, no Crackstone UI) can be verified in the real app. The run then uses the
 * map's default placements (no seeded layout) — never offered on a kiosk path.
 */
export async function loadCrackstoneFreeMap(id: CaseId): Promise<MapDef> {
  const { caseMap } = await import('../../mystery/defaults.ts');
  const m = caseMap(id);
  return { ...m, ...(m.world ? { world: { ...m.world, crackstone: null } } : {}) };
}
