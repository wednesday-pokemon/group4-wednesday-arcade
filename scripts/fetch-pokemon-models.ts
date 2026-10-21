// Caches the 18 partner Pokémon's 3D models (GLB) from the community Pokémon 3D API
// (https://pokemon-3d-api.onrender.com/v1/pokemon, assets in github.com/Pokemon-3D-api/assets) into
// public/models/pokemon/<dex>[-form].glb + manifest.json, so kiosks never depend on the venue network (as D-36 does
// for artwork). Identity is checked against PokéAPI: the Pokédex number must be the expected species, and a regional
// form must exist there as a variety. Also refreshes the vendored Draco decoder in public/draco.
// Usage: npm run art:models3d   (needs network once; re-run to refresh).
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMUNITY_API_DEFAULT, parseCommunityCatalog } from '../src/three/pokemonModels/providers.ts';
import { POKEMON_MODEL_REFS, catalogFormName, refKey, type ModelForm } from '../src/three/pokemonModels/refs.ts';

const POKEAPI = 'https://pokeapi.co/api/v2';
const OUT = 'public/models/pokemon';
const MAX_BYTES = 16 * 1024 * 1024; // same cap as src/three/pokemonModels/loader.ts
/** PokéAPI variety suffix for each catalog form */
const POKEAPI_FORM: Record<Exclude<ModelForm, 'regular'>, string> = { alolan: 'alola', galar: 'galar', hisuian: 'hisui' };

async function json(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { 'User-Agent': 'raven-island-school-arcade' }, signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

mkdirSync(OUT, { recursive: true });
mkdirSync('public/draco', { recursive: true });
for (const f of ['draco_decoder.wasm', 'draco_wasm_wrapper.js']) copyFileSync(join('node_modules/three/examples/jsm/libs/draco/gltf', f), join('public/draco', f));

const raw = (await json(COMMUNITY_API_DEFAULT)) as { id: number; forms: { name: string; formName: string }[] }[];
const catalog = parseCommunityCatalog(raw);
console.log(`catalog: ${catalog.size} species`);

const manifest = {
  source: COMMUNITY_API_DEFAULT,
  fetchedAt: new Date().toISOString(),
  note: 'Community Pokémon 3D API models (github.com/Pokemon-3D-api/assets, MIT pipeline; models originate from Sketchfab). Pokémon designs © Nintendo / Creatures Inc. / GAME FREAK inc. / The Pokémon Company — used for a non-commercial school event; clear rights before any public use (D-36).',
  models: {} as Record<string, { file: string; dexId: number; species: string; form: ModelForm; name: string; sourceUrl: string; bytes: number; sha256: string }>,
  partners: {} as Record<string, string>,
};
const missing: string[] = [];

for (const [partner, ref] of Object.entries(POKEMON_MODEL_REFS)) {
  const species = (await json(`${POKEAPI}/pokemon-species/${ref.dexId}`)) as { name: string; varieties: { pokemon: { name: string } }[] };
  if (species.name !== ref.species) throw new Error(`${partner}: Pokédex #${ref.dexId} is ${species.name} on PokéAPI, expected ${ref.species}`);
  if (ref.form !== 'regular') {
    const variety = `${ref.species}-${POKEAPI_FORM[ref.form]}`;
    if (!species.varieties.some((v) => v.pokemon.name === variety)) throw new Error(`${partner}: PokéAPI has no ${variety}`);
  }
  const form = catalogFormName(ref);
  const url = form ? catalog.get(ref.dexId)?.get(form) : undefined;
  if (!url) {
    missing.push(partner);
    console.log(`${partner.padEnd(17)} ✗ no ${ref.form} model for #${ref.dexId} in the catalog (artwork fallback)`);
    continue;
  }
  // the catalog can list files that don't exist (or aren't GLBs): record them as missing, never substitute
  const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  const buf = res.ok ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0);
  const problem = !res.ok ? `HTTP ${res.status}` : buf.length > MAX_BYTES ? `${buf.length} bytes (limit ${MAX_BYTES})` : buf.toString('ascii', 0, 4) !== 'glTF' ? 'not a GLB' : null;
  if (problem) {
    missing.push(partner);
    console.log(`${partner.padEnd(17)} ✗ ${problem}: ${url} (artwork fallback)`);
    continue;
  }
  const key = refKey(ref);
  const file = `${key}.glb`;
  writeFileSync(join(OUT, file), buf);
  const name = raw.find((e) => e.id === ref.dexId)?.forms.find((f) => f.formName === form)?.name ?? '';
  manifest.models[key] = { file, dexId: ref.dexId, species: ref.species, form: ref.form, name, sourceUrl: url, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
  manifest.partners[partner] = key;
  console.log(`${partner.padEnd(17)} ← ${name} (#${ref.dexId} ${ref.form}) ${(buf.length / 1024).toFixed(0)} KB`);
}

writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${Object.keys(manifest.models).length} models + manifest to ${OUT}${missing.length ? `; missing: ${missing.join(', ')}` : ''}`);
