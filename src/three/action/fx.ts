// Shader materials + instanced helpers for the action scene: instanced light glows (with water-mirror streaks),
// volumetric-ish fog puffs, mirrored static reflections, foam/shallows, route ribbons, current streaks, fresnel bubbles,
// light beams and the screen overlay. Everything is a handful of draw calls; colours are plain sRGB (no tone mapping).
import * as THREE from 'three';
import { srgbVec } from '../shaders.ts';

export interface FxUniforms {
  uTime: { value: number };
  uFogDensity: { value: number };
  uBoat: { value: THREE.Vector2 };
  /** x, z, radius, strength of the "fog cleared" bubble. */
  uClear: { value: THREE.Vector4 };
}

export function createFxUniforms(): FxUniforms {
  return {
    uTime: { value: 0 },
    uFogDensity: { value: 0.003 },
    uBoat: { value: new THREE.Vector2() },
    uClear: { value: new THREE.Vector4(0, 0, 1, 0) },
  };
}

const NOISE = /* glsl */ `
float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0)), c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`;

// ------------------------------------------------------------------------------------------- instanced billboards
export interface GlowEntry {
  x: number; y: number; z: number;
  size: number;
  color: THREE.ColorRepresentation;
  alpha?: number;
  flicker?: number; // 0 steady … 1 candle
  phase?: number;
  /** minimum visibility through fog (beacons / far windows stay readable) 0..1 */
  fogFloor?: number;
  sy?: number; // optional vertical size (defaults to size)
}

const BILLBOARD_VS = /* glsl */ `
  uniform float uTime; uniform float uMirror; uniform float uFogDensity;
  uniform vec4 uClear;
  attribute vec4 aColor; attribute vec4 aParams;
  varying vec2 vUv; varying vec4 vCol; varying float vPh;
  void main(){
    vec3 c = instanceMatrix[3].xyz;
    float sx = length(instanceMatrix[0].xyz);
    float sy = length(instanceMatrix[1].xyz);
    vec3 wc = (modelMatrix * vec4(c, 1.0)).xyz;
    float ph = aParams.x;
    #ifdef PUFF
      wc.xz += vec2(sin(uTime * 0.05 + ph * 6.2831), cos(uTime * 0.041 + ph * 4.0)) * 3.0;
      wc.y += sin(uTime * 0.2 + ph * 9.0) * 0.4;
    #endif
    float fl = 1.0 + aParams.y * (0.55 * sin(uTime * (4.0 + aParams.z * 3.0) + ph * 40.0) * sin(uTime * 2.3 + ph * 9.0) + 0.25 * sin(uTime * 13.0 + ph * 31.0));
    vec2 q = position.xy;
    float mk = 1.0;
    if (uMirror > 0.5) { wc.y = -wc.y; q *= vec2(0.5, 2.8); mk = 0.5; }
    vec4 mv = viewMatrix * vec4(wc, 1.0);
    float dist = max(-mv.z, 0.5);
    mv.xy += q * vec2(sx, sy) * fl;
    gl_Position = projectionMatrix * mv;
    float fogAtt = max(aParams.w, exp(-pow(uFogDensity * dist * 0.5, 2.0)));
    float a = aColor.a * fl * mk;
    #ifdef PUFF
      fogAtt = 1.0;
      a *= smoothstep(3.0, 18.0, dist);
      float dc = distance(wc.xz, uClear.xy);
      a *= 1.0 - uClear.w * (1.0 - smoothstep(uClear.z * 0.55, uClear.z, dc));
    #else
      a *= fogAtt;
    #endif
    vCol = vec4(aColor.rgb, a);
    vUv = position.xy + 0.5;
    vPh = ph;
  }`;

const GLOW_FS = /* glsl */ `
  uniform float uMirror; uniform float uTime;
  varying vec2 vUv; varying vec4 vCol; varying float vPh;
  void main(){
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;
    float a = pow(clamp(1.0 - r, 0.0, 1.0), 2.2) + 0.85 * smoothstep(0.2, 0.0, r);
    if (uMirror > 0.5) {
      float w = 0.55 + 0.45 * sin(vUv.y * 34.0 - uTime * 2.6 + p.x * 9.0 + vPh * 20.0);
      a = pow(clamp(1.0 - r, 0.0, 1.0), 1.5) * w;
    }
    gl_FragColor = vec4(vCol.rgb * a * vCol.a, 1.0);
  }`;

const PUFF_FS = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv; varying vec4 vCol; varying float vPh;
  ${NOISE}
  void main(){
    vec2 p = vUv - 0.5;
    float r = length(p * vec2(1.0, 1.35)) * 2.0;
    float n = vnoise(vUv * 3.2 + vPh * 17.0 + uTime * 0.03);
    float a = smoothstep(1.0, 0.05, r);
    a = a * a * (0.5 + 0.75 * n);
    gl_FragColor = vec4(vCol.rgb, vCol.a * a);
  }`;

export function createGlowFieldMaterial(u: FxUniforms, mirror: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: u.uTime, uFogDensity: u.uFogDensity, uClear: u.uClear, uMirror: { value: mirror ? 1 : 0 } },
    vertexShader: BILLBOARD_VS,
    fragmentShader: GLOW_FS,
  });
}

export function createPuffFieldMaterial(u: FxUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    defines: { PUFF: '' },
    uniforms: { uTime: u.uTime, uFogDensity: u.uFogDensity, uClear: u.uClear, uMirror: { value: 0 } },
    vertexShader: BILLBOARD_VS,
    fragmentShader: PUFF_FS,
  });
}

/** Instanced camera-facing quads (lights, windows, fog puffs). One draw call per field (plus one for the mirror). */
export class BillboardField {
  readonly mesh: THREE.InstancedMesh;
  readonly mirror: THREE.InstancedMesh | null;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly colors: THREE.InstancedBufferAttribute;
  private readonly params: THREE.InstancedBufferAttribute;
  private readonly m = new THREE.Matrix4();
  private readonly c = new THREE.Color();
  private used = 0;

  constructor(readonly capacity: number, material: THREE.ShaderMaterial, mirrorMaterial: THREE.ShaderMaterial | null, order = 3) {
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.geo.setAttribute('uv', base.getAttribute('uv'));
    this.colors = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.params = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.colors.setUsage(THREE.DynamicDrawUsage);
    this.params.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aColor', this.colors);
    this.geo.setAttribute('aParams', this.params);
    this.mesh = new THREE.InstancedMesh(this.geo, material, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (mirrorMaterial) {
      this.mirror = new THREE.InstancedMesh(this.geo, mirrorMaterial, capacity);
      this.mirror.instanceMatrix = this.mesh.instanceMatrix;
      this.mirror.count = 0;
      this.mirror.frustumCulled = false;
      this.mirror.renderOrder = order - 1;
    } else this.mirror = null;
  }

  get count(): number {
    return this.used;
  }

  add(e: GlowEntry): number {
    if (this.used >= this.capacity) return -1;
    const i = this.used++;
    this.set(i, e);
    this.mesh.count = this.used;
    if (this.mirror) this.mirror.count = this.used;
    return i;
  }

  set(i: number, e: GlowEntry): void {
    this.m.makeScale(e.size, e.sy ?? e.size, e.size).setPosition(e.x, e.y, e.z);
    this.mesh.setMatrixAt(i, this.m);
    this.c.set(e.color);
    this.colors.setXYZW(i, this.c.r, this.c.g, this.c.b, e.alpha ?? 1);
    this.params.setXYZW(i, e.phase ?? ((i * 0.6180339) % 1), e.flicker ?? 0, 0.5 + ((i * 0.37) % 1), e.fogFloor ?? 0);
  }

  /** Fast per-frame update of an existing instance (position/size/colour/alpha). */
  update(i: number, x: number, y: number, z: number, size: number, alpha: number, color?: THREE.Color): void {
    this.m.makeScale(size, size, size).setPosition(x, y, z);
    this.mesh.setMatrixAt(i, this.m);
    this.colors.setW(i, alpha);
    if (color) this.colors.setXYZ(i, color.r, color.g, color.b);
  }

  /** Commit CPU-side edits to the GPU. */
  flush(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    this.colors.needsUpdate = true;
    this.params.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.mesh.dispose();
    this.mirror?.dispose();
  }
}

// ------------------------------------------------------------------------------------------------ static mirror
/** Mirrors a lit vertex-colour mesh about the water plane: cheap planar-style reflection of land and landmarks. */
export function createMirrorMaterial(u: FxUniforms, additive: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    fog: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uTime: u.uTime, uAlpha: { value: additive ? 0.5 : 0.42 }, uGain: { value: additive ? 1.0 : 1.9 }, uSky: { value: srgbVec('#2a3578') } },
    ]),
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vCol; varying float vH;
      #include <fog_pars_vertex>
      void main(){
        vec3 p = position;
        vH = p.y;
        p.y = -p.y;
        float w = 0.12 + 0.012 * max(vH, 0.0);
        p.x += sin(p.y * 1.7 + uTime * 1.3 + p.z * 0.31) * w;
        p.z += cos(p.y * 1.3 + uTime * 1.1 + p.x * 0.27) * w;
        vCol = color;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uAlpha; uniform float uGain; uniform vec3 uSky;
      varying vec3 vCol; varying float vH;
      #include <fog_pars_fragment>
      void main(){
        if (vH < -0.05) discard;
        vec3 col = mix(vCol * uGain, uSky, 0.18);
        float a = uAlpha * (0.35 + 0.65 * exp(-max(vH, 0.0) * 0.03));
        gl_FragColor = vec4(col, a);
        #ifdef USE_FOG
          #ifdef FOG_EXP2
            float fa = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
          #else
            float fa = smoothstep(fogNear, fogFar, vFogDepth);
          #endif
          gl_FragColor.a *= 1.0 - fa;
        #endif
      }`,
  });
}

// -------------------------------------------------------------------------------------- foam / shallows / hazard rings
/** Additive foam strips. Vertex colour = intensity; animated with world-space noise; fades with scene fog. */
export function createFoamMaterial(u: FxUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: u.uTime, uFogDensity: u.uFogDensity },
    vertexShader: /* glsl */ `
      varying vec3 vCol; varying vec3 vWorld;
      void main(){
        vCol = color;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uFogDensity;
      varying vec3 vCol; varying vec3 vWorld;
      ${NOISE}
      void main(){
        float d = length(vWorld - cameraPosition);
        float n = vnoise(vWorld.xz * 0.85 + vec2(uTime * 0.17, -uTime * 0.11));
        float n2 = vnoise(vWorld.xz * 2.1 - vec2(uTime * 0.2, uTime * 0.13));
        float m = 0.45 + 0.7 * n + 0.35 * n2 + 0.12 * sin(uTime * 1.3 + vWorld.x * 0.25 + vWorld.z * 0.2);
        float fa = exp(-pow(uFogDensity * d * 0.8, 2.0));
        gl_FragColor = vec4(vCol * m * fa, 1.0);
      }`,
  });
}

/** Route ribbons: faint flowing dashes toward the destination, fading with distance from the boat. */
export function createRibbonMaterial(u: FxUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: u.uTime, uBoat: u.uBoat, uFogDensity: u.uFogDensity, uStrength: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vCol; varying vec2 vUv; varying vec3 vWorld;
      void main(){
        vCol = color; vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec2 uBoat; uniform float uFogDensity; uniform float uStrength;
      varying vec3 vCol; varying vec2 vUv; varying vec3 vWorld;
      void main(){
        float edge = smoothstep(0.0, 0.4, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
        float f = fract(vUv.x * 0.16 - uTime * 0.3);
        float dash = smoothstep(0.0, 0.2, f) * smoothstep(0.6, 0.4, f);
        float d = distance(vWorld.xz, uBoat);
        float near = 1.0 - smoothstep(60.0, 170.0, d);
        float dc = length(vWorld - cameraPosition);
        float fa = exp(-pow(uFogDensity * dc * 0.8, 2.0));
        float a = edge * (0.28 + 0.72 * dash) * near * fa * 0.22 * uStrength;
        gl_FragColor = vec4(vCol * a, 1.0);
      }`,
  });
}

/** Current streaks: instanced flat quads that slide along the flow inside each zone. */
export function createStreakMaterial(u: FxUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: u.uTime, uFogDensity: u.uFogDensity },
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute vec4 aZone; attribute vec4 aSeed;
      varying vec2 vUv; varying float vA; varying float vD;
      void main(){
        float R = aZone.z;
        vec2 dir = vec2(cos(aZone.w), sin(aZone.w));
        vec2 perp = vec2(-dir.y, dir.x);
        float u = fract(aSeed.x + uTime * aSeed.z / (2.0 * R));
        vec2 center = aZone.xy + dir * (u * 2.0 - 1.0) * R + perp * aSeed.y * R;
        vec2 local = vec2(position.x * aSeed.w, position.y * 0.16);
        vec2 xz = center + dir * local.x + perp * local.y;
        vec2 rel = (center - aZone.xy) / R;
        vA = sin(u * 3.14159) * (1.0 - smoothstep(0.7, 1.0, length(rel)));
        vUv = position.xy + 0.5;
        vec4 mv = modelViewMatrix * vec4(xz.x, 0.12, xz.y, 1.0);
        vD = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uFogDensity;
      varying vec2 vUv; varying float vA; varying float vD;
      void main(){
        float e = smoothstep(0.0, 0.5, vUv.x) * smoothstep(1.0, 0.5, vUv.x) * smoothstep(0.0, 0.4, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
        float fa = exp(-pow(uFogDensity * vD * 0.8, 2.0));
        gl_FragColor = vec4(vec3(0.45, 0.72, 1.0) * e * vA * fa * 0.55, 1.0);
      }`,
  });
}

export function createStreakGeometry(zones: { x: number; z: number; radius: number; pushX: number; pushZ: number }[], perZone: number): THREE.InstancedBufferGeometry | null {
  const n = zones.length * perZone;
  if (n === 0) return null;
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  const zone = new Float32Array(n * 4);
  const seed = new Float32Array(n * 4);
  let k = 0;
  zones.forEach((z, zi) => {
    const speed = Math.hypot(z.pushX, z.pushZ);
    // flow direction in the XZ plane (x, z) → the shader treats the second component as z
    const ang = Math.atan2(z.pushZ, z.pushX);
    for (let i = 0; i < perZone; i++, k++) {
      const h1 = ((i * 0.754877666 + zi * 0.31) % 1);
      const h2 = ((i * 0.569840296 + zi * 0.57) % 1);
      zone.set([z.x, z.z, z.radius, ang], k * 4);
      seed.set([h1, (h2 * 2 - 1) * 0.92, 5 + speed * 3 + h1 * 3, 4 + h2 * 5], k * 4);
    }
  });
  geo.setAttribute('aZone', new THREE.InstancedBufferAttribute(zone, 4));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  geo.instanceCount = n;
  return geo;
}

// ------------------------------------------------------------------------------------------------- bubbles / beams
/** Fresnel rim bubble (shield, decoy, current shield): bright at grazing angles, faint hex-like banding. */
export function createFresnelMaterial(hex: string, u: FxUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: u.uTime, uColor: { value: srgbVec(hex) }, uAlpha: { value: 1 }, uPower: { value: 2.2 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = cameraPosition - wp.xyz;
        vP = position;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uColor; uniform float uAlpha; uniform float uPower;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPower);
        float band = 0.65 + 0.35 * sin(vP.y * 9.0 + vP.x * 7.0 - uTime * 2.0);
        float a = (0.08 + 0.92 * f) * band * uAlpha;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
  });
}

/** Flat additive glow (rings on the water, light pools): vertex colour intensity, optional pulse. */
export function createFlatGlowMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
}

export function createBeamMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
}

// --------------------------------------------------------------------------------------------------- screen overlay
export interface OverlayUniforms {
  uThreat: { value: number };
  uRescue: { value: number };
  uFlash: { value: THREE.Vector4 };
  uTime: { value: number };
}

export function createOverlayMaterial(): THREE.ShaderMaterial {
  const uniforms: OverlayUniforms = { uThreat: { value: 0 }, uRescue: { value: 0 }, uFlash: { value: new THREE.Vector4(1, 1, 1, 0) }, uTime: { value: 0 } };
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    premultipliedAlpha: true,
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uThreat; uniform float uRescue; uniform vec4 uFlash; uniform float uTime;
      varying vec2 vUv;
      vec4 over(vec4 acc, vec3 rgb, float a){ a = clamp(a, 0.0, 1.0); return vec4(acc.rgb * (1.0 - a) + rgb * a, acc.a * (1.0 - a) + a); }
      void main(){
        vec2 p = (vUv * 2.0 - 1.0) * vec2(0.9, 1.0);
        float r = length(p);
        float vig = smoothstep(0.55, 1.4, r);
        vec4 acc = vec4(0.0);
        acc = over(acc, vec3(0.03, 0.0, 0.06), vig * uThreat * 0.55);
        acc = over(acc, vec3(0.30, 0.02, 0.06), vig * uThreat * uThreat * 0.35);
        float pulse = 0.8 + 0.2 * sin(uTime * 7.0);
        acc = over(acc, vec3(0.34, 0.36, 0.42), uRescue * 0.24);
        acc = over(acc, vec3(0.85, 0.04, 0.08), vig * uRescue * 0.78 * pulse);
        acc = over(acc, uFlash.rgb, uFlash.a);
        gl_FragColor = acc;
      }`,
  });
}

export function createOverlayMesh(material: THREE.ShaderMaterial): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const m = new THREE.Mesh(g, material);
  m.frustumCulled = false;
  m.renderOrder = 1000;
  return m;
}
