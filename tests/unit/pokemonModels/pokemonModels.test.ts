import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POKEMON } from '../../../src/game/constants.ts';
import { ModelUnavailableError, fitModel, loadPokemonModel, pickIdleClip } from '../../../src/three/pokemonModels/loader.ts';
import {
  communityProvider,
  localProvider,
  parseCommunityCatalog,
  parseLocalManifest,
  providerOrder,
  type ModelProvider,
} from '../../../src/three/pokemonModels/providers.ts';
import { POKEMON_MODEL_REFS, catalogFormName, refKey } from '../../../src/three/pokemonModels/refs.ts';

const GH = 'https://raw.githubusercontent.com/Pokemon-3D-api/assets/main/models/opt';
// trimmed copy of the real response shape (GET /v1/pokemon, checked 2026-10-21)
const CATALOG = [
  { id: 1, forms: [{ name: 'Bulbasaur', model: `${GH}/regular/1.glb`, formName: 'regular' }, { name: 'Shiny Bulbasaur', model: `${GH}/shiny/1.glb`, formName: 'shiny' }] },
  { id: 105, forms: [{ name: 'Marowak', model: `${GH}/regular/105.glb`, formName: 'regular' }, { name: 'Alolan Marowak', model: `${GH}/alolan/105.glb`, formName: 'alolan' }] },
];

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('refs', () => {
  it('cover every partner Pokémon with a positive Pokédex number', () => {
    for (const p of POKEMON) {
      const ref = POKEMON_MODEL_REFS[p.id];
      expect(ref, p.id).toBeDefined();
      expect(Number.isInteger(ref.dexId) && ref.dexId > 0).toBe(true);
    }
  });

  it('build stable keys and catalog form names', () => {
    expect(refKey({ dexId: 94, species: 'gengar', form: 'regular' })).toBe('94');
    expect(refKey({ dexId: 105, species: 'marowak', form: 'alolan' })).toBe('105-alolan');
    expect(refKey({ dexId: 94, species: 'gengar', form: 'regular', shiny: true })).toBe('94-shiny');
    expect(catalogFormName({ dexId: 94, species: 'gengar', form: 'regular', shiny: true })).toBe('shiny');
    expect(catalogFormName({ dexId: 105, species: 'marowak', form: 'alolan', shiny: true })).toBeNull();
  });

  it('match the cached local manifest (when present) and its files exist', () => {
    const path = 'public/models/pokemon/manifest.json';
    if (!existsSync(path)) return;
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as { models: Record<string, { file: string; dexId: number }>; partners: Record<string, string> };
    for (const [partner, key] of Object.entries(manifest.partners)) {
      const ref = POKEMON_MODEL_REFS[partner as keyof typeof POKEMON_MODEL_REFS];
      expect(refKey(ref), partner).toBe(key);
      expect(manifest.models[key]!.dexId).toBe(ref.dexId);
      expect(existsSync(`public/models/pokemon/${manifest.models[key]!.file}`)).toBe(true);
    }
  });
});

describe('community catalog parsing', () => {
  it('indexes the real shape by dex id and form', () => {
    const c = parseCommunityCatalog(CATALOG);
    expect(c.get(105)?.get('alolan')).toBe(`${GH}/alolan/105.glb`);
    expect(c.get(1)?.get('shiny')).toBe(`${GH}/shiny/1.glb`);
  });

  it('skips malformed entries and URLs it would not load', () => {
    const c = parseCommunityCatalog([
      null,
      { id: '7', forms: [] },
      { id: 2, forms: 'x' },
      { id: 3, forms: [{ formName: 'regular' }, { formName: 'regular', model: 'https://evil.example/3.glb' }, { formName: 'shiny', model: `${GH}/shiny/3.js` }, { formName: 'mega', model: `http://raw.githubusercontent.com/3.glb` }] },
      { id: 4, forms: [{ formName: 'regular', model: `${GH}/regular/4.glb` }] },
    ]);
    expect([...c.keys()]).toEqual([4]);
  });

  it('rejects a non-array body', () => {
    expect(() => parseCommunityCatalog({ results: [] })).toThrow();
  });
});

describe('local manifest parsing', () => {
  it('accepts plain .glb file names only', () => {
    const m = parseLocalManifest({ models: { '94': { file: '94.glb' }, a: { file: '../secret.glb' }, b: { file: 'https://x/y.glb' }, c: { file: 'x.js' } } });
    expect([...m.entries()]).toEqual([['94', '94.glb']]);
    expect(() => parseLocalManifest({})).toThrow();
  });
});

describe('providers', () => {
  it('community: resolves by dex id + form and fetches the catalog once', async () => {
    const fetch = vi.fn(async () => json(CATALOG));
    vi.stubGlobal('fetch', fetch);
    const p = communityProvider('https://api.test/v1/pokemon');
    expect(await p.resolve({ dexId: 105, species: 'marowak', form: 'alolan' })).toEqual({ url: `${GH}/alolan/105.glb`, provider: 'community' });
    expect(await p.resolve({ dexId: 105, species: 'marowak', form: 'galar' })).toBeNull();
    expect(await p.resolve({ dexId: 999, species: 'x', form: 'regular' })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('community: an HTTP error or a non-JSON answer rejects (caller falls back)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    await expect(communityProvider('https://api.test/a').resolve(POKEMON_MODEL_REFS.gengar)).rejects.toThrow(/503/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })));
    await expect(communityProvider('https://api.test/b').resolve(POKEMON_MODEL_REFS.gengar)).rejects.toThrow(/not JSON/);
  });

  it('local: maps a ref to its cached file', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ models: { '105-alolan': { file: '105-alolan.glb' } } })));
    const p = localProvider('/models/pokemon');
    expect(await p.resolve(POKEMON_MODEL_REFS.alolan_marowak)).toEqual({ url: '/models/pokemon/105-alolan.glb', provider: 'local' });
    expect(await p.resolve(POKEMON_MODEL_REFS.gengar)).toBeNull();
  });

  it('order: local first by default, overridable, `off` disables', () => {
    expect(providerOrder({}, '')).toEqual(['local', 'community']);
    expect(providerOrder({ VITE_POKEMON_MODEL_PROVIDERS: 'community' }, '')).toEqual(['community']);
    expect(providerOrder({ VITE_POKEMON_MODEL_PROVIDERS: 'community' }, '?pokemon3d=local,bogus')).toEqual(['local']);
    expect(providerOrder({}, '?pokemon3d=off')).toEqual([]);
  });
});

describe('loadPokemonModel fallback', () => {
  it('tries every provider and reports why each one failed', async () => {
    const providers: ModelProvider[] = [
      { id: 'local', resolve: async () => null },
      { id: 'community', resolve: async () => { throw new Error('offline'); } },
    ];
    const err = await loadPokemonModel(POKEMON_MODEL_REFS.gengar, { height: 1, anchor: 'center' }, providers).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelUnavailableError);
    expect((err as ModelUnavailableError).attempts).toEqual(['local: not listed', 'community: offline']);
  });

  it('with no providers configured it fails fast with no attempts', async () => {
    const err = (await loadPokemonModel(POKEMON_MODEL_REFS.gengar, { height: 1, anchor: 'center' }, []).catch((e: unknown) => e)) as ModelUnavailableError;
    expect(err.attempts).toEqual([]);
  });
});

describe('fitModel', () => {
  const box = (w: number, h: number, d: number, at: [number, number, number]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
    m.position.set(...at);
    return m;
  };
  const fitted = (model: THREE.Object3D, opts: Parameters<typeof fitModel>[2]) => {
    const inner = new THREE.Group();
    inner.add(model);
    fitModel(model, inner, opts);
    return new THREE.Box3().setFromObject(inner);
  };

  it('scales to the target height and centres on the origin', () => {
    const b = fitted(box(2, 4, 2, [10, 5, -3]), { height: 1, anchor: 'center' });
    expect(b.max.y - b.min.y).toBeCloseTo(1);
    expect(b.getCenter(new THREE.Vector3()).length()).toBeCloseTo(0);
  });

  it('feet anchor puts the lowest point on y = 0', () => {
    const b = fitted(box(1, 2, 1, [0, -7, 0]), { height: 1, anchor: 'feet' });
    expect(b.min.y).toBeCloseTo(0);
    expect(b.max.y).toBeCloseTo(1);
  });

  it('caps wide models by maxWidth', () => {
    const b = fitted(box(10, 1, 2, [0, 0, 0]), { height: 1, maxWidth: 2, anchor: 'center' });
    expect(b.max.x - b.min.x).toBeCloseTo(2);
    expect(b.max.y - b.min.y).toBeCloseTo(0.2);
  });

  it('rejects an empty model', () => {
    expect(() => fitted(new THREE.Group(), { height: 1, anchor: 'center' })).toThrow(/bounding box/);
  });
});

describe('pickIdleClip', () => {
  const clip = (name: string) => new THREE.AnimationClip(name, 1, []);
  it('prefers an ambient wait/idle loop and never a battle clip', () => {
    expect(pickIdleClip([clip('x|00001_battlewait01_loop'), clip('x|00000_defaultwait01_loop'), clip('x|attack01')])?.name).toBe('x|00000_defaultwait01_loop');
    expect(pickIdleClip([clip('Armature|pm0887_00_00_ba10_waitA01')])?.name).toBe('Armature|pm0887_00_00_ba10_waitA01');
    expect(pickIdleClip([clip('attack'), clip('x|battlewait01_loop')])).toBeNull();
    expect(pickIdleClip([])).toBeNull();
  });
});
