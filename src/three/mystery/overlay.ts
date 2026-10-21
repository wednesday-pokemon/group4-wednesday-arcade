// Full-screen overlay: threat tint (Hyde mode), directional edge glow toward an off-screen Hyde, hidden-state vignette, flashes.
// Red is reserved for the Hyde threat; every other flash uses cool/neutral colours. The centre of the screen is left clear.
import * as THREE from 'three';

export interface MysteryOverlayUniforms {
  uThreat: { value: number };
  uHide: { value: number };
  uFlash: { value: THREE.Vector4 };
  uTime: { value: number };
  uEdge: { value: THREE.Vector3 }; // x,y = screen-space direction toward the Hyde, z = strength (only when off-screen)
  uDim: { value: number };
  uReduced: { value: number };
}

export function createOverlay(): { mesh: THREE.Mesh; u: MysteryOverlayUniforms; dispose(): void } {
  const u: MysteryOverlayUniforms = {
    uThreat: { value: 0 }, uHide: { value: 0 }, uFlash: { value: new THREE.Vector4(1, 1, 1, 0) }, uTime: { value: 0 },
    uEdge: { value: new THREE.Vector3(0, 0, 0) }, uDim: { value: 0 }, uReduced: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, premultipliedAlpha: true,
    uniforms: u as unknown as Record<string, THREE.IUniform>,
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uThreat; uniform float uHide; uniform vec4 uFlash; uniform float uTime; uniform vec3 uEdge; uniform float uDim; uniform float uReduced;
      varying vec2 vUv;
      vec4 over(vec4 acc, vec3 rgb, float a){ a = clamp(a, 0.0, 1.0); return vec4(acc.rgb * (1.0 - a) + rgb * a, acc.a * (1.0 - a) + a); }
      void main(){
        vec2 p = (vUv * 2.0 - 1.0) * vec2(0.92, 1.0);
        float r = length(p);
        float vig = smoothstep(0.62, 1.45, r);
        vec4 acc = vec4(0.0);
        float pulse = uReduced > 0.5 ? 0.9 : 0.82 + 0.18 * sin(uTime * 6.5);
        // threat vignette (kept to the screen edges so the HUD centre stays clean)
        acc = over(acc, vec3(0.02, 0.0, 0.05), vig * uThreat * 0.5);
        acc = over(acc, vec3(0.36, 0.03, 0.08), vig * uThreat * uThreat * 0.38 * pulse);
        // directional glow toward an off-screen Hyde
        if (uEdge.z > 0.001) {
          vec2 d = normalize(uEdge.xy + vec2(1e-5));
          float side = max(dot(normalize(p + vec2(1e-5)), d), 0.0);
          float edge = pow(side, 3.0) * smoothstep(0.55, 1.2, r);
          acc = over(acc, vec3(0.62, 0.05, 0.1), edge * uEdge.z * 0.6 * pulse);
        }
        // hidden: cold close-in vignette, slow breathing
        float br = uReduced > 0.5 ? 0.5 : 0.5 + 0.5 * sin(uTime * 1.6);
        acc = over(acc, vec3(0.02, 0.05, 0.12), uHide * (0.1 + smoothstep(0.35, 1.2, r) * (0.62 + 0.1 * br)));
        acc = over(acc, uFlash.rgb, uFlash.a);
        acc = over(acc, vec3(0.0, 0.0, 0.02), uDim);
        gl_FragColor = acc;
      }`,
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000;
  return { mesh, u, dispose: () => { g.dispose(); mat.dispose(); } };
}
