// Model providers: each turns a PokemonModelRef into a model URL (or null = "not here, try the next one").
// `local` reads the build-time cache (public/models/pokemon/manifest.json, written by npm run art:models3d);
// `community` reads the community Pokémon 3D API catalog (https://github.com/Pokemon-3D-api/api-server), an optional,
// unguaranteed service. Catalog/manifest are fetched once per page and shared; failures are cached for a cooldown.
import { catalogFormName, refKey, type PokemonModelRef } from './refs.ts';

export interface ResolvedModel {
  url: string;
  provider: string;
}

export interface ModelProvider {
  readonly id: string;
  resolve(ref: PokemonModelRef): Promise<ResolvedModel | null>;
}

export const COMMUNITY_API_DEFAULT = 'https://pokemon-3d-api.onrender.com/v1/pokemon';
/** Hosts the community catalog's model URLs may point at; anything else is ignored rather than loaded. */
export const COMMUNITY_MODEL_HOSTS_DEFAULT = ['raw.githubusercontent.com'];

const FETCH_TIMEOUT_MS = 12_000;
const RETRY_AFTER_MS = 60_000;

export async function fetchJson(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  // Vite's SPA fallback answers missing files with index.html + 200
  if (!(res.headers.get('content-type') ?? '').includes('json')) throw new Error(`not JSON: ${url}`);
  return res.json();
}

/** Memoised async load that forgets a failure after `RETRY_AFTER_MS` (a flaky venue network may recover). */
function cachedOnce<T>(load: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  let failedAt = 0;
  return () => {
    if (p && failedAt && performance.now() - failedAt > RETRY_AFTER_MS) p = null;
    if (!p) {
      failedAt = 0;
      p = load().catch((e: unknown) => {
        failedAt = performance.now();
        throw e;
      });
    }
    return p;
  };
}

export function isAllowedModelUrl(raw: string, hosts: readonly string[], base?: string): boolean {
  let u: URL;
  try {
    u = new URL(raw, base);
  } catch {
    return false;
  }
  const sameOrigin = typeof location !== 'undefined' && u.origin === location.origin;
  if (!sameOrigin && (u.protocol !== 'https:' || !hosts.includes(u.hostname))) return false;
  return /\.(glb|gltf)$/i.test(u.pathname);
}

// ------------------------------------------------------------------------------------------------- community API

/** dexId → formName → model URL. Entries with missing/odd fields are skipped, never guessed. */
export type CommunityCatalog = Map<number, Map<string, string>>;

export function parseCommunityCatalog(json: unknown, hosts: readonly string[] = COMMUNITY_MODEL_HOSTS_DEFAULT): CommunityCatalog {
  if (!Array.isArray(json)) throw new Error('community catalog: expected an array');
  const out: CommunityCatalog = new Map();
  for (const entry of json) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, forms } = entry as { id?: unknown; forms?: unknown };
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0 || !Array.isArray(forms)) continue;
    const byForm = new Map<string, string>();
    for (const f of forms) {
      if (!f || typeof f !== 'object') continue;
      const { formName, model } = f as { formName?: unknown; model?: unknown };
      if (typeof formName !== 'string' || typeof model !== 'string') continue;
      if (!isAllowedModelUrl(model, hosts)) continue;
      if (!byForm.has(formName)) byForm.set(formName, model);
    }
    if (byForm.size) out.set(id, byForm);
  }
  return out;
}

export function communityProvider(endpoint = COMMUNITY_API_DEFAULT, hosts: readonly string[] = COMMUNITY_MODEL_HOSTS_DEFAULT): ModelProvider {
  // the free host cold-starts slowly; give the catalog more time than a model file
  const catalog = cachedOnce(async () => parseCommunityCatalog(await fetchJson(endpoint, 30_000), hosts));
  return {
    id: 'community',
    async resolve(ref) {
      const form = catalogFormName(ref);
      if (!form) return null;
      const url = (await catalog()).get(ref.dexId)?.get(form);
      return url ? { url, provider: 'community' } : null;
    },
  };
}

// ---------------------------------------------------------------------------------------------------- local cache

export interface LocalModelManifest {
  models: Record<string, { file: string }>;
}

export function parseLocalManifest(json: unknown): Map<string, string> {
  const models = (json as Partial<LocalModelManifest> | null)?.models;
  if (!models || typeof models !== 'object') throw new Error('local model manifest: missing "models"');
  const out = new Map<string, string>();
  for (const [key, v] of Object.entries(models)) {
    const file = (v as { file?: unknown } | null)?.file;
    // plain file names only: no paths, no URLs
    if (typeof file === 'string' && /^[a-z0-9_-]+\.glb$/i.test(file)) out.set(key, file);
  }
  return out;
}

export function localProvider(dir: string): ModelProvider {
  const root = dir.endsWith('/') ? dir : `${dir}/`;
  const manifest = cachedOnce(async () => parseLocalManifest(await fetchJson(`${root}manifest.json`)));
  return {
    id: 'local',
    async resolve(ref) {
      const file = (await manifest()).get(refKey(ref));
      return file ? { url: `${root}${file}`, provider: 'local' } : null;
    },
  };
}

// --------------------------------------------------------------------------------------------------- configuration

export type ProviderId = 'local' | 'community';

/**
 * Provider order, first hit wins. Default `local,community`: the kiosk cache first (no venue-network dependency),
 * the community API only for models missing from it. Override with VITE_POKEMON_MODEL_PROVIDERS or `?pokemon3d=`
 * (`off` disables 3D models; the artwork billboard is used instead).
 */
export function providerOrder(env: Record<string, unknown> = import.meta.env, search = typeof location !== 'undefined' ? location.search : ''): ProviderId[] {
  const raw = new URLSearchParams(search).get('pokemon3d') ?? (typeof env.VITE_POKEMON_MODEL_PROVIDERS === 'string' && env.VITE_POKEMON_MODEL_PROVIDERS) ?? '';
  if (!raw) return ['local', 'community'];
  const ids = raw.split(',').map((s) => s.trim().toLowerCase());
  return [...new Set(ids.filter((s): s is ProviderId => s === 'local' || s === 'community'))];
}

let chain: ModelProvider[] | null = null;

export function defaultProviders(): ModelProvider[] {
  if (chain) return chain;
  const env = import.meta.env as Record<string, unknown>;
  const base = typeof env.BASE_URL === 'string' ? env.BASE_URL : '/';
  const endpoint = typeof env.VITE_POKEMON_3D_API === 'string' && env.VITE_POKEMON_3D_API ? env.VITE_POKEMON_3D_API : COMMUNITY_API_DEFAULT;
  chain = providerOrder(env).map((id) => (id === 'local' ? localProvider(`${base}models/pokemon/`) : communityProvider(endpoint)));
  return chain;
}
