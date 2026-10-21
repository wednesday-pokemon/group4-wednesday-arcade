// The ONE seam between the app and the modules other agents own (sim, data, renderer), typed against the real
// modules: pure registries + draft are imported statically; the sim and the three.js renderer are dynamic imports so
// they stay out of the menu bundle. The typed assignments in loadRunCtor/loadSceneCtor make tsc prove the concrete
// classes fit the shapes the app uses (runTypes.ts).
import type { PokemonId } from '../../game/types.ts';
import { SILENT_EVIDENCE } from '../../mystery/data/case.ts';
import { NIGHTSHADES } from '../../mystery/data/nightshades.ts';
import { PARTNERS } from '../../mystery/data/partners.ts';
import { buildCard, draftOffer } from '../../mystery/draft.ts';
import type { CaseDef, Duo, DuoCard, DuoOffer, NightshadeDef, NightshadeId, PokemonPartnerDef } from '../../mystery/types.ts';
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

export function caseDef(): CaseDef {
  return SILENT_EVIDENCE;
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
