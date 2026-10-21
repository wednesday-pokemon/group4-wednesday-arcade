// Lightweight custom shaders. All colour uniforms are plain sRGB values and shaders output sRGB directly
// (no tone mapping), so they blend consistently with three's built-in fog (which also mixes in output space).
import * as THREE from 'three';

/** Parse '#rrggbb' to an sRGB vec3 (no colour-space conversion). */
export function srgbVec(hex: string, out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
  const n = parseInt(hex.replace('#', ''), 16);
  return out.set(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const NOISE = /* glsl */ `
float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0)), c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`;

const WAVES = /* glsl */ `
uniform float uTime;
uniform float uAmp;
uniform float uCurrent;
void addWave(inout float h, inout vec2 g, vec2 p, vec2 k, float w, float a){
  float ph = dot(k, p) + w * uTime;
  h += a * sin(ph);
  g += a * cos(ph) * k;
}
// returns (height, d/dx, d/dz)
vec3 waves(vec2 p){
  float h = 0.0; vec2 g = vec2(0.0);
  addWave(h, g, p, vec2(0.21, 0.13), 1.1, 1.0 * uAmp);
  addWave(h, g, p, vec2(-0.16, 0.31), 1.5, 0.6 * uAmp);
  addWave(h, g, p, vec2(0.37, -0.08), 1.9, 0.35 * uAmp);
  addWave(h, g, p, vec2(0.85, 0.1), -2.6, 0.22 * uAmp * uCurrent);
  return vec3(h, g);
}
`;

export function createWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    fog: true,
    depthWrite: false,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uAmp: { value: 0.2 },
        uCurrent: { value: 0 },
        uAnimate: { value: 1 },
        uDeep: { value: srgbVec('#070c28') },
        uShallow: { value: srgbVec('#1b2a66') },
        uHorizon: { value: srgbVec('#2d3a7a') },
        uZenith: { value: srgbVec('#0a1030') },
        uMoonDir: { value: new THREE.Vector3(-0.62, 0.27, -0.45).normalize() },
        uMoonCol: { value: srgbVec('#dfe6ff') },
        uGlitter: { value: 1 },
        uMoonVis: { value: 1 },
      },
    ]),
    vertexShader: /* glsl */ `
      ${WAVES}
      uniform float uAnimate;
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float dist = length(wp.xz - cameraPosition.xz);
        wp.y += waves(wp.xz).x * uAnimate * (1.0 - smoothstep(60.0, 220.0, dist));
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      ${WAVES}
      uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uHorizon; uniform vec3 uZenith;
      uniform vec3 uMoonDir; uniform vec3 uMoonCol; uniform float uGlitter; uniform float uMoonVis;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      vec3 skyCol(vec3 d){
        float h = clamp(d.y, 0.0, 1.0);
        vec3 c = mix(uHorizon, uZenith, pow(h, 0.55));
        float m = max(dot(d, uMoonDir), 0.0);
        c += uMoonCol * (pow(m, 1200.0) * 4.0 + pow(m, 70.0) * 0.35 + pow(m, 8.0) * 0.12) * uMoonVis;
        return c;
      }
      void main(){
        vec3 V = cameraPosition - vWorld;
        float dist = length(V);
        V /= dist;
        vec3 wv = waves(vWorld.xz);
        float calm = 1.0 / (1.0 + dist * 0.012);
        vec2 g = wv.yz * calm;
        // fine ripples for sparkle
        g += 0.05 * vec2(cos(vWorld.x * 1.9 + uTime * 2.1 + vWorld.z * 0.7), cos(vWorld.z * 2.3 - uTime * 1.7)) * calm;
        vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
        float ndv = max(dot(N, V), 0.0);
        float fres = 0.04 + 0.7 * pow(1.0 - ndv, 5.0);
        vec3 R = reflect(-V, N);
        R.y = abs(R.y);
        vec3 refl = skyCol(R);
        vec3 body = mix(uDeep, uShallow, 0.35 + 0.65 * ndv);
        // gentle large-scale colour variation
        body += 0.025 * vec3(vnoise(vWorld.xz * 0.06 + uTime * 0.02));
        vec3 col = mix(body, refl, clamp(fres, 0.0, 1.0));
        // moon glitter path
        float m = max(dot(R, uMoonDir), 0.0);
        col += uMoonCol * (pow(m, 380.0) * 2.2 * uGlitter + pow(m, 36.0) * 0.28 * uMoonVis);
        // strong currents: streaks stretched along z + foam flecks
        if (uCurrent > 0.01) {
          float n1 = vnoise(vec2(vWorld.x * 1.3, (vWorld.z - uTime * 7.0) * 0.1));
          float n2 = vnoise(vec2(vWorld.x * 3.1 + 5.0, (vWorld.z - uTime * 9.0) * 0.16));
          float streak = smoothstep(0.52, 0.72, n1 * 0.55 + n2 * 0.5) * smoothstep(0.35, 0.7, n2);
          col = mix(col, vec3(0.55, 0.66, 0.98), streak * 0.4 * uCurrent * (1.0 - smoothstep(60.0, 220.0, dist)));
        }
        // soft foam on wave crests
        float crest = smoothstep(0.78, 1.0, wv.x / max(uAmp, 0.001) * 0.45 + 0.5) * smoothstep(0.1, 0.35, uAmp);
        col += vec3(0.5, 0.58, 0.85) * crest * 0.18;
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
  });
}

export function createSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uZenith: { value: srgbVec('#0a1030') },
      uHorizon: { value: srgbVec('#2d3a7a') },
      uMoonDir: { value: new THREE.Vector3(-0.62, 0.27, -0.45).normalize() },
      uMoonCol: { value: srgbVec('#e6ebff') },
      uMoonVis: { value: 1 },
      uStars: { value: 1 },
      uDark: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform float uTime; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uMoonDir; uniform vec3 uMoonCol;
      uniform float uMoonVis; uniform float uStars; uniform float uDark;
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 c = mix(uHorizon, uZenith, pow(h, 0.5));
        // stars
        if (d.y > 0.02 && uStars > 0.01) {
          vec2 uv = vec2(atan(d.x, d.z) * 22.0, asin(clamp(d.y, -1.0, 1.0)) * 34.0);
          vec2 cell = floor(uv); vec2 f = fract(uv);
          float r = hash21(cell);
          if (r > 0.93) {
            vec2 pos = vec2(hash21(cell + 3.1), hash21(cell + 7.7)) * 0.6 + 0.2;
            float s = smoothstep(0.16, 0.0, length(f - pos));
            float tw = 0.65 + 0.35 * sin(uTime * (1.0 + r * 3.0) + r * 40.0);
            c += vec3(0.8, 0.85, 1.0) * s * tw * uStars * smoothstep(0.02, 0.2, d.y);
          }
        }
        // wispy clouds near horizon
        float cl = vnoise(vec2(atan(d.x, d.z) * 3.0 + uTime * 0.01, d.y * 9.0));
        c = mix(c, uHorizon * 1.1, smoothstep(0.55, 0.9, cl) * (1.0 - smoothstep(0.0, 0.35, h)) * 0.35);
        // moon
        float m = dot(d, uMoonDir);
        float disc = smoothstep(0.9980, 0.9986, m);
        float halo = pow(max(m, 0.0), 120.0) * 0.55 + pow(max(m, 0.0), 14.0) * 0.12;
        c += uMoonCol * (disc * 1.3 + halo) * uMoonVis;
        c *= (1.0 - uDark * 0.75);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

/** Static glow emitters (lanterns, windows, eyes) + their water reflections. One shared geometry, two materials. */
export function createGlowMaterial(mirror: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uLegBit: { value: 1 },
      uPixelScale: { value: 600 },
      uEmphSafe: { value: 1 },
      uEmphShort: { value: 1 },
      uFlicker: { value: 1 },
      uGlowScale: { value: 1 },
      uMirror: { value: mirror ? 1 : 0 },
      uFogDensity: { value: 0.006 },
      uDim: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aColor; attribute float aSize; attribute float aPhase; attribute float aMask; attribute float aGroup;
      uniform float uTime; uniform float uLegBit; uniform float uPixelScale; uniform float uEmphSafe; uniform float uEmphShort;
      uniform float uFlicker; uniform float uGlowScale; uniform float uMirror; uniform float uFogDensity; uniform float uDim;
      varying vec3 vColor; varying float vAlpha;
      void main(){
        float on = mod(floor(aMask / uLegBit), 2.0);
        vec3 pos = position;
        if (uMirror > 0.5) pos.y = -pos.y;
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        float dist = max(-mv.z, 0.5);
        float flick = 1.0 + uFlicker * (0.16 * sin(uTime * 7.3 + aPhase * 19.0) * sin(uTime * 3.7 + aPhase * 7.0) + 0.06 * sin(uTime * 17.0 + aPhase * 31.0));
        float emph = aGroup < 0.5 ? 1.0 : (aGroup < 1.5 ? uEmphSafe : uEmphShort);
        float fogAtt = exp(-pow(uFogDensity * 0.55 * dist, 2.0));
        float size = aSize * uGlowScale * flick * (0.75 + 0.25 * emph);
        gl_PointSize = clamp(size * uPixelScale / dist, 0.0, 240.0) * on;
        vColor = aColor;
        vAlpha = on * fogAtt * flick * emph * (1.0 - uDim * 0.8) * (uMirror > 0.5 ? 0.55 : 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uMirror; uniform float uTime;
      varying vec3 vColor; varying float vAlpha;
      void main(){
        vec2 p = gl_PointCoord - 0.5;
        float a;
        if (uMirror > 0.5) {
          p.x += sin(p.y * 24.0 + uTime * 2.5) * 0.05;
          p.y *= 0.28;
          float r = length(p * vec2(2.4, 2.0));
          a = pow(clamp(1.0 - r * 2.0, 0.0, 1.0), 2.0) * (0.5 + 0.5 * sin(p.y * 90.0 - uTime * 3.0));
          a = clamp(a * 1.1, 0.0, 1.0);
        } else {
          float r = length(p) * 2.0;
          a = pow(clamp(1.0 - r, 0.0, 1.0), 2.2) + 0.9 * smoothstep(0.16, 0.0, r);
        }
        gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
      }`,
  });
}

/** Dynamic particle pool (spray, foam, sparkles, glow bursts). Additive. */
export function createParticleMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uPixelScale: { value: 600 } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
      uniform float uPixelScale;
      varying vec3 vColor; varying float vAlpha;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(aSize * uPixelScale / max(-mv.z, 0.5), 0.0, 160.0);
        vColor = aColor; vAlpha = aAlpha * smoothstep(3.0, 11.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor; varying float vAlpha;
      void main(){
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = pow(clamp(1.0 - r, 0.0, 1.0), 1.6);
        gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
      }`,
  });
}

/** Full-screen flash / vignette / darkness overlay. */
export function createOverlayMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uFlash: { value: new THREE.Vector4(1, 1, 1, 0) },
      uDark: { value: 0 },
      uVig: { value: 0.5 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec4 uFlash; uniform float uDark; uniform float uVig;
      varying vec2 vUv;
      void main(){
        float vig = smoothstep(0.35, 1.05, length(vUv - 0.5) * 1.5);
        float dAlpha = clamp(uVig * vig + uDark * (0.3 + 0.5 * vig), 0.0, 0.92);
        float fA = uFlash.a;
        float alpha = fA + (1.0 - fA) * dAlpha;
        vec3 rgb = alpha > 0.0001 ? (uFlash.rgb * fA) / alpha : vec3(0.0);
        gl_FragColor = vec4(rgb, alpha);
      }`,
  });
}
