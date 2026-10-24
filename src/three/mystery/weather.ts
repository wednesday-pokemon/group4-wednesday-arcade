// Weather for the storm case: GPU-animated rain (one LineSegments draw call, no per-frame CPU work) and the lightning scheduler.
// The sky shader's storm clouds are patched in by `patchSkyShader` (the shared sky material is left untouched for other scenes).
import * as THREE from 'three';
import type { ShaderMaterial } from 'three';
import { mulberry32 } from '../util.ts';

export class RainField {
  readonly mesh: THREE.LineSegments;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.ShaderMaterial;

  constructor(count: number, color = '#a8c4ff') {
    const rnd = mulberry32(2024);
    const seed = new Float32Array(count * 2 * 4);
    const end = new Float32Array(count * 2);
    const pos = new Float32Array(count * 2 * 3);
    for (let i = 0; i < count; i++) {
      const x = rnd(), y = rnd(), z = rnd(), w = rnd();
      for (let k = 0; k < 2; k++) {
        const o = (i * 2 + k) * 4;
        seed[o] = x; seed[o + 1] = y; seed[o + 2] = z; seed[o + 3] = w;
        end[i * 2 + k] = k;
      }
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color(color) }, uAlpha: { value: 0.5 } },
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec3 uCam;
        attribute vec4 aSeed; attribute float aEnd;
        varying float vA;
        void main(){
          vec3 box = vec3(30.0, 15.0, 30.0);
          float speed = 15.0 + aSeed.w * 7.0;
          vec3 base = aSeed.xyz * box;
          vec3 p = vec3(0.0);
          p.xz = uCam.xz + (mod(base.xz - uCam.xz + 0.5 * box.xz, box.xz) - 0.5 * box.xz);
          p.y = mod(base.y - uTime * speed, box.y);
          p += vec3(0.35, 1.0, 0.12) * (0.5 + aSeed.w * 0.35) * aEnd;
          float dist = length(p - uCam);
          vA = (1.0 - aEnd) * exp(-dist * 0.045) * (0.5 + 0.5 * aSeed.w);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uAlpha; varying float vA; void main(){ gl_FragColor = vec4(uColor * vA * uAlpha, 1.0); }`,
    });
    this.mesh = new THREE.LineSegments(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  update(time: number, cam: THREE.Vector3, alpha: number): void {
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uCam.value.copy(cam);
    this.mat.uniforms.uAlpha.value = alpha;
  }

  dispose(): void { this.geo.dispose(); this.mat.dispose(); }
}

/** Seeded lightning schedule: a strike every 6-15 s as a quick double flash. `level()` is 0..1 and is always 0 when disabled. */
export class Lightning {
  private readonly rnd: () => number;
  private next: number;
  private t0 = -10;
  private strong = 1;
  /** seconds until the next strike, for tooling */
  constructor(seed: number, private enabled: boolean) {
    this.rnd = mulberry32(seed);
    this.next = 3 + this.rnd() * 5;
  }
  setEnabled(on: boolean): void { this.enabled = on; }
  /** force a strike now (tooling / tests) */
  strike(clock: number): void { this.t0 = clock; this.strong = 1; }
  level(clock: number): number {
    if (!this.enabled) return 0;
    if (clock >= this.next) {
      this.t0 = clock;
      this.strong = 0.65 + this.rnd() * 0.35;
      this.next = clock + 6 + this.rnd() * 9;
    }
    const a = clock - this.t0;
    if (a < 0 || a > 0.8) return 0;
    const pulse = (c: number, w: number): number => Math.exp(-Math.pow((a - c) / w, 2));
    // two flashes (a strong strike, a weaker echo 0.27 s later) then long quiet: well under 3 flashes per second
    return Math.min(1, (pulse(0.03, 0.04) + 0.5 * pulse(0.3, 0.06)) * this.strong);
  }
}

/** Adds storm clouds + a lightning flash term to the shared sky material (uniforms `uStorm`, `uFlashS`). */
export function patchSkyShader(mat: ShaderMaterial): void {
  mat.uniforms.uStorm = { value: 0 };
  mat.uniforms.uFlashS = { value: 0 };
  let fs = mat.fragmentShader;
  fs = fs.replace('uniform float uMoonVis; uniform float uStars; uniform float uDark;', 'uniform float uMoonVis; uniform float uStars; uniform float uDark; uniform float uStorm; uniform float uFlashS;');
  const storm = /* glsl */ `
        float az = atan(d.x, d.z);
        float cl2 = vnoise(vec2(az * 2.2 + uTime * 0.02, d.y * 5.0)) * 0.6 + vnoise(vec2(az * 5.5 - uTime * 0.03, d.y * 11.0)) * 0.4;
        float cover = smoothstep(0.25, 0.72, cl2) * uStorm * smoothstep(-0.2, 0.15, d.y);
        c = mix(c, uHorizon * 0.5 + vec3(0.015, 0.02, 0.035), cover * 0.92);
        c += vec3(0.5, 0.62, 0.95) * uFlashS * (0.3 + 0.7 * cl2) * smoothstep(-0.1, 0.4, d.y + 0.2);
        // moon`;
  fs = fs.replace('// moon', storm);
  mat.fragmentShader = fs;
  mat.needsUpdate = true;
}
