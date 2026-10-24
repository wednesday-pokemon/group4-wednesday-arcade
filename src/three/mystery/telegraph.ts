// Ground telegraphs for Crackstone's two attacks (the fairness of the game, so they must read from the third-person camera).
// Each telegraph is a flat ground disc (rim, fill, rune glyph) plus a low translucent wall at the rim, because a flat ring seen from a
// camera 1.7 m above the ground is nearly edge-on. Normal blending with a dark outline keeps the witch-green readable on lamp-lit
// ground and in greyscale (dashed rim, sweeping arc, radial spark: shape, not just colour).
//   scan : a ring expanding from him to the scan radius over the warning (reduced motion: the ring is drawn at its final radius from the
//          first moment and filled in place), then a short pulse flash (reduced motion: no white).
//   curse: a rune circle whose rim fills clockwise from `startedAt` to `landsAt`, then a burst (hit) or a fade (miss).
import * as THREE from 'three';

const VERT = /* glsl */ `varying vec2 vP; varying float vH;
void main(){ vP = position.xz; vH = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const COMMON = /* glsl */ `precision highp float;
uniform float uKind; uniform float uR; uniform float uHalf; uniform float uProg; uniform float uOut; uniform float uMode; uniform float uTime; uniform float uReduced; uniform float uAlpha;
uniform vec3 uColor; uniform vec3 uHi;
varying vec2 vP; varying float vH;
const float TAU = 6.2831853;
float seg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
`;

const GROUND_FRAG = COMMON + /* glsl */ `
void main(){
  vec2 q = vP * uHalf;
  float d = length(q);
  float a01 = fract(atan(q.x, -q.y) / TAU);
  vec3 col = uColor; float al = 0.0; float dark = 0.0;
  float R = uR;
  if (uKind < 0.5) {
    // ---- scan
    float front = mix(R * uProg, R, uReduced);
    float edgeBand = 1.0 - smoothstep(0.12, 0.34, abs(d - R));
    float dashes = mix(0.5, 1.0, step(0.5, fract(a01 * 44.0)));
    float edgeA = edgeBand * (0.6 + 0.4 * uProg) * mix(dashes, 1.0, uProg * uProg);
    float fill = (1.0 - smoothstep(R - 0.25, R, d)) * mix(0.06 + 0.2 * uProg, 0.1 + 0.42 * uProg, uReduced);
    float band = (1.0 - smoothstep(0.1, 0.5 + 0.04 * R, abs(d - front))) * (1.0 - uReduced);
    float trail = smoothstep(front - 3.5, front, d) * step(d, front) * 0.2 * (1.0 - uReduced);
    float pulseRim = (1.0 - smoothstep(0.2, 0.7, abs(d - R))) * uOut;
    float pulseFill = (1.0 - smoothstep(0.0, R, d)) * uOut * 0.4 + (1.0 - smoothstep(R - 0.3, R, d)) * uOut * 0.18;
    al = max(max(edgeA, band * 0.95), max(fill, trail));
    al = max(al, max(pulseRim * 0.95, pulseFill));
    col = mix(col, uHi, clamp(band * 0.6 + pulseRim * 0.5, 0.0, 1.0));
    col = mix(col, vec3(1.0), uOut * 0.5 * (1.0 - uReduced));
    dark = (1.0 - smoothstep(0.0, 0.22, abs(d - (R + 0.34)))) * 0.45 * (0.3 + 0.7 * uProg);
  } else {
    // ---- curse
    float on = step(a01, uProg);
    float thin = 1.0 - smoothstep(0.07, 0.2, abs(d - (R - 0.14)));
    float thick = 1.0 - smoothstep(0.16, 0.38, abs(d - (R - 0.22)));
    float rim = mix(thin * 0.34, thick, on);
    float spark = (1.0 - smoothstep(0.0, 0.014, abs(a01 - uProg))) * step(R - 0.9, d) * step(d, R) * step(0.001, uProg) * step(uProg, 0.999);
    float disc = (1.0 - smoothstep(R - 0.35, R - 0.05, d)) * (0.05 + 0.2 * uProg);
    float rot = uTime * 0.35 * (1.0 - uReduced);
    float cr = cos(rot), sr = sin(rot);
    vec2 g = vec2(cr * q.x - sr * q.y, sr * q.x + cr * q.y);
    float Rg = R * 0.72;
    float star = 0.0;
    for (int k = 0; k < 5; k++) {
      float a0 = TAU * float(k) / 5.0, a1 = TAU * float(k + 2) / 5.0;
      star = max(star, 1.0 - smoothstep(0.035, 0.13, seg(g, Rg * vec2(sin(a0), -cos(a0)), Rg * vec2(sin(a1), -cos(a1)))));
    }
    float ring1 = 1.0 - smoothstep(0.04, 0.12, abs(d - Rg));
    float ring2 = 1.0 - smoothstep(0.03, 0.1, abs(d - R * 0.34));
    float ticks = (1.0 - smoothstep(0.05, 0.12, abs(d - R * 0.86))) * step(0.5, fract(a01 * 24.0 + 0.25)) * 0.8;
    float glyph = max(max(star, ring1 * 0.7), max(ring2 * 0.6, ticks * 0.6)) * (0.22 + 0.62 * uProg);
    al = max(max(rim, spark), max(disc, glyph));
    col = mix(col, uHi, clamp(spark + glyph * 0.35 + on * thick * 0.25, 0.0, 1.0));
    float burstR = R * (1.0 + (1.0 - uOut) * 0.55);
    float burst = (1.0 - smoothstep(0.15, 0.65, abs(d - burstR))) * uOut;
    float flash = (1.0 - smoothstep(0.0, R, d)) * uOut * 0.55;
    if (uMode > 0.5 && uMode < 1.5) { al = max(max(al, burst * 0.95), flash); col = mix(col, uHi, burst * 0.6); col = mix(col, vec3(1.0), uOut * 0.45 * (1.0 - uReduced)); }
    if (uMode > 1.5) al *= uOut;
    dark = (1.0 - smoothstep(0.0, 0.2, abs(d - (R + 0.2)))) * 0.4 * (0.4 + 0.6 * uProg) * (uMode > 1.5 ? uOut : 1.0);
  }
  float outA = clamp(al, 0.0, 1.0) * uAlpha;
  vec3 outC = mix(col, vec3(0.03, 0.08, 0.02), clamp(dark * (1.0 - al), 0.0, 1.0));
  float a = max(outA, dark * uAlpha * (1.0 - al));
  if (a < 0.01) discard;
  gl_FragColor = vec4(outC * a, a);
}`;

const WALL_FRAG = COMMON + /* glsl */ `
void main(){
  float a01 = fract(atan(vP.x, vP.y) / TAU);
  float a01c = fract(atan(vP.x, -vP.y) / TAU);
  float grad = pow(1.0 - vH, 1.6);
  float al = 0.0;
  vec3 col = uColor;
  if (uKind < 0.5) {
    float base = mix(0.62, 0.2 + 0.5 * uProg, uReduced);
    float stripes = mix(0.7, 1.0, step(0.5, fract(a01 * 44.0)));
    al = grad * base * stripes;
    al = max(al, grad * uOut * 0.7);
    col = mix(col, uHi, vH * 0.4);
  } else {
    float on = step(a01c, uProg);
    al = grad * mix(0.1, 0.72, on);
    if (uMode > 0.5 && uMode < 1.5) al = max(al, grad * uOut * 0.8);
    if (uMode > 1.5) al *= uOut;
    col = mix(col, uHi, on * vH * 0.5);
  }
  float a = al * uAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col * a, a);
}`;

function mat(frag: string, color: string, hi: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: frag,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    uniforms: {
      uKind: { value: 0 }, uR: { value: 5 }, uHalf: { value: 8 }, uProg: { value: 0 }, uOut: { value: 0 }, uMode: { value: 0 }, uTime: { value: 0 }, uReduced: { value: 0 }, uAlpha: { value: 1 },
      uColor: { value: new THREE.Color(color) }, uHi: { value: new THREE.Color(hi) },
    },
  });
}

export interface TelegraphParams {
  x: number; z: number; r: number;
  /** warning / fill progress 0..1 */
  prog: number;
  /** burst / pulse / fade life 1 -> 0 (0 = none) */
  out: number;
  /** curse only: 0 charging, 1 hit burst, 2 miss fade */
  mode: number;
  time: number;
  reduced: boolean;
  alpha: number;
}

export class Telegraph {
  readonly ground: THREE.Mesh;
  readonly wall: THREE.Mesh;
  private readonly gMat: THREE.ShaderMaterial;
  private readonly wMat: THREE.ShaderMaterial;
  private static gGeo: THREE.BufferGeometry | null = null;
  private static wGeo: THREE.BufferGeometry | null = null;
  private readonly wallH: number;

  constructor(readonly kind: 'scan' | 'curse', color = '#a8e063', hi = '#c4ef8a') {
    Telegraph.gGeo ??= new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    Telegraph.wGeo ??= new THREE.CylinderGeometry(1, 1, 1, 56, 1, true).translate(0, 0.5, 0);
    this.gMat = mat(GROUND_FRAG, color, hi);
    this.wMat = mat(WALL_FRAG, color, hi);
    for (const m of [this.gMat, this.wMat]) m.uniforms.uKind.value = kind === 'scan' ? 0 : 1;
    this.ground = new THREE.Mesh(Telegraph.gGeo, this.gMat);
    this.wall = new THREE.Mesh(Telegraph.wGeo, this.wMat);
    this.wallH = kind === 'scan' ? 1.25 : 0.95;
    for (const o of [this.ground, this.wall]) { o.frustumCulled = false; o.renderOrder = 3; o.visible = false; }
    this.ground.renderOrder = 2;
  }

  /** Show / update. The wall sits at `wallR` (the expanding front for a scan, the circle for a curse). */
  set(p: TelegraphParams, wallR: number): void {
    const half = p.r * 1.75 + 0.5;
    this.ground.position.set(p.x, 0.12, p.z);
    this.ground.scale.set(half, 1, half);
    this.wall.position.set(p.x, 0.0, p.z);
    this.wall.scale.set(Math.max(0.05, wallR), this.wallH, Math.max(0.05, wallR));
    for (const m of [this.gMat, this.wMat]) {
      const u = m.uniforms;
      u.uR.value = p.r; u.uHalf.value = half; u.uProg.value = p.prog; u.uOut.value = p.out; u.uMode.value = p.mode; u.uTime.value = p.time;
      u.uReduced.value = p.reduced ? 1 : 0; u.uAlpha.value = p.alpha;
    }
    this.ground.visible = this.wall.visible = p.alpha > 0.01;
  }
  hide(): void { this.ground.visible = this.wall.visible = false; }
  dispose(): void { this.gMat.dispose(); this.wMat.dispose(); }
}
