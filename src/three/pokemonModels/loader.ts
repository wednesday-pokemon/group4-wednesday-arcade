// GLB/glTF loading for Pokémon models: one in-flight request and one parsed template per URL (ref-counted, disposed
// when the last instance goes), per-instance clones with their own materials (fade/flash never leak between
// instances), and normalisation to a size box so every species fits the same slot.
import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { defaultProviders, type ModelProvider, type ResolvedModel } from './providers.ts';
import type { PokemonModelRef } from './refs.ts';

const MODEL_TIMEOUT_MS = 20_000;
// some sources ship dozens of animation clips (Gholdengo: ~10 MB, 71 clips, 5k triangles)
const MAX_MODEL_BYTES = 16 * 1024 * 1024;
/** Clip names that are safe ambient loops; battle/attack clips are never auto-played. */
const IDLE_CLIP = /default_?wait\d*_loop|(^|[|_])idle|(^|[|_])wait/i;

export interface FitOptions {
  /** Target height (world units). */
  height: number;
  /** Cap on the larger horizontal extent, so long/wide species don't dwarf the scene. */
  maxWidth?: number;
  /** `center`: bbox centre at the origin (floating companion); `feet`: lowest point on y = 0 (standing on ground). */
  anchor: 'center' | 'feet';
  /** glTF models face +Z; the game's models face -Z. */
  faceNegZ?: boolean;
  /** 0..1 self-illumination from the base colour map, so textures stay readable in a dark scene. */
  selfLit?: number;
}

export interface PokemonModelInstance {
  /** Normalised model; position/rotate/scale this, not its children. */
  readonly root: THREE.Group;
  /** This instance's own materials (safe to tint/fade). */
  readonly materials: readonly THREE.Material[];
  readonly source: ResolvedModel;
  /** Name of the idle loop being played, when the model ships one. */
  readonly idleClip: string | null;
  /** Advances the idle loop (no-op without one). */
  update(dt: number): void;
  dispose(): void;
}

export class ModelUnavailableError extends Error {
  constructor(readonly ref: PokemonModelRef, readonly attempts: string[]) {
    super(`no 3D model for #${ref.dexId} ${ref.form}: ${attempts.join('; ') || 'no providers configured'}`);
    this.name = 'ModelUnavailableError';
  }
}

// ------------------------------------------------------------------------------------------------- template cache

let gltfLoader: GLTFLoader | null = null;

function loader(): GLTFLoader {
  if (gltfLoader) return gltfLoader;
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  // decoder vendored in public/draco (copied from three/examples/jsm/libs/draco/gltf) so kiosks need no CDN
  const draco = new DRACOLoader().setDecoderPath(`${base}draco/`).setDecoderConfig({ type: 'wasm' });
  gltfLoader = new GLTFLoader().setDRACOLoader(draco);
  return gltfLoader;
}

interface Template {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

interface TemplateEntry {
  promise: Promise<Template>;
  refs: number;
}

const templates = new Map<string, TemplateEntry>();

function looksLikeGltfJson(buf: ArrayBuffer): boolean {
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(64, buf.byteLength)));
  return head.trimStart().startsWith('{');
}

async function fetchTemplate(url: string): Promise<Template> {
  const res = await fetch(url, { signal: AbortSignal.timeout(MODEL_TIMEOUT_MS), credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (Number(res.headers.get('content-length') ?? 0) > MAX_MODEL_BYTES) throw new Error('model too large');
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_MODEL_BYTES) throw new Error('model too large');
  const magic = buf.byteLength >= 4 ? String.fromCharCode(...new Uint8Array(buf, 0, 4)) : '';
  // anything else (e.g. an index.html SPA fallback) is rejected before it reaches the parser
  if (magic !== 'glTF' && !looksLikeGltfJson(buf)) throw new Error('not a GLB/glTF file');
  const gltf = await loader().parseAsync(buf, url.slice(0, url.lastIndexOf('/') + 1));
  const scene = gltf.scene;
  let meshes = 0;
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes++;
  });
  if (!meshes) throw new Error('model has no meshes');
  return { scene, animations: gltf.animations };
}

function acquireTemplate(url: string): TemplateEntry {
  let entry = templates.get(url);
  if (!entry) {
    const e: TemplateEntry = { promise: fetchTemplate(url), refs: 0 };
    // a failed load is forgotten so a later request can retry it
    e.promise.catch(() => {
      if (templates.get(url) === e) templates.delete(url);
    });
    templates.set(url, e);
    entry = e;
  }
  // counted synchronously, so a release racing a pending load can't dispose a template someone is still waiting on
  entry.refs++;
  return entry;
}

function releaseTemplate(url: string, entry: TemplateEntry): void {
  if (--entry.refs > 0) return;
  if (templates.get(url) === entry) templates.delete(url);
  entry.promise.then((t) => disposeDeep(t.scene), () => undefined);
}

function disposeMaterial(m: THREE.Material, withTextures: boolean): void {
  if (withTextures) {
    for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
  }
  m.dispose();
}

/** Geometry, materials and textures of a template (instances share its geometry and textures). */
function disposeDeep(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const m of ([] as THREE.Material[]).concat(mesh.material)) disposeMaterial(m, true);
    (mesh as THREE.Mesh & { skeleton?: THREE.Skeleton }).skeleton?.dispose();
  });
}

/** Number of parsed/pending templates (for debug snapshots and tests). */
export function cachedModelCount(): number {
  return templates.size;
}

// ---------------------------------------------------------------------------------------------------- instances

/** Scales/offsets `inner` so `model` fits the box described by `fit`. Throws on an empty or degenerate bbox. */
export function fitModel(model: THREE.Object3D, inner: THREE.Object3D, fit: FitOptions): void {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  if (box.isEmpty() || ![size.x, size.y, size.z, c.x, c.y, c.z].every(Number.isFinite) || size.y <= 1e-6) {
    throw new Error('model has an empty or invalid bounding box');
  }
  const horiz = Math.max(size.x, size.z);
  const s = Math.min(fit.height / size.y, fit.maxWidth && horiz > 1e-6 ? fit.maxWidth / horiz : Infinity);
  inner.scale.setScalar(s);
  inner.position.set(-c.x * s, -(fit.anchor === 'feet' ? box.min.y : c.y) * s, -c.z * s);
}

export function pickIdleClip(clips: readonly THREE.AnimationClip[]): THREE.AnimationClip | null {
  const loops = clips.filter((c) => IDLE_CLIP.test(c.name) && !/battle/i.test(c.name));
  return loops.find((c) => /loop/i.test(c.name)) ?? loops[0] ?? null;
}

function instantiate(template: Template, source: ResolvedModel, fit: FitOptions, yaw: number, release: () => void): PokemonModelInstance {
  const model = cloneSkinned(template.scene);
  const owned = new Map<THREE.Material, THREE.Material>();
  const own = (m: THREE.Material): THREE.Material => {
    let c = owned.get(m);
    if (!c) {
      c = m.clone();
      const std = c as THREE.MeshStandardMaterial;
      if (fit.selfLit && std.isMeshStandardMaterial) {
        std.emissive.set(std.map ? 0xffffff : std.color);
        std.emissiveMap = std.map;
        std.emissiveIntensity = fit.selfLit;
      }
      owned.set(m, c);
    }
    return c;
  };
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  });
  const clip = pickIdleClip(template.animations);
  const mixer = clip ? new THREE.AnimationMixer(model) : null;
  if (mixer && clip) {
    mixer.clipAction(clip).play();
    mixer.update(0); // fit the idle pose, not the bind pose
  }
  const inner = new THREE.Group();
  inner.add(model);
  fitModel(model, inner, fit);
  const root = new THREE.Group();
  root.name = `pokemon-model:${source.url}`;
  const facing = new THREE.Group();
  facing.rotation.y = (fit.faceNegZ ? Math.PI : 0) + yaw;
  facing.add(inner);
  root.add(facing);
  let disposed = false;
  return {
    root,
    materials: [...owned.values()],
    source,
    idleClip: clip?.name ?? null,
    update(dt) {
      mixer?.update(dt);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      mixer?.stopAllAction();
      mixer?.uncacheRoot(model);
      // clones share geometry + textures with the template; only the cloned materials and skeletons are ours
      for (const m of owned.values()) disposeMaterial(m, false);
      model.traverse((o) => (o as THREE.Mesh & { skeleton?: THREE.Skeleton }).skeleton?.dispose());
      release();
    },
  };
}

async function loadFrom(source: ResolvedModel, fit: FitOptions, yaw: number): Promise<PokemonModelInstance> {
  const entry = acquireTemplate(source.url);
  const release = () => releaseTemplate(source.url, entry);
  try {
    return instantiate(await entry.promise, source, fit, yaw, release);
  } catch (e) {
    release();
    throw e;
  }
}

/**
 * The first model any provider can supply, trying the next provider when one has no entry or its file fails.
 * Rejects with ModelUnavailableError when none can; callers fall back to artwork. Callers that may have moved on
 * (another Pokémon selected, owner disposed) must dispose the returned instance themselves.
 */
export async function loadPokemonModel(ref: PokemonModelRef, fit: FitOptions, providers: readonly ModelProvider[] = defaultProviders()): Promise<PokemonModelInstance> {
  const attempts: string[] = [];
  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
  for (const p of providers) {
    let source: ResolvedModel | null;
    try {
      source = await p.resolve(ref);
    } catch (e) {
      attempts.push(`${p.id}: ${msg(e)}`);
      continue;
    }
    if (!source) {
      attempts.push(`${p.id}: not listed`);
      continue;
    }
    try {
      return await loadFrom(source, fit, ref.modelYaw ?? 0);
    } catch (e) {
      attempts.push(`${p.id}: ${msg(e)}`);
    }
  }
  throw new ModelUnavailableError(ref, attempts);
}
