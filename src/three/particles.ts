// CPU particle pool rendered as one additive Points draw call.
import * as THREE from 'three';
import { createParticleMaterial, srgbVec } from './shaders.ts';

export interface EmitSpec {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size: number;
  /** size multiplier reached at end of life */
  grow?: number;
  color: string | THREE.Vector3;
  alpha?: number;
  gravity?: number;
  drag?: number;
}

const tmp = new THREE.Vector3();

export class ParticlePool {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private readonly geo = new THREE.BufferGeometry();
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size0: Float32Array;
  private readonly grow: Float32Array;
  private readonly alpha0: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private cursor = 0;
  private activeLimit: number;

  constructor(readonly capacity: number) {
    this.activeLimit = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity).fill(1);
    this.life = new Float32Array(capacity).fill(1);
    this.size0 = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);
    this.alpha0 = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.material = createParticleMaterial();
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  setPixelScale(v: number): void {
    this.material.uniforms.uPixelScale.value = v;
  }

  /** Limit how many pool slots may be used (lowGraphics). */
  setActiveLimit(n: number): void {
    this.activeLimit = Math.max(8, Math.min(this.capacity, n));
    if (this.cursor >= this.activeLimit) this.cursor = 0;
  }

  emit(s: EmitSpec): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.activeLimit;
    const c = typeof s.color === 'string' ? srgbVec(s.color, tmp) : s.color;
    this.pos[i * 3] = s.x;
    this.pos[i * 3 + 1] = s.y;
    this.pos[i * 3 + 2] = s.z;
    this.vel[i * 3] = s.vx ?? 0;
    this.vel[i * 3 + 1] = s.vy ?? 0;
    this.vel[i * 3 + 2] = s.vz ?? 0;
    this.col[i * 3] = c.x;
    this.col[i * 3 + 1] = c.y;
    this.col[i * 3 + 2] = c.z;
    this.age[i] = 0;
    this.life[i] = Math.max(0.05, s.life);
    this.size0[i] = s.size;
    this.grow[i] = s.grow ?? 1;
    this.alpha0[i] = s.alpha ?? 0.8;
    this.grav[i] = s.gravity ?? 0;
    this.drag[i] = s.drag ?? 0;
  }

  clear(): void {
    this.age.fill(1);
    this.alpha.fill(0);
    this.size.fill(0);
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }

  update(dt: number): void {
    const n = this.capacity;
    for (let i = 0; i < n; i++) {
      if (this.age[i] >= 1) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      this.age[i] += dt / this.life[i];
      const a = this.age[i];
      if (a >= 1) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d + this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      // droplets that fall back into the sea vanish
      if (this.grav[i] < 0 && this.pos[i * 3 + 1] < 0.02 && this.vel[i * 3 + 1] < 0) {
        this.age[i] = 1;
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      const fadeIn = Math.min(1, a * 8);
      this.alpha[i] = this.alpha0[i] * (1 - a) * (1 - a * 0.3) * fadeIn;
      this.size[i] = this.size0[i] * (1 + (this.grow[i] - 1) * a);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}
